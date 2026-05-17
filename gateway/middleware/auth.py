"""Bearer-token authentication.

Two paths are accepted:

    1. The static API_KEY env var (master token, always works).
    2. A registered user's generated api_key (looked up in Redis via
       app.state.users when available).

Admin endpoints additionally require ADMIN_API_KEY (or, if unset, the
plain API_KEY). User-registry keys do NOT grant admin access — that's
reserved for the operator-controlled env var.
"""

import secrets

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from gateway.config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"message": message, "type": "auth_error"},
        headers={"WWW-Authenticate": "Bearer"},
    )


async def verify_api_key(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> str:
    """Accept either the static API_KEY or a registered user's api_key."""
    if credentials is None:
        raise _unauthorized("Missing Authorization header")

    token = credentials.credentials

    # Path 1: static env-var key — constant-time comparison.
    if secrets.compare_digest(token, settings.api_key):
        return token

    # Path 2: a registered user's generated api_key.
    users = getattr(request.app.state, "users", None)
    if users is not None:
        try:
            email = await users.email_for_key(token)
        except Exception:
            email = None
        if email is not None:
            # Refresh last-active best-effort; never block the request.
            try:
                await users.touch_last_active(email)
            except Exception:
                pass
            return token

    raise _unauthorized("Invalid API key")


def verify_admin_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> str:
    """Only accept ADMIN_API_KEY (falls back to API_KEY if admin is unset)."""
    expected = settings.admin_api_key or settings.api_key
    if credentials is None or not secrets.compare_digest(
        credentials.credentials, expected
    ):
        raise _unauthorized("Invalid admin API key")
    return credentials.credentials
