from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from gateway.config import get_settings
from gateway.metrics import get_metrics_app
from gateway.routers import chat, health, models
from gateway.services.engine import LlamaCppClient

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

    app.state.engine_client = LlamaCppClient(
        host=settings.engine_host,
        port=settings.engine_port,
    )
    app.state.inference_backend = settings.inference_backend

    # Redis client (optional — rate limiting + caching)
    app.state.redis_client = None
    app.state.cache = None
    try:
        import redis.asyncio as aioredis
        from gateway.services.cache import SemanticCache

        r = aioredis.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            decode_responses=True,
        )
        await r.ping()
        app.state.redis_client = r
        app.state.cache = await SemanticCache.create(r, settings)
        log.info("redis_connected", host=settings.redis_host, port=settings.redis_port)
    except Exception as exc:
        log.warning("redis_unavailable", error=str(exc), detail="Running without cache and rate limiting")

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


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.error("unhandled_exception", path=str(request.url), error=str(exc))
    return JSONResponse(
        status_code=500,
        content={"error": {"message": "Internal server error", "type": "server_error"}},
    )
