"""Per-user persistent conversation store.

Conversations live in Redis so chats survive container restarts and the
History tab in the UI can show real data. Each user is identified by the
email associated with their api_key (looked up in UserRegistry).

Storage layout:

    chats:user:<email>       ZSET    member=chat_id, score=updated_at_unix
                                     (sorted by recency for the sidebar list)
    chat:meta:<chat_id>      HASH    email, title, created_at, updated_at,
                                     message_count
    chat:msgs:<chat_id>      STRING  JSON-encoded list of {role, content}

A chat is "owned" by the email stored in its meta hash. The router
verifies ownership before allowing get / update / delete.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Optional

import structlog

log = structlog.get_logger()

_USER_INDEX = "chats:user:"   # ZSET per user
_META_PREFIX = "chat:meta:"   # HASH per chat
_MSGS_PREFIX = "chat:msgs:"   # STRING per chat (JSON)


def _now() -> int:
    return int(time.time())


def _new_id() -> str:
    return f"c_{uuid.uuid4().hex[:16]}"


def _autotitle(messages: list[dict], fallback: str = "New chat") -> str:
    """Pick a short title from the first user message."""
    for m in messages or []:
        if m.get("role") == "user" and m.get("content"):
            text = m["content"].strip().replace("\n", " ")
            if len(text) > 60:
                text = text[:57].rstrip() + "…"
            return text or fallback
    return fallback


class ChatHistory:
    def __init__(self, redis_client) -> None:
        self._redis = redis_client

    # --- read ------------------------------------------------------

    async def list(self, email: str, limit: int = 50) -> list[dict]:
        """Return conversations for ``email``, newest first."""
        email = (email or "").lower()
        if not email:
            return []
        ids = await self._redis.zrevrange(
            f"{_USER_INDEX}{email}", 0, max(0, limit - 1)
        )
        out: list[dict] = []
        for cid in ids:
            meta = await self._redis.hgetall(f"{_META_PREFIX}{cid}")
            if not meta:
                continue
            out.append(
                {
                    "id": cid,
                    "title": meta.get("title", "Untitled"),
                    "created_at": int(meta.get("created_at", 0)),
                    "updated_at": int(meta.get("updated_at", 0)),
                    "message_count": int(meta.get("message_count", 0)),
                }
            )
        return out

    async def get(self, chat_id: str) -> Optional[dict]:
        meta = await self._redis.hgetall(f"{_META_PREFIX}{chat_id}")
        if not meta:
            return None
        raw_msgs = await self._redis.get(f"{_MSGS_PREFIX}{chat_id}")
        try:
            messages = json.loads(raw_msgs) if raw_msgs else []
        except (ValueError, TypeError):
            messages = []
        return {
            "id": chat_id,
            "email": meta.get("email"),
            "title": meta.get("title", "Untitled"),
            "created_at": int(meta.get("created_at", 0)),
            "updated_at": int(meta.get("updated_at", 0)),
            "message_count": int(meta.get("message_count", 0)),
            "messages": messages,
        }

    async def owner_of(self, chat_id: str) -> Optional[str]:
        return await self._redis.hget(f"{_META_PREFIX}{chat_id}", "email")

    # --- write -----------------------------------------------------

    async def create(
        self,
        email: str,
        title: Optional[str] = None,
        messages: Optional[list[dict]] = None,
    ) -> dict:
        email = (email or "").lower()
        if not email:
            raise ValueError("email required")
        chat_id = _new_id()
        ts = _now()
        msgs = messages or []
        final_title = (title or _autotitle(msgs)).strip() or "New chat"
        pipe = self._redis.pipeline()
        pipe.hset(
            f"{_META_PREFIX}{chat_id}",
            mapping={
                "email": email,
                "title": final_title,
                "created_at": str(ts),
                "updated_at": str(ts),
                "message_count": str(len(msgs)),
            },
        )
        pipe.set(f"{_MSGS_PREFIX}{chat_id}", json.dumps(msgs))
        pipe.zadd(f"{_USER_INDEX}{email}", {chat_id: ts})
        await pipe.execute()
        log.info("chat_created", email=email, chat_id=chat_id, title=final_title)
        return {
            "id": chat_id,
            "email": email,
            "title": final_title,
            "created_at": ts,
            "updated_at": ts,
            "message_count": len(msgs),
            "messages": msgs,
        }

    async def update(
        self,
        chat_id: str,
        *,
        messages: Optional[list[dict]] = None,
        title: Optional[str] = None,
    ) -> Optional[dict]:
        meta = await self._redis.hgetall(f"{_META_PREFIX}{chat_id}")
        if not meta:
            return None
        ts = _now()
        email = meta.get("email", "").lower()
        pipe = self._redis.pipeline()
        updates: dict[str, str] = {"updated_at": str(ts)}
        if messages is not None:
            pipe.set(f"{_MSGS_PREFIX}{chat_id}", json.dumps(messages))
            updates["message_count"] = str(len(messages))
            # Auto-derive a title from the first user msg if still on default.
            if (title is None) and meta.get("title") in (None, "", "New chat"):
                updates["title"] = _autotitle(messages, fallback=meta.get("title", "New chat"))
        if title is not None and title.strip():
            updates["title"] = title.strip()
        pipe.hset(f"{_META_PREFIX}{chat_id}", mapping=updates)
        if email:
            pipe.zadd(f"{_USER_INDEX}{email}", {chat_id: ts})
        await pipe.execute()
        return await self.get(chat_id)

    async def delete(self, chat_id: str) -> bool:
        email = await self.owner_of(chat_id)
        if not email:
            return False
        pipe = self._redis.pipeline()
        pipe.delete(f"{_META_PREFIX}{chat_id}")
        pipe.delete(f"{_MSGS_PREFIX}{chat_id}")
        pipe.zrem(f"{_USER_INDEX}{email.lower()}", chat_id)
        await pipe.execute()
        log.info("chat_deleted", email=email, chat_id=chat_id)
        return True
