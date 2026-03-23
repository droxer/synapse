"""Memory entry browsing and management routes."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select

from agent.memory.models import MemoryEntry
from api.auth import AuthUser, common_dependencies, get_current_user
from api.dependencies import AppState, get_app_state, get_db_session

router = APIRouter(prefix="/memory", dependencies=common_dependencies)


async def _resolve_user_id(
    auth_user: AuthUser | None,
    state: AppState,
) -> uuid.UUID | None:
    """Resolve a backend user UUID from the auth context."""
    if auth_user is None:
        return None
    async with state.db_session_factory() as session:
        existing = await state.user_repo.find_by_google_id(session, auth_user.google_id)
        return existing.id if existing else None


@router.get("")
async def list_memory_entries(
    limit: int = 20,
    offset: int = 0,
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict:
    """Return paginated memory entries for the authenticated user."""
    user_id = await _resolve_user_id(auth_user, state)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    base_filter = MemoryEntry.user_id == user_id

    count_stmt = select(func.count()).select_from(MemoryEntry).where(base_filter)
    total_result = await session.execute(count_stmt)
    total = total_result.scalar_one()

    stmt = (
        select(MemoryEntry)
        .where(base_filter)
        .order_by(MemoryEntry.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await session.execute(stmt)
    entries = result.scalars().all()

    return {
        "items": [
            {
                "id": str(e.id),
                "namespace": e.namespace,
                "key": e.key,
                "value": e.value,
                "scope": "conversation" if e.conversation_id else "global",
                "conversation_id": str(e.conversation_id)
                if e.conversation_id
                else None,
                "created_at": e.created_at.isoformat(),
                "updated_at": e.updated_at.isoformat(),
            }
            for e in entries
        ],
        "total": total,
    }


@router.delete("/{entry_id}")
async def delete_memory_entry(
    entry_id: str,
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict:
    """Delete a single memory entry by ID."""
    user_id = await _resolve_user_id(auth_user, state)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        entry_uuid = uuid.UUID(entry_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid entry ID") from None

    stmt = delete(MemoryEntry).where(
        MemoryEntry.id == entry_uuid, MemoryEntry.user_id == user_id
    )
    result = await session.execute(stmt)
    await session.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Memory entry not found")

    return {"deleted": True}
