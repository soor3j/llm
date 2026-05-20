"""Registration and login endpoints.

Real user accounts backed by Redis. Replaces (but stays compatible with)
the static API_KEY env-var auth in middleware/auth.py — the env-var key
still works as a master/admin token while registered users get their own
generated api_keys.
"""

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from gateway.middleware.auth import verify_api_key

log = structlog.get_logger()

router = APIRouter(tags=["auth"])
_bearer = HTTPBearer(auto_error=False)


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class AuthResponse(BaseModel):
    email: str
    api_key: str
    role: str


class MeResponse(BaseModel):
    email: str
    role: str
    api_key_masked: str
    created_at: int
    last_active: int


def _require_users(request: Request):
    users = getattr(request.app.state, "users", None)
    if users is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": "User registry unavailable (Redis required)",
                "type": "service_unavailable",
            },
        )
    return users


@router.post("/auth/register", response_model=AuthResponse, status_code=201)
async def register(req: RegisterRequest, request: Request) -> AuthResponse:
    users = _require_users(request)
    try:
        result = await users.register(req.email, req.password)
    except ValueError as exc:
        msg = str(exc)
        if "exists" in msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"message": msg, "type": "register_error"},
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": msg, "type": "register_error"},
        )
    return AuthResponse(**result)


@router.post("/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest, request: Request) -> AuthResponse:
    users = _require_users(request)
    result = await users.authenticate(req.email, req.password)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"message": "Invalid email or password", "type": "auth_error"},
        )
    return AuthResponse(**result)


def _mask(key: str) -> str:
    if not key:
        return ""
    return (key[:7] + "…" + key[-4:]) if len(key) > 12 else "…"


@router.get("/auth/me", response_model=MeResponse, dependencies=[Depends(verify_api_key)])
async def me(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> MeResponse:
    """Return the current Bearer-token holder's profile.

    The static API_KEY env var has no user account behind it, so this 404s
    in that case — only registered users can be looked up by api_key.
    """
    users = _require_users(request)
    token = credentials.credentials if credentials else ""
    email = await users.email_for_key(token)
    if email is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"message": "Authenticated, but this token isn't bound to a user account.", "type": "no_user"},
        )
    user = await users.get(email)
    if user is None:
        raise HTTPException(status_code=404, detail={"message": "User not found", "type": "no_user"})
    return MeResponse(
        email=user["email"],
        role=user["role"],
        api_key_masked=_mask(user["api_key"]),
        created_at=user["created_at"],
        last_active=user["last_active"],
    )


@router.post("/auth/rotate-key", response_model=AuthResponse, dependencies=[Depends(verify_api_key)])
async def rotate_key(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> AuthResponse:
    """Generate a new api_key for the authenticated user. Old key stops working immediately."""
    users = _require_users(request)
    token = credentials.credentials if credentials else ""
    email = await users.email_for_key(token)
    if email is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"message": "Cannot rotate the static API_KEY env var — only registered-user keys are rotatable.", "type": "forbidden"},
        )
    result = await users.rotate_key(email)
    if result is None:
        raise HTTPException(404, detail={"message": "User not found", "type": "no_user"})
    return AuthResponse(**result)
