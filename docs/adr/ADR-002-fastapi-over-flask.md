# ADR-002: FastAPI over Flask

**Status:** Accepted  
**Date:** 2026-05-15

## Context

The gateway service handles chat completion requests, including long-lived Server-Sent Events (SSE)
streams where tokens are yielded one at a time over HTTP. We need a Python web framework.

## Decision

Use FastAPI with uvicorn (async ASGI server).

## Consequences

**Positive:**
- Native `async`/`await` throughout — no thread pool needed for concurrent SSE streams
- `StreamingResponse` with async generators integrates directly with `asyncio.Queue` and the llama.cpp HTTP stream
- Pydantic v2 models are first-class — request validation, serialization, and OpenAPI docs generated automatically
- `Depends()` injection system makes auth and rate-limit middleware composable and testable in isolation
- `app.mount()` allows attaching the Prometheus ASGI app at `/metrics` without a separate process

**Negative:**
- Async context requires careful discipline — any blocking call in the request path starves the event loop
- Slightly steeper learning curve than Flask for developers unfamiliar with async Python

**Mitigation:**
All I/O uses `httpx.AsyncClient`. The llama.cpp client, Redis client, and sentence-transformers embedding
are all called with `await` or run at startup. Blocking calls are explicitly forbidden in the project coding rules.
