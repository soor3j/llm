import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

# Set env vars before importing the app so pydantic-settings picks them up
os.environ.setdefault("API_KEY", "test-api-key-12345")
os.environ.setdefault("ENGINE_HOST", "localhost")
os.environ.setdefault("ENGINE_PORT", "8001")

from gateway.main import app  # noqa: E402


VALID_KEY = "test-api-key-12345"
INVALID_KEY = "wrong-key"


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    # Lifespan doesn't run in ASGI test transport — set up app.state manually
    mock_engine = MagicMock()
    mock_engine.health = AsyncMock(return_value=True)
    mock_engine.generate = AsyncMock(
        return_value={"content": "", "tokens_evaluated": 0, "tokens_predicted": 0}
    )

    app.state.engine_client = mock_engine
    app.state.inference_backend = "llamacpp"
    app.state.redis_client = None
    app.state.cache = None

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
