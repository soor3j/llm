import time

import structlog
from fastapi import Depends, HTTPException, Request, status

from gateway.config import Settings, get_settings
from gateway.middleware.auth import verify_api_key

log = structlog.get_logger()


async def check_rate_limit(
    request: Request,
    api_key: str = Depends(verify_api_key),
    settings: Settings = Depends(get_settings),
) -> None:
    redis_client = getattr(request.app.state, "redis_client", None)
    if redis_client is None:
        return  # Redis not available — skip rate limiting gracefully

    key_hash = f"rate_limit:{api_key[:16]}"
    rpm = settings.rate_limit_rpm
    window = 60  # seconds

    try:
        pipe = redis_client.pipeline()
        now = time.time()
        window_start = now - window

        pipe.zremrangebyscore(key_hash, 0, window_start)
        pipe.zcard(key_hash)
        pipe.zadd(key_hash, {str(now): now})
        pipe.expire(key_hash, window)
        results = await pipe.execute()

        current_count = results[1]
        if current_count >= rpm:
            retry_after = int(window - (now - window_start))
            log.warning("rate_limit_exceeded", api_key_prefix=api_key[:8], count=current_count)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "message": f"Rate limit exceeded. Max {rpm} requests per minute.",
                    "type": "rate_limit_error",
                },
                headers={"Retry-After": str(max(retry_after, 1))},
            )
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("rate_limit_check_failed", error=str(exc))
