import json
from collections.abc import AsyncIterator

import httpx
import structlog

from gateway.schemas import ChatMessage

log = structlog.get_logger()


def _format_mistral_prompt(messages: list[ChatMessage]) -> str:
    """Format messages using the Mistral instruct template.

    Mistral uses: <s>[INST] user_message [/INST] assistant_response</s>[INST] ...
    System messages are prepended to the first user turn.
    """
    prompt = ""
    system_content = ""

    for msg in messages:
        if msg.role == "system":
            system_content = msg.content
        elif msg.role == "user":
            content = f"{system_content}\n\n{msg.content}".strip() if system_content else msg.content
            system_content = ""
            prompt += f"<s>[INST] {content} [/INST]"
        elif msg.role == "assistant":
            prompt += f" {msg.content}</s>"

    return prompt


class LlamaCppClient:
    def __init__(self, host: str, port: int) -> None:
        self._base_url = f"http://{host}:{port}"

    async def generate(
        self,
        messages: list[ChatMessage],
        max_tokens: int = 512,
        temperature: float = 1.0,
        top_p: float = 1.0,
    ) -> dict:
        prompt = _format_mistral_prompt(messages)
        payload = {
            "prompt": prompt,
            "n_predict": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "stop": ["</s>", "[INST]"],
            "stream": False,
        }

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
        prompt = _format_mistral_prompt(messages)
        payload = {
            "prompt": prompt,
            "n_predict": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "stop": ["</s>", "[INST]"],
            "stream": True,
        }

        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            async with client.stream("POST", f"{self._base_url}/completion", json=payload) as response:
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
