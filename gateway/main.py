from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from gateway.config import get_settings
from gateway.metrics import get_metrics_app
from gateway.routers import (
    admin,
    auth,
    chat,
    chats,
    documents,
    health,
    metrics_summary,
    models,
)
from gateway.services.engine import LlamaCppClient
from gateway.services.model_registry import ModelRegistry
from gateway.services.queue_tracker import QueueTracker

log = structlog.get_logger()


def _configure_logging(log_level: str) -> None:
    import logging
    import sys

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level.upper(), logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    _configure_logging(settings.log_level)

    log.info("server_starting", backend=settings.inference_backend, model=settings.model_name)

    # Multi-model fleet — one llama.cpp backend per model, all pre-loaded.
    # engine_client stays for legacy code paths that don't pass a model name.
    app.state.model_registry = ModelRegistry(settings)
    app.state.engine_client = app.state.model_registry.get(settings.model_name)
    app.state.inference_backend = settings.inference_backend

    # In-memory queue tracker — always available, no external deps.
    app.state.queue_tracker = QueueTracker()

    # Redis client (optional — rate limiting, caching, users, log capture)
    app.state.redis_client = None
    app.state.cache = None
    app.state.users = None
    app.state.request_log = None
    app.state.chat_history = None
    app.state.rag = None
    try:
        import redis.asyncio as aioredis
        from gateway.services.cache import SemanticCache
        from gateway.services.chat_history import ChatHistory
        from gateway.services.rag import RAGStore
        from gateway.services.request_log import RequestLog
        from gateway.services.users import UserRegistry

        r = aioredis.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            decode_responses=True,
        )
        await r.ping()
        app.state.redis_client = r
        # Cache loads the embedding model; RAG borrows the same instance so
        # we don't keep two copies in memory.
        app.state.cache = await SemanticCache.create(r, settings)
        app.state.users = UserRegistry(r)
        app.state.request_log = RequestLog(r)
        app.state.chat_history = ChatHistory(r)
        app.state.rag = RAGStore(r, app.state.cache.model)
        log.info("redis_connected", host=settings.redis_host, port=settings.redis_port)
    except Exception as exc:
        log.warning("redis_unavailable", error=str(exc), detail="Running without cache, users, log capture, chat history, RAG")

    log.info("server_ready", port=8000)
    yield

    log.info("server_stopping")
    if app.state.redis_client is not None:
        await app.state.redis_client.aclose()


app = FastAPI(
    title="LLM Inference Server",
    description="OpenAI-compatible self-hosted LLM inference API",
    version="0.1.0",
    lifespan=lifespan,
)

# Mount Prometheus metrics — no auth required (internal scraping)
app.mount("/metrics", get_metrics_app())

# Routers
app.include_router(health.router)
app.include_router(chat.router, prefix="/v1")
app.include_router(models.router, prefix="/v1")
app.include_router(auth.router, prefix="/v1")
app.include_router(chats.router, prefix="/v1")
app.include_router(documents.router, prefix="/v1")
app.include_router(metrics_summary.router, prefix="/v1")
app.include_router(admin.router, prefix="/admin")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.error("unhandled_exception", path=str(request.url), error=str(exc))
    return JSONResponse(
        status_code=500,
        content={"error": {"message": "Internal server error", "type": "server_error"}},
    )


# Static frontend — mounted last so specific routes (/v1/*, /health, /metrics)
# take priority. html=True makes Starlette serve index.html for "/".
_STATIC_DIR = Path(__file__).parent / "static"
if _STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="frontend")
