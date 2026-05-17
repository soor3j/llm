"""Registration and login endpoints.

Real user accounts backed by Redis. Replaces (but stays compatible with)
the static API_KEY env-var auth in middleware/auth.py — the env-var key
still works as a master/admin token while registered users get their own
generated api_keys.
"""

import structlog
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

log = structlog.get_logger()

router = APIRouter(tags=["auth"])


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
