"""User-facing /v1/metrics/summary.

Same payload as /admin/metrics/summary but accepts any authenticated user
(not only the ADMIN_API_KEY). Powers the workspace MetricsRail and the
workspace MetricsView — the single-tenant local server exposes its own
operating numbers to whoever's logged in.
"""

from typing import Any

from fastapi import APIRouter, Depends, Request

from gateway.middleware.auth import verify_api_key
from gateway.services.metrics_summary import build_summary

router = APIRouter(
    dependencies=[Depends(verify_api_key)],
    tags=["metrics"],
)


@router.get("/metrics/summary")
async def metrics_summary_user(request: Request) -> dict[str, Any]:
    return build_summary(request.app.state)
