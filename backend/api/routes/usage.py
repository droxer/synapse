"""Token usage tracking routes."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from api.auth import AuthUser, common_dependencies, get_current_user
from api.dependencies import AppState, get_app_state, get_db_session

router = APIRouter(prefix="/usage", dependencies=common_dependencies)


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


@router.get("/conversation/{conversation_id}")
async def get_conversation_usage(
    conversation_id: str,
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
) -> dict:
    """Return token usage for a single conversation."""
    if state.usage_repo is None:
        raise HTTPException(status_code=501, detail="Usage tracking not available")

    try:
        conv_uuid = uuid.UUID(conversation_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid conversation ID") from None

    record = await state.usage_repo.get_conversation_usage(session, conv_uuid)
    if record is None:
        return {
            "conversation_id": conversation_id,
            "input_tokens": 0,
            "output_tokens": 0,
            "request_count": 0,
        }

    return {
        "conversation_id": str(record.conversation_id),
        "user_id": str(record.user_id) if record.user_id else None,
        "input_tokens": record.input_tokens,
        "output_tokens": record.output_tokens,
        "request_count": record.request_count,
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
    }


@router.get("/user")
async def get_user_usage(
    since: str | None = None,
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict:
    """Return aggregated token usage for the authenticated user."""
    if state.usage_repo is None:
        raise HTTPException(status_code=501, detail="Usage tracking not available")

    user_id = await _resolve_user_id(auth_user, state)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    since_dt: datetime | None = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid 'since' format (use ISO 8601)"
            ) from None

    summary = await state.usage_repo.get_user_usage(session, user_id, since=since_dt)
    return {
        "user_id": str(summary.user_id),
        "total_input_tokens": summary.total_input_tokens,
        "total_output_tokens": summary.total_output_tokens,
        "total_requests": summary.total_requests,
        "conversation_count": summary.conversation_count,
    }


@router.get("/user/conversations")
async def list_user_conversation_usage(
    limit: int = 20,
    offset: int = 0,
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict:
    """Return paginated per-conversation usage for the authenticated user."""
    if state.usage_repo is None:
        raise HTTPException(status_code=501, detail="Usage tracking not available")

    user_id = await _resolve_user_id(auth_user, state)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    records, total = await state.usage_repo.list_conversation_usage(
        session, user_id, limit=limit, offset=offset
    )
    return {
        "items": [
            {
                "conversation_id": str(r.conversation_id),
                "input_tokens": r.input_tokens,
                "output_tokens": r.output_tokens,
                "request_count": r.request_count,
                "created_at": r.created_at.isoformat(),
                "updated_at": r.updated_at.isoformat(),
            }
            for r in records
        ],
        "total": total,
    }
