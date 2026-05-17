"""Thin async client for the llama.cpp HTTP server.

The chat template (Mistral / Llama 3 / Qwen / etc.) is now selected via
gateway.services.chat_templates rather than hardcoded here. Swap MODEL_FILE
in .env and the template auto-detects from the filename, or set
CHAT_TEMPLATE explicitly.
"""

import json
from collections.abc import AsyncIterator
from typing import Callable

import httpx
import structlog

from gateway.schemas import ChatMessage
from gateway.services.chat_templates import resolve as resolve_template

log = structlog.get_logger()


class LlamaCppClient:
    def __init__(
        self,
        host: str,
        port: int,
        chat_template: str = "auto",
        model_name: str = "",
        model_path: str = "",
    ) -> None:
        self._base_url = f"http://{host}:{port}"
        self._template_name, self._format, self._stops = resolve_template(
            chat_template, model_name, model_path
        )
        log.info(
            "engine_template_selected",
            template=self._template_name,
            requested=chat_template,
            stops=self._stops,
        )

    @property
    def template_name(self) -> str:
        return self._template_name

    def _build_payload(
        self,
        messages: list[ChatMessage],
        max_tokens: int,
        temperature: float,
        top_p: float,
        stream: bool,
    ) -> dict:
        return {
            "prompt": self._format(messages),
            "n_predict": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "stop": self._stops,
            "stream": stream,
        }

    async def generate(
        self,
        messages: list[ChatMessage],
        max_tokens: int = 512,
        temperature: float = 1.0,
        top_p: float = 1.0,
    ) -> dict:
        payload = self._build_payload(messages, max_tokens, temperature, top_p, stream=False)
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            response = await client.post(f"{self._base_url}/completion", json=payload)
            response.raise_for_status()
            return response.json()

    async def generate_stream(
        self,
        messages: list[ChatMessage],
        max_tokens: int = 512,
        temperature: float = 1.0,
        top_p: float = 1.0,
    ) -> AsyncIterator[str]:
        payload = self._build_payload(messages, max_tokens, temperature, top_p, stream=True)
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            async with client.stream(
                "POST", f"{self._base_url}/completion", json=payload
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    raw = line[6:].strip()
                    if not raw:
                        continue
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    content = chunk.get("content", "")
                    stop = chunk.get("stop", False)

                    if content:
                        yield content
                    if stop:
                        break

    async def health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
                resp = await client.get(f"{self._base_url}/health")
                return resp.status_code == 200
        except httpx.HTTPError:
            return False
