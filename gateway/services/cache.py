import base64
import json
import time

import numpy as np
import structlog

from gateway.schemas import ChatMessage

log = structlog.get_logger()

_EMBEDDING_KEY_PREFIX = "cache:emb:"
_RESPONSE_KEY_PREFIX = "cache:resp:"
_INDEX_KEY = "cache:index"


class SemanticCache:
    def __init__(self, redis_client, settings, model) -> None:
        self._redis = redis_client
        self._settings = settings
        self._model = model  # sentence-transformers model

    @classmethod
    async def create(cls, redis_client, settings) -> "SemanticCache":
        from sentence_transformers import SentenceTransformer

        log.info("loading_embedding_model", model="all-MiniLM-L6-v2")
        model = SentenceTransformer("all-MiniLM-L6-v2")
        log.info("embedding_model_loaded")
        return cls(redis_client, settings, model)

    def _messages_to_text(self, messages: list[ChatMessage]) -> str:
        return " ".join(f"{m.role}: {m.content}" for m in messages)

    def _embed(self, text: str) -> np.ndarray:
        return self._model.encode(text, normalize_embeddings=True)

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b))  # vectors are already L2-normalized

    async def lookup(self, messages: list[ChatMessage]) -> dict | None:
        from gateway.metrics import cache_lookup_seconds

        start = time.perf_counter()
        try:
            text = self._messages_to_text(messages)
            query_emb = self._embed(text)

            # Get all cached entry IDs
            entry_ids = await self._redis.lrange(_INDEX_KEY, 0, -1)
            if not entry_ids:
                return None

            best_score = -1.0
            best_id = None

            for entry_id in entry_ids:
                emb_b64 = await self._redis.get(f"{_EMBEDDING_KEY_PREFIX}{entry_id}")
                if emb_b64 is None:
                    continue
                cached_emb = np.frombuffer(base64.b64decode(emb_b64), dtype=np.float32)
                score = self._cosine_similarity(query_emb.astype(np.float32), cached_emb)
                if score > best_score:
                    best_score = score
                    best_id = entry_id

            if best_score >= self._settings.cache_similarity_threshold and best_id is not None:
                raw = await self._redis.get(f"{_RESPONSE_KEY_PREFIX}{best_id}")
                if raw:
                    log.debug("cache_hit", score=round(best_score, 4), entry_id=best_id)
                    return json.loads(raw)

            return None
        finally:
            cache_lookup_seconds.observe(time.perf_counter() - start)

    async def store(self, messages: list[ChatMessage], response: dict) -> None:
        text = self._messages_to_text(messages)
        emb = self._embed(text).astype(np.float32)
        entry_id = str(int(time.time() * 1000))

        pipe = self._redis.pipeline()
        pipe.set(
            f"{_EMBEDDING_KEY_PREFIX}{entry_id}",
            base64.b64encode(emb.tobytes()).decode("ascii"),
            ex=self._settings.cache_ttl_seconds,
        )
        pipe.set(
            f"{_RESPONSE_KEY_PREFIX}{entry_id}",
            json.dumps(response),
            ex=self._settings.cache_ttl_seconds,
        )
        pipe.rpush(_INDEX_KEY, entry_id)
        pipe.expire(_INDEX_KEY, self._settings.cache_ttl_seconds)
        await pipe.execute()

        # Evict oldest entries if over limit
        length = await self._redis.llen(_INDEX_KEY)
        if length > self._settings.max_cache_entries:
            oldest_id = await self._redis.lpop(_INDEX_KEY)
            if oldest_id:
                await self._redis.delete(
                    f"{_EMBEDDING_KEY_PREFIX}{oldest_id}",
                    f"{_RESPONSE_KEY_PREFIX}{oldest_id}",
                )

        log.debug("cache_stored", entry_id=entry_id)

    async def clear(self) -> int:
        entry_ids = await self._redis.lrange(_INDEX_KEY, 0, -1)
        if not entry_ids:
            return 0
        keys = (
            [_INDEX_KEY]
            + [f"{_EMBEDDING_KEY_PREFIX}{eid}" for eid in entry_ids]
            + [f"{_RESPONSE_KEY_PREFIX}{eid}" for eid in entry_ids]
        )
        await self._redis.delete(*keys)
        return len(entry_ids)
