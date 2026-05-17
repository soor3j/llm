from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, Request

from gateway.config import Settings, get_settings
from gateway.middleware.auth import verify_api_key
from gateway.schemas import ModelInfo, ModelList

router = APIRouter(dependencies=[Depends(verify_api_key)])


@router.get("/models", response_model=ModelList)
async def list_models(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ModelList:
    engine = getattr(request.app.state, "engine_client", None)
    template = getattr(engine, "template_name", None) if engine else None
    model_file = PurePosixPath(settings.model_path).name if settings.model_path else None
    return ModelList(
        data=[
            ModelInfo(
                id=settings.model_name,
                context_length=settings.context_length,
                quantization="INT4",
                chat_template=template,
                model_file=model_file,
            )
        ]
    )
