import json
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient

VALID_KEY = "test-api-key-12345"
AUTH = {"Authorization": f"Bearer {VALID_KEY}"}

CHAT_PAYLOAD = {
    "model": "mistral-7b",
    "messages": [{"role": "user", "content": "Say hello in 5 words."}],
    "max_tokens": 20,
}

ENGINE_RESPONSE = {
    "content": "Hello there, how are you?",
    "tokens_evaluated": 10,
    "tokens_predicted": 6,
}


@pytest.mark.anyio
async def test_chat_completion_returns_401_with_invalid_key(client: AsyncClient):
    response = await client.post(
        "/v1/chat/completions",
        json=CHAT_PAYLOAD,
        headers={"Authorization": "Bearer bad-key"},
    )
    assert response.status_code == 401


@pytest.mark.anyio
async def test_chat_completion_returns_401_with_no_auth_header(client: AsyncClient):
    response = await client.post("/v1/chat/completions", json=CHAT_PAYLOAD)
    assert response.status_code == 401


@pytest.mark.anyio
async def test_chat_completion_returns_200_with_valid_key(client: AsyncClient):
    # engine_client is the MagicMock set in conftest — configure the return value directly
    from gateway.main import app

    app.state.engine_client.generate = AsyncMock(return_value=ENGINE_RESPONSE)

    response = await client.post(
        "/v1/chat/completions",
        json=CHAT_PAYLOAD,
        headers=AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "chat.completion"
    assert body["choices"][0]["message"]["content"] == "Hello there, how are you?"
    assert body["choices"][0]["message"]["role"] == "assistant"
    assert "usage" in body


@pytest.mark.anyio
async def test_streaming_returns_sse_content_type(client: AsyncClient):
    tokens = ["Hello", " world", "!"]

    async def fake_stream(*args, **kwargs):
        for t in tokens:
            yield t

    from gateway.main import app

    app.state.engine_client.generate_stream = fake_stream

    response = await client.post(
        "/v1/chat/completions",
        json={**CHAT_PAYLOAD, "stream": True},
        headers=AUTH,
    )
    assert response.status_code == 200
    assert "text/event-stream" in response.headers.get("content-type", "")


@pytest.mark.anyio
async def test_streaming_yields_multiple_chunks(client: AsyncClient):
    tokens = ["Hello", " there", "!", " How", " are", " you", "?"]

    async def fake_stream(*args, **kwargs):
        for t in tokens:
            yield t

    from gateway.main import app

    app.state.engine_client.generate_stream = fake_stream

    response = await client.post(
        "/v1/chat/completions",
        json={**CHAT_PAYLOAD, "stream": True},
        headers=AUTH,
    )

    assert response.status_code == 200
    lines = [line for line in response.text.split("\n") if line.startswith("data: ")]

    # Last data line must be [DONE]
    assert lines[-1] == "data: [DONE]"

    # Collect all delta content tokens (skip opening role chunk and final stop chunk)
    token_chunks = []
    for line in lines[1:-2]:
        try:
            chunk = json.loads(line[6:])
            content = chunk["choices"][0]["delta"].get("content", "")
            if content:
                token_chunks.append(content)
        except (json.JSONDecodeError, KeyError):
            continue

    assert "".join(token_chunks) == "".join(tokens)


@pytest.mark.anyio
async def test_health_endpoint(client: AsyncClient):
    from gateway.main import app

    app.state.engine_client.health = AsyncMock(return_value=True)

    response = await client.get("/health")
    assert response.status_code in (200, 503)
    assert "status" in response.json()


@pytest.mark.anyio
async def test_models_endpoint_requires_auth(client: AsyncClient):
    response = await client.get("/v1/models")
    assert response.status_code == 401


@pytest.mark.anyio
async def test_models_endpoint_returns_model_list(client: AsyncClient):
    response = await client.get("/v1/models", headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "list"
    assert len(body["data"]) >= 1
    assert "id" in body["data"][0]
