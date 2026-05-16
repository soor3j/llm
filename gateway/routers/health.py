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
