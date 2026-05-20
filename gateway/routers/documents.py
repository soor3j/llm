"""RAG document management endpoints.

    POST   /v1/documents           upload (paste text)
    GET    /v1/documents           list the user's documents
    DELETE /v1/documents/{doc_id}  remove a document and its chunks

Each document is chunked, embedded with the same sentence-transformer model
the semantic cache uses, and stored per-user in Redis. The chat router
queries this store when ``use_rag`` is set on a request.
"""

from __future__ import annotations

from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from gateway.middleware.auth import verify_api_key

log = structlog.get_logger()

router = APIRouter(
    dependencies=[Depends(verify_api_key)],
    tags=["documents"],
)
_bearer = HTTPBearer(auto_error=False)


# -------- schemas --------

class DocumentInfo(BaseModel):
    id: str
    name: str
    content_type: str = "text/plain"
    uploaded_at: int
    size_bytes: int
    text_length: int
    chunk_count: int


class DocumentList(BaseModel):
    object: str = "list"
    data: list[DocumentInfo]


class DocumentUpload(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1)
    content_type: str = "text/plain"


# -------- helpers --------

async def _current_email(request: Request, credentials) -> str:
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
    return "__master__"


def _require_rag(request: Request):
    rag = getattr(request.app.state, "rag", None)
    if rag is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": "Document store unavailable (Redis + embedding model required)",
                "type": "service_unavailable",
            },
        )
    return rag


# -------- routes --------

@router.get("/documents", response_model=DocumentList)
async def list_documents(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    limit: int = 100,
) -> DocumentList:
    email = await _current_email(request, credentials)
    rag = _require_rag(request)
    rows = await rag.list(email, limit=min(max(limit, 1), 500))
    return DocumentList(data=[DocumentInfo(**r) for r in rows])


@router.post("/documents", response_model=DocumentInfo, status_code=201)
async def upload_document(
    payload: DocumentUpload,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> DocumentInfo:
    email = await _current_email(request, credentials)
    rag = _require_rag(request)
    try:
        result = await rag.upload(
            email=email,
            name=payload.name,
            text=payload.text,
            content_type=payload.content_type,
        )
    except ValueError as exc:
        raise HTTPException(400, detail={"message": str(exc), "type": "upload_error"})
    return DocumentInfo(**result)


@router.delete("/documents/{doc_id}")
async def delete_document(
    doc_id: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    email = await _current_email(request, credentials)
    rag = _require_rag(request)
    ok = await rag.delete(email, doc_id)
    if not ok:
        raise HTTPException(404, detail={"message": "Document not found", "type": "not_found"})
    return {"deleted": True, "id": doc_id}
