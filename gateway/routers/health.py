from fastapi import APIRouter, Request

from gateway.schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    engine_client = request.app.state.engine_client
    engine_ok = await engine_client.health()
    return HealthResponse(
        status="ok" if engine_ok else "degraded",
        engine=request.app.state.inference_backend,
        model_loaded=engine_ok,
    )


@router.get("/health/full")
async def health_full(request: Request) -> dict:
    """Comprehensive health: every engine in the fleet + Redis.

    Used by the workspace footer to show real 'All systems healthy' state.
    Returns a dict so the frontend can render per-service detail.
    """
    state = request.app.state
    services: dict[str, bool] = {}

    # Each model backend
    registry = getattr(state, "model_registry", None)
    if registry is not None:
        for model_id in registry.list_models():
            try:
                services[f"engine:{model_id}"] = await registry.get(model_id).health()
            except Exception:
                services[f"engine:{model_id}"] = False
    else:
        try:
            services["engine"] = await state.engine_client.health()
        except Exception:
            services["engine"] = False

    # Redis (cache, users, history, rate limit, RAG all depend on it)
    redis_client = getattr(state, "redis_client", None)
    if redis_client is None:
        services["redis"] = False
    else:
        try:
            await redis_client.ping()
            services["redis"] = True
        except Exception:
            services["redis"] = False

    all_healthy = all(services.values())
    degraded = [name for name, ok in services.items() if not ok]
    return {
        "status": "ok" if all_healthy else "degraded",
        "services": services,
        "degraded": degraded,
    }
