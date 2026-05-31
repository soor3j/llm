"""Multi-model fleet registry.

Each LLM runs in its own llama.cpp container. The registry maps the
model ID (as sent in the OpenAI Chat Completions request) to the
corresponding LlamaCppClient. Switching models is instant — every
backend is pre-loaded at startup.
"""

import structlog

from gateway.config import Settings
from gateway.services.engine import LlamaCppClient

log = structlog.get_logger()


class ModelRegistry:
    """Holds one LlamaCppClient per model, indexed by model ID."""

    def __init__(self, settings: Settings) -> None:
        # Mistral 7B Instruct
        self._mistral = LlamaCppClient(
            host=settings.engine_mistral_host,
            port=settings.engine_mistral_port,
            chat_template="mistral",
            model_name="mistral-7b-instruct",
            model_path="/models/mistral-7b-instruct-v0.2.Q4_K_M.gguf",
        )
        # Phi-3.5 Mini Instruct
        self._phi = LlamaCppClient(
            host=settings.engine_phi_host,
            port=settings.engine_phi_port,
            chat_template="phi3",
            model_name="phi-3.5-mini",
            model_path="/models/Phi-3.5-mini-instruct-Q4_K_M.gguf",
        )
        # Llama 3.2 3B Instruct
        self._llama = LlamaCppClient(
            host=settings.engine_llama_host,
            port=settings.engine_llama_port,
            chat_template="llama3",
            model_name="llama-3.2-3b",
            model_path="/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        )

        # Maps any model alias → client. Frontend sends one of these IDs.
        self._by_id: dict[str, LlamaCppClient] = {
            "mistral-7b": self._mistral,
            "mistral-7b-instruct": self._mistral,
            "phi-3.5-mini": self._phi,
            "phi-3.5": self._phi,
            "phi": self._phi,
            "llama-3.2-3b": self._llama,
            "llama-3.2": self._llama,
            "llama": self._llama,
        }
        log.info("model_registry_loaded", models=list(self._by_id.keys()))

    def get(self, model_id: str) -> LlamaCppClient:
        """Return the engine client for the requested model ID.

        Falls back to Mistral if the ID is unknown.
        """
        key = (model_id or "").lower().strip()
        client = self._by_id.get(key, self._mistral)
        return client

    def list_models(self) -> list[str]:
        """Canonical model IDs (one per real backend)."""
        return ["mistral-7b", "phi-3.5-mini", "llama-3.2-3b"]
