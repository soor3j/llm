"""Redis-backed request log for the admin Logs view.

The chat router calls record() in its finally block to capture every
request outcome. Entries are LPUSHed into a Redis list and trimmed to
the most recent N. The admin /admin/logs endpoint reads via tail().

Storage:
    logs:requests   LIST of JSON-encoded entries, newest first (LPUSH).
                    Trimmed to LOGS_MAX entries via LTRIM.
"""

import json
import time
from typing import Optional

import structlog

log = structlog.get_logger()

_LOGS_KEY = "logs:requests"
_LOGS_MAX = 1000


class RequestLog:
    def __init__(self, redis_client) -> None:
        self._redis = redis_client

    async def record(
        self,
        *,
        status: int,
        latency_ms: int,
        model: str,
        trace_id: str,
        message: str,
        level: str = "info",
        api_key_prefix: Optional[str] = None,
    ) -> None:
        """Append one log entry. Swallows errors — capture must never break a request."""
        entry = {
            "ts": time.time(),
            "level": level,
            "status": status,
            "latency_ms": latency_ms,
            "model": model,
            "trace_id": trace_id,
            "message": message,
            "api_key_prefix": api_key_prefix,
        }
        try:
            pipe = self._redis.pipeline()
            pipe.lpush(_LOGS_KEY, json.dumps(entry))
            pipe.ltrim(_LOGS_KEY, 0, _LOGS_MAX - 1)
            await pipe.execute()
        except Exception as exc:
            # Log capture must not fail the request — just drop the entry.
            log.warning("request_log_capture_failed", error=str(exc))

    async def tail(
        self,
        limit: int = 200,
        filter_kind: str = "all",
    ) -> list[dict]:
        """Return up to ``limit`` recent entries, newest first."""
        raw = await self._redis.lrange(_LOGS_KEY, 0, limit - 1)
        out: list[dict] = []
        for r in raw:
            try:
                entry = json.loads(r)
            except (ValueError, TypeError):
                continue
            status = entry.get("status", 0)
            if filter_kind == "errors" and status < 400:
                continue
            if filter_kind == "200" and status != 200:
                continue
            out.append(entry)
        return out

    async def count(self) -> int:
        try:
            return int(await self._redis.llen(_LOGS_KEY))
        except Exception:
            return 0
