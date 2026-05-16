import pytest
from httpx import AsyncClient


CHAT_PAYLOAD = {
    "model": "mistral-7b",
    "messages": [{"role": "user", "content": "hello"}],
    "max_tokens": 10,
}


@pytest.mark.anyio
async def test_missing_auth_header_returns_401(client: AsyncClient):
    response = await client.post("/v1/chat/completions", json=CHAT_PAYLOAD)
    assert response.status_code == 401


@pytest.mark.anyio
async def test_invalid_api_key_returns_401(client: AsyncClient):
    response = await client.post(
        "/v1/chat/completions",
        json=CHAT_PAYLOAD,
        headers={"Authorization": "Bearer wrong-key"},
    )
    assert response.status_code == 401


@pytest.mark.anyio
async def test_invalid_scheme_returns_401(client: AsyncClient):
    response = await client.post(
        "/v1/chat/completions",
        json=CHAT_PAYLOAD,
        headers={"Authorization": "Basic dXNlcjpwYXNz"},
    )
    assert response.status_code == 401


@pytest.mark.anyio
async def test_health_requires_no_auth(client: AsyncClient):
    response = await client.get("/health")
    # May be 200 or 503 depending on engine — but NOT 401
    assert response.status_code != 401


@pytest.mark.anyio
async def test_metrics_requires_no_auth(client: AsyncClient):
    response = await client.get("/metrics", follow_redirects=True)
    assert response.status_code == 200
