"""Health check endpoint for load balancer and monitoring."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import AppState, get_app_state, get_db_session

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check(
    state: AppState = Depends(get_app_state),
    session: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Health check endpoint for load balancers.

    Returns 200 OK if the service and database are healthy.
    """
    # Verify database connectivity
    await session.execute(text("SELECT 1"))

    return {"status": "healthy", "service": "synapse-api"}
