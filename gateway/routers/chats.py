"""CRUD endpoints for the chat-history sidebar in the workspace.

    GET    /v1/chats                list the current user's conversations
    POST   /v1/chats                create a new conversation
    GET    /v1/chats/{chat_id}      fetch full message log
    PATCH  /v1/chats/{chat_id}      update messages and/or title
    DELETE /v1/chats/{chat_id}      remove

Auth: the caller's email is resolved from their Bearer token via
UserRegistry. Every read/write checks ownership before returning data.
"""

from __future__ import annotations

from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from gateway.middleware.auth import verify_api_key
from gateway.schemas import ChatMessage

log = structlog.get_logger()

router = APIRouter(
    dependencies=[Depends(verify_api_key)],
    tags=["chats"],
)
_bearer = HTTPBearer(auto_error=False)


# -------- schemas --------

class ChatSummary(BaseModel):
    id: str
    title: str
    created_at: int
    updated_at: int
    message_count: int


class ChatDetail(ChatSummary):
    messages: list[ChatMessage] = Field(default_factory=list)


class ChatCreate(BaseModel):
    title: Optional[str] = None
    messages: Optional[list[ChatMessage]] = None


class ChatUpdate(BaseModel):
    title: Optional[str] = None
    messages: Optional[list[ChatMessage]] = None


class ChatListResponse(BaseModel):
    object: str = "list"
    data: list[ChatSummary]


# -------- helpers --------

async def _current_email(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
) -> str:
    """Resolve the email associated with the caller's Bearer token.

    The static API_KEY env var is the master and isn't tied to a user
    account — for that path we fall back to a sentinel "__master__"
    inbox so the admin can still test the chat-history feature.
    """
    if credentials is None:
        raise HTTPException(401, detail={"message": "Missing token", "type": "auth_error"})

    token = credentials.credentials
    users = getattr(request.app.state, "users", None)
    if users is not None:
        try:
            email = await users.email_for_key(token)
        except Exception:
            email = None
        if email:
            return email.lower()

    # Master/admin static key falls back to a reserved inbox so the
    # endpoint still works end-to-end during development.
    return "__master__"


def _require_history(request: Request):
    history = getattr(request.app.state, "chat_history", None)
    if history is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"message": "Chat history unavailable (Redis required)", "type": "service_unavailable"},
        )
    return history


async def _owned_by(history, chat_id: str, email: str) -> str:
    owner = await history.owner_of(chat_id)
    if owner is None:
        raise HTTPException(404, detail={"message": "Chat not found", "type": "not_found"})
    if owner.lower() != email.lower():
        # Don't leak existence — same 404 for "not yours" as for "doesn't exist".
        raise HTTPException(404, detail={"message": "Chat not found", "type": "not_found"})
    return owner


# -------- routes --------

@router.get("/chats", response_model=ChatListResponse)
async def list_chats(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    limit: int = 50,
) -> ChatListResponse:
    email = await _current_email(request, credentials)
    history = _require_history(request)
    rows = await history.list(email, limit=min(max(limit, 1), 200))
    return ChatListResponse(data=[ChatSummary(**r) for r in rows])


@router.post("/chats", response_model=ChatDetail, status_code=201)
async def create_chat(
    payload: ChatCreate,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> ChatDetail:
    email = await _current_email(request, credentials)
    history = _require_history(request)
    raw_msgs = [m.model_dump() for m in payload.messages] if payload.messages else None
    chat = await history.create(email, title=payload.title, messages=raw_msgs)
    return ChatDetail(**chat)


@router.get("/chats/{chat_id}", response_model=ChatDetail)
async def get_chat(
    chat_id: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> ChatDetail:
    email = await _current_email(request, credentials)
    history = _require_history(request)
    await _owned_by(history, chat_id, email)
    chat = await history.get(chat_id)
    return ChatDetail(**chat)


@router.patch("/chats/{chat_id}", response_model=ChatDetail)
async def update_chat(
    chat_id: str,
    payload: ChatUpdate,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> ChatDetail:
    email = await _current_email(request, credentials)
    history = _require_history(request)
    await _owned_by(history, chat_id, email)
    raw_msgs = [m.model_dump() for m in payload.messages] if payload.messages else None
    chat = await history.update(chat_id, messages=raw_msgs, title=payload.title)
    if chat is None:
        raise HTTPException(404, detail={"message": "Chat not found", "type": "not_found"})
    return ChatDetail(**chat)


@router.delete("/chats/{chat_id}")
async def delete_chat(
    chat_id: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    email = await _current_email(request, credentials)
    history = _require_history(request)
    await _owned_by(history, chat_id, email)
    deleted = await history.delete(chat_id)
    return {"deleted": deleted, "id": chat_id}
