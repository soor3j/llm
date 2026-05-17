"""Admin endpoints — power the operator console in the workspace UI.

These all require the ADMIN_API_KEY Bearer token (verify_admin_key). They
expose rolled-up data the dashboard reads instead of generating it
client-side:

    GET  /admin/metrics/summary   real-time gauges for the rail + cards
    GET  /admin/users             registered user list
    GET  /admin/queue             in-flight + recent completed requests
    GET  /admin/logs              recent request log lines (Redis-backed)
    GET  /admin/cache/stats       entries, hit-rate, memory
    POST /admin/cache/flush       alias of /v1/cache/clear
"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request

from gateway.middleware.auth import verify_admin_key
from gateway.services.metrics_summary import _collect_samples, _sum, build_summary

log = structlog.get_logger()

router = APIRouter(
    dependencies=[Depends(verify_admin_key)],
    tags=["admin"],
)


# ---------- /admin/metrics/summary ----------

@router.get("/metrics/summary")
async def metrics_summary(request: Request) -> dict[str, Any]:
    return build_summary(request.app.state)


# ---------- /admin/users ----------

@router.get("/users")
async def list_users(request: Request) -> dict[str, Any]:
    users = getattr(request.app.state, "users", None)
    if users is None:
        return {"users": [], "available": False}
    return {"users": await users.list_all(), "available": True}


# ---------- /admin/queue ----------

@router.get("/queue")
async def queue_snapshot(request: Request) -> dict[str, Any]:
    tracker = getattr(request.app.state, "queue_tracker", None)
    if tracker is None:
        return {"available": False, "in_flight": 0, "inflight": [], "recent": []}
    snap = tracker.snapshot()
    snap["available"] = True
    snap["model"] = request.app.state.engine_client.__class__.__name__ if hasattr(
        request.app.state, "engine_client"
    ) else None
    return snap


# ---------- /admin/logs ----------

@router.get("/logs")
async def list_logs(
    request: Request,
    filter: str = "all",
    limit: int = 200,
) -> dict[str, Any]:
    if filter not in ("all", "errors", "200"):
        raise HTTPException(400, detail={"message": "filter must be all|errors|200"})
    rl = getattr(request.app.state, "request_log", None)
    if rl is None:
        return {"logs": [], "available": False, "total": 0}
    logs = await rl.tail(limit=min(limit, 1000), filter_kind=filter)
    total = await rl.count()
    return {"logs": logs, "available": True, "total": total}


# ---------- /admin/cache/stats ----------

@router.get("/cache/stats")
async def cache_stats(request: Request) -> dict[str, Any]:
    cache = getattr(request.app.state, "cache", None)
    redis_client = getattr(request.app.state, "redis_client", None)

    if cache is None or redis_client is None:
        return {"available": False}

    s = _collect_samples()
    hits = int(_sum(s, "llm_cache_hits_total"))
    misses = int(_sum(s, "llm_cache_misses_total"))
    total = hits + misses
    hit_rate = (hits / total) if total > 0 else 0.0

    try:
        entries = int(await redis_client.llen("cache:index"))
    except Exception:
        entries = 0

    memory_bytes = 0
    try:
        info = await redis_client.info("memory")
        memory_bytes = int(info.get("used_memory", 0))
    except Exception:
        pass

    return {
        "available": True,
        "entries": entries,
        "hits": hits,
        "misses": misses,
        "hit_rate": round(hit_rate, 4),
        "memory_bytes": memory_bytes,
        "ttl_seconds": 3600,
    }


# ---------- /admin/cache/flush ----------

@router.post("/cache/flush")
async def cache_flush(request: Request) -> dict[str, Any]:
    cache = getattr(request.app.state, "cache", None)
    if cache is None:
        return {"cleared": 0, "available": False}
    cleared = await cache.clear()
    log.info("admin_cache_flush", cleared=cleared)
    return {"cleared": cleared, "available": True}
