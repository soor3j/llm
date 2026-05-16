from fastapi import APIRouter, Depends

from gateway.config import Settings, get_settings
from gateway.middleware.auth import verify_api_key
from gateway.schemas import ModelInfo, ModelList

router = APIRouter(dependencies=[Depends(verify_api_key)])


@router.get("/models", response_model=ModelList)
async def list_models(settings: Settings = Depends(get_settings)) -> ModelList:
    return ModelList(
        data=[
            ModelInfo(
                id=settings.model_name,
                context_length=settings.context_length,
                quantization="INT4",
            )
        ]
    )
