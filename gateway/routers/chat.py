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


async def _finalize(
    app_state,
    *,
    trace_id: str,
    model: str,
    status_code: int,
    tokens: int,
    latency_ms: int,
    message: str,
    api_key_prefix: str | None = None,
) -> None:
    """Push completion to the queue tracker and a row to the request log.

    Always swallows internal errors — observability must not break the
    user-facing response.
    """
    tracker = getattr(app_state, "queue_tracker", None)
    if tracker is not None:
        try:
            tracker.complete(trace_id, status_code, tokens)
        except Exception:
            pass

    rl = getattr(app_state, "request_log", None)
    if rl is not None:
        try:
            await rl.record(
                status=status_code,
                latency_ms=latency_ms,
                model=model,
                trace_id=trace_id,
                message=message,
                level="info" if status_code < 400 else "error",
                api_key_prefix=api_key_prefix,
            )
        except Exception:
            pass


@router.post("/chat/completions", response_model=None)
async def chat_completions(
    request_body: ChatCompletionRequest,
    request: Request,
    api_key: str = Depends(verify_api_key),
    settings: Settings = Depends(get_settings),
):
    # Multi-model fleet — route to the backend that owns this model.
    # Falls back to the default engine_client if registry isn't initialized.
    registry = getattr(request.app.state, "model_registry", None)
    if registry is not None:
        engine = registry.get(request_body.model)
    else:
        engine = request.app.state.engine_client
    cache = getattr(request.app.state, "cache", None)
    tracker = getattr(request.app.state, "queue_tracker", None)
    model = request_body.model
    max_tokens = request_body.max_tokens or settings.max_tokens_default
    start_time = time.perf_counter()
    request_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"

    # --- RAG context injection ---------------------------------------
    # If the caller asked us to use their documents, retrieve the most
    # similar chunks for their latest user turn and prepend them as a
    # system message. We mutate request_body.messages in place so both the
    # streaming and non-streaming paths see the augmented conversation.
    if request_body.use_rag:
        rag = getattr(request.app.state, "rag", None)
        users = getattr(request.app.state, "users", None)
        last_user_msg = next(
            (m.content for m in reversed(request_body.messages) if m.role == "user"),
            None,
        )
        if rag is not None and last_user_msg:
            email = "__master__"
            if users is not None:
                try:
                    email = (await users.email_for_key(api_key)) or "__master__"
                except Exception:
                    pass
            try:
                hits = await rag.query(
                    email=email,
                    query_text=last_user_msg,
                    top_k=max(1, min(request_body.rag_top_k or 4, 8)),
                )
            except Exception as exc:
                log.warning("rag_query_failed", error=str(exc))
                hits = []
            if hits:
                from gateway.schemas import ChatMessage as _CM

                context_prompt = rag.build_context_prompt(hits)
                request_body.messages = [
                    _CM(role="system", content=context_prompt)
                ] + list(request_body.messages)
                log.info("rag_context_injected", model=model, hits=len(hits))

    # Mark this request as in-flight in the queue tracker.
    if tracker is not None:
        try:
            tracker.start(request_id, model)
        except Exception:
            pass

    if request_body.stream:
        return StreamingResponse(
            _stream_response(
                engine, request_body, request_id, model, max_tokens,
                start_time, request.app.state, api_key,
            ),
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
                await _finalize(
                    request.app.state,
                    trace_id=request_id, model=model, status_code=200,
                    tokens=0,
                    latency_ms=int((time.perf_counter() - start_time) * 1000),
                    message="chat.completions · cache hit",
                    api_key_prefix=api_key[:8],
                )
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
        await _finalize(
            request.app.state,
            trace_id=request_id, model=model, status_code=200,
            tokens=completion_tokens,
            latency_ms=int(elapsed * 1000),
            message="chat.completions",
            api_key_prefix=api_key[:8],
        )
        return response

    except httpx.HTTPError as exc:
        errors_total.labels(error_type="EngineConnectionError").inc()
        requests_total.labels(model=model, status_code=502).inc()
        log.error("engine_connection_error", error=str(exc), model=model)
        await _finalize(
            request.app.state,
            trace_id=request_id, model=model, status_code=502, tokens=0,
            latency_ms=int((time.perf_counter() - start_time) * 1000),
            message=f"engine error: {exc}",
            api_key_prefix=api_key[:8],
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"message": "Inference engine unavailable", "type": "engine_error"},
        ) from exc
    except Exception as exc:
        errors_total.labels(error_type=type(exc).__name__).inc()
        requests_total.labels(model=model, status_code=500).inc()
        log.error("inference_error", error=str(exc), model=model)
        await _finalize(
            request.app.state,
            trace_id=request_id, model=model, status_code=500, tokens=0,
            latency_ms=int((time.perf_counter() - start_time) * 1000),
            message=f"inference error: {exc}",
            api_key_prefix=api_key[:8],
        )
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
    app_state=None,
    api_key: str = "",
) -> AsyncGenerator[str, None]:
    first_token = True
    token_count = 0
    final_status = 200
    final_message = "chat.completions · stream"

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
        final_status = 500
        final_message = f"stream error: {exc}"

    finally:
        elapsed = time.perf_counter() - start_time
        if elapsed > 0 and token_count > 0:
            tokens_per_second.labels(model=model).set(token_count / elapsed)
        tokens_generated_total.labels(model=model).inc(token_count)
        requests_total.labels(model=model, status_code=final_status).inc()
        request_duration_seconds.labels(endpoint="/v1/chat/completions/stream").observe(elapsed)
        if app_state is not None:
            await _finalize(
                app_state,
                trace_id=request_id, model=model, status_code=final_status,
                tokens=token_count,
                latency_ms=int(elapsed * 1000),
                message=final_message,
                api_key_prefix=(api_key[:8] if api_key else None),
            )

    # Stop chunk + done sentinel
    stop_chunk = ChatCompletionChunk(
        id=request_id,
        model=model,
        choices=[StreamChoice(delta=Delta(), finish_reason="stop")],
    )
    yield format_sse(stop_chunk.model_dump())
    yield format_sse_done()
