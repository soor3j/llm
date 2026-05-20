"""Retrieval-augmented generation (RAG) document store.

Users paste a document; we split it into chunks, embed each chunk with the
sentence-transformer model (the same one the semantic cache already uses),
and store everything in Redis. At query time the user's question is
embedded and compared against their chunks; the top-k matches are
prepended to the chat prompt as a system message.

Storage layout:
    rag:user:<email>          ZSET   member=doc_id, score=uploaded_at
    rag:doc:<doc_id>          HASH   email, name, content_type, uploaded_at,
                                     size_bytes, text_length, chunk_count
    rag:doc_chunks:<doc_id>   LIST   chunk_ids belonging to this document
    rag:chunk:<chunk_id>      HASH   doc_id, email, text, embedding_b64
"""

from __future__ import annotations

import base64
import time
import uuid
from typing import Optional

import numpy as np
import structlog

log = structlog.get_logger()

_USER_INDEX = "rag:user:"
_DOC_PREFIX = "rag:doc:"
_DOC_CHUNKS_PREFIX = "rag:doc_chunks:"
_CHUNK_PREFIX = "rag:chunk:"

# Chunking knobs. We split into ~500-token windows with 50-token overlap.
# Tokens are approximated as whitespace-separated words — close enough for
# retrieval purposes, and we avoid dragging in a tokenizer dependency.
CHUNK_WORDS = 350      # ~500 tokens
CHUNK_OVERLAP = 35     # ~50 tokens
MAX_DOC_BYTES = 5 * 1024 * 1024  # 5 MB upper bound per upload


def _now() -> int:
    return int(time.time())


def _chunk_text(text: str) -> list[str]:
    """Split a long text into overlapping word-window chunks."""
    words = text.split()
    if not words:
        return []
    chunks: list[str] = []
    i = 0
    while i < len(words):
        end = min(len(words), i + CHUNK_WORDS)
        chunks.append(" ".join(words[i:end]))
        if end >= len(words):
            break
        i = end - CHUNK_OVERLAP
    return chunks


def _encode_embedding(vec: np.ndarray) -> str:
    return base64.b64encode(vec.astype(np.float32).tobytes()).decode("ascii")


def _decode_embedding(b64: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(b64), dtype=np.float32)


class RAGStore:
    """Per-user retrieval store. Re-uses the cache's embedding model."""

    def __init__(self, redis_client, model) -> None:
        self._redis = redis_client
        self._model = model  # SentenceTransformer (L2-normalized outputs)

    def _embed(self, text: str) -> np.ndarray:
        return self._model.encode(text, normalize_embeddings=True)

    # --- write ----------------------------------------------------------

    async def upload(
        self,
        email: str,
        name: str,
        text: str,
        content_type: str = "text/plain",
    ) -> dict:
        """Chunk, embed, and store a document for ``email``.

        Returns the doc metadata. Raises ValueError on empty input or
        oversize content.
        """
        email = (email or "").lower()
        if not email:
            raise ValueError("email required")
        if not text or not text.strip():
            raise ValueError("document is empty")
        size = len(text.encode("utf-8"))
        if size > MAX_DOC_BYTES:
            raise ValueError(f"document exceeds {MAX_DOC_BYTES // (1024 * 1024)}MB limit")

        chunks = _chunk_text(text)
        if not chunks:
            raise ValueError("no chunks could be produced")

        doc_id = f"d_{uuid.uuid4().hex[:16]}"
        chunk_ids: list[str] = []

        # Embed each chunk and pipeline the writes.
        pipe = self._redis.pipeline()
        for chunk in chunks:
            chunk_id = f"k_{uuid.uuid4().hex[:16]}"
            chunk_ids.append(chunk_id)
            emb = self._embed(chunk)
            pipe.hset(
                f"{_CHUNK_PREFIX}{chunk_id}",
                mapping={
                    "doc_id": doc_id,
                    "email": email,
                    "text": chunk,
                    "embedding_b64": _encode_embedding(emb),
                },
            )
        ts = _now()
        meta = {
            "email": email,
            "name": (name or "document.txt")[:200],
            "content_type": content_type,
            "uploaded_at": str(ts),
            "size_bytes": str(size),
            "text_length": str(len(text)),
            "chunk_count": str(len(chunk_ids)),
        }
        pipe.hset(f"{_DOC_PREFIX}{doc_id}", mapping=meta)
        if chunk_ids:
            pipe.rpush(f"{_DOC_CHUNKS_PREFIX}{doc_id}", *chunk_ids)
        pipe.zadd(f"{_USER_INDEX}{email}", {doc_id: ts})
        await pipe.execute()

        log.info(
            "rag_document_uploaded",
            email=email, doc_id=doc_id, name=name, chunks=len(chunk_ids), size=size,
        )
        return {
            "id": doc_id,
            "name": meta["name"],
            "uploaded_at": ts,
            "size_bytes": size,
            "text_length": len(text),
            "chunk_count": len(chunk_ids),
            "content_type": content_type,
        }

    async def delete(self, email: str, doc_id: str) -> bool:
        email = (email or "").lower()
        owner = await self._redis.hget(f"{_DOC_PREFIX}{doc_id}", "email")
        if owner is None or owner.lower() != email:
            return False
        chunk_ids = await self._redis.lrange(f"{_DOC_CHUNKS_PREFIX}{doc_id}", 0, -1)
        pipe = self._redis.pipeline()
        for cid in chunk_ids:
            pipe.delete(f"{_CHUNK_PREFIX}{cid}")
        pipe.delete(f"{_DOC_CHUNKS_PREFIX}{doc_id}")
        pipe.delete(f"{_DOC_PREFIX}{doc_id}")
        pipe.zrem(f"{_USER_INDEX}{email}", doc_id)
        await pipe.execute()
        log.info("rag_document_deleted", email=email, doc_id=doc_id, chunks=len(chunk_ids))
        return True

    # --- read -----------------------------------------------------------

    async def list(self, email: str, limit: int = 100) -> list[dict]:
        email = (email or "").lower()
        if not email:
            return []
        ids = await self._redis.zrevrange(
            f"{_USER_INDEX}{email}", 0, max(0, limit - 1)
        )
        out: list[dict] = []
        for did in ids:
            meta = await self._redis.hgetall(f"{_DOC_PREFIX}{did}")
            if not meta:
                continue
            out.append(
                {
                    "id": did,
                    "name": meta.get("name", "Untitled"),
                    "content_type": meta.get("content_type", "text/plain"),
                    "uploaded_at": int(meta.get("uploaded_at", 0)),
                    "size_bytes": int(meta.get("size_bytes", 0)),
                    "text_length": int(meta.get("text_length", 0)),
                    "chunk_count": int(meta.get("chunk_count", 0)),
                }
            )
        return out

    async def query(
        self,
        email: str,
        query_text: str,
        top_k: int = 4,
        min_score: float = 0.2,
    ) -> list[dict]:
        """Return the top-k most similar chunks for the user's query.

        Each result is {doc_id, doc_name, text, score}. Empty list if the
        user has no documents or no chunk crosses ``min_score``.
        """
        email = (email or "").lower()
        if not email or not query_text:
            return []

        # Gather every chunk_id owned by this user (across all their docs).
        doc_ids = await self._redis.zrange(f"{_USER_INDEX}{email}", 0, -1)
        if not doc_ids:
            return []
        chunk_ids: list[str] = []
        doc_names: dict[str, str] = {}
        for did in doc_ids:
            cids = await self._redis.lrange(f"{_DOC_CHUNKS_PREFIX}{did}", 0, -1)
            chunk_ids.extend(cids)
            name = await self._redis.hget(f"{_DOC_PREFIX}{did}", "name")
            doc_names[did] = name or "Untitled"
        if not chunk_ids:
            return []

        # Embed the query, score every chunk.
        q_emb = self._embed(query_text).astype(np.float32)
        scored: list[tuple[float, str, str, str]] = []  # (score, doc_id, doc_name, text)
        for cid in chunk_ids:
            data = await self._redis.hgetall(f"{_CHUNK_PREFIX}{cid}")
            if not data:
                continue
            try:
                emb = _decode_embedding(data["embedding_b64"])
            except (KeyError, ValueError, TypeError):
                continue
            score = float(np.dot(q_emb, emb))  # both are L2-normalized
            did = data.get("doc_id", "")
            scored.append((score, did, doc_names.get(did, "Untitled"), data.get("text", "")))

        scored.sort(key=lambda r: r[0], reverse=True)
        out = []
        for score, did, name, text in scored[: max(1, top_k)]:
            if score < min_score:
                break
            out.append({"doc_id": did, "doc_name": name, "text": text, "score": round(score, 4)})
        return out

    def build_context_prompt(self, hits: list[dict]) -> str:
        """Render top-k chunks into a system-message context block."""
        if not hits:
            return ""
        lines = ["Use the following excerpts from the user's documents to answer:"]
        for i, h in enumerate(hits, 1):
            lines.append(f"\n[{i}] From \"{h['doc_name']}\" (relevance {h['score']:.2f}):")
            lines.append(h["text"])
        lines.append(
            "\nIf the excerpts don't contain the answer, say so explicitly "
            "rather than guessing."
        )
        return "\n".join(lines)
