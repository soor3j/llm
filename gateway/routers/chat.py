import time
import uuid
from collections.abc import AsyncGenerator

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from gateway.config import Settings, get_settings
from gateway.metrics import (
    cache_hits_total,
    cache_misses_total,
    errors_total,
    request_duration_seconds,
    requests_total,
    tokens_generated_total,
    tokens_per_second,
    ttft_seconds,
)
from gateway.middleware.auth import verify_api_key
from gateway.middleware.rate_limit import check_rate_limit
from gateway.schemas import (
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    Choice,
    Delta,
    Message,
    StreamChoice,
    Usage,
)
from gateway.services.streaming import format_sse, format_sse_done

log = structlog.get_logger()

router = APIRouter(dependencies=[Depends(verify_api_key), Depends(check_rate_limit)])


@router.post("/chat/completions", response_model=None)
async def chat_completions(
    request_body: ChatCompletionRequest,
    request: Request,
    api_key: str = Depends(verify_api_key),
    settings: Settings = Depends(get_settings),
):
    engine = request.app.state.engine_client
    cache = getattr(request.app.state, "cache", None)
    model = request_body.model
    max_tokens = request_body.max_tokens or settings.max_tokens_default
    start_time = time.perf_counter()
    request_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"

    if request_body.stream:
        return StreamingResponse(
            _stream_response(engine, request_body, request_id, model, max_tokens, start_time),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Non-streaming — try semantic cache first
    try:
        if cache is not None:
            cached = await cache.lookup(request_body.messages)
            if cached is not None:
                cache_hits_total.labels(model=model).inc()
                requests_total.labels(model=model, status_code=200).inc()
                log.info("cache_hit", model=model, api_key_prefix=api_key[:8])
                return ChatCompletionResponse(**cached)

        raw = await engine.generate(
            messages=request_body.messages,
            max_tokens=max_tokens,
            temperature=request_body.temperature,
            top_p=request_body.top_p,
        )

        completion_text = raw.get("content", "")
        prompt_tokens = raw.get("tokens_evaluated", 0)
        completion_tokens = raw.get("tokens_predicted", len(completion_text.split()))
        elapsed = time.perf_counter() - start_time

        tokens_generated_total.labels(model=model).inc(completion_tokens)
        if elapsed > 0:
            tokens_per_second.labels(model=model).set(completion_tokens / elapsed)
        request_duration_seconds.labels(endpoint="/v1/chat/completions").observe(elapsed)
        requests_total.labels(model=model, status_code=200).inc()

        response = ChatCompletionResponse(
            id=request_id,
            model=model,
            choices=[Choice(message=Message(content=completion_text))],
            usage=Usage(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
            ),
        )

        if cache is not None:
            cache_misses_total.labels(model=model).inc()
            await cache.store(request_body.messages, response.model_dump())

        log.info(
            "inference_complete",
            model=model,
            tokens=completion_tokens,
            latency_ms=round(elapsed * 1000, 1),
            api_key_prefix=api_key[:8],
        )
        return response

    except httpx.HTTPError as exc:
        errors_total.labels(error_type="EngineConnectionError").inc()
        requests_total.labels(model=model, status_code=502).inc()
        log.error("engine_connection_error", error=str(exc), model=model)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"message": "Inference engine unavailable", "type": "engine_error"},
        ) from exc
    except Exception as exc:
        errors_total.labels(error_type=type(exc).__name__).inc()
        requests_total.labels(model=model, status_code=500).inc()
        log.error("inference_error", error=str(exc), model=model)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": "Internal server error", "type": "inference_error"},
        ) from exc


async def _stream_response(
    engine,
    request_body: ChatCompletionRequest,
    request_id: str,
    model: str,
    max_tokens: int,
    start_time: float,
) -> AsyncGenerator[str, None]:
    first_token = True
    token_count = 0

    # Opening role delta
    opening = ChatCompletionChunk(
        id=request_id,
        model=model,
        choices=[StreamChoice(delta=Delta(role="assistant"), finish_reason=None)],
    )
    yield format_sse(opening.model_dump())

    try:
        async for token in engine.generate_stream(
            messages=request_body.messages,
            max_tokens=max_tokens,
            temperature=request_body.temperature,
            top_p=request_body.top_p,
        ):
            if first_token:
                ttft_seconds.labels(model=model).observe(time.perf_counter() - start_time)
                first_token = False

            token_count += 1
            chunk = ChatCompletionChunk(
                id=request_id,
                model=model,
                choices=[StreamChoice(delta=Delta(content=token), finish_reason=None)],
            )
            yield format_sse(chunk.model_dump())

    except Exception as exc:
        errors_total.labels(error_type=type(exc).__name__).inc()
        log.error("stream_error", error=str(exc), model=model)

    finally:
        elapsed = time.perf_counter() - start_time
        if elapsed > 0 and token_count > 0:
            tokens_per_second.labels(model=model).set(token_count / elapsed)
        tokens_generated_total.labels(model=model).inc(token_count)
        requests_total.labels(model=model, status_code=200).inc()
        request_duration_seconds.labels(endpoint="/v1/chat/completions/stream").observe(elapsed)

    # Stop chunk + done sentinel
    stop_chunk = ChatCompletionChunk(
        id=request_id,
        model=model,
        choices=[StreamChoice(delta=Delta(), finish_reason="stop")],
    )
    yield format_sse(stop_chunk.model_dump())
    yield format_sse_done()
