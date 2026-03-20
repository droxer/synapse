"""Authentication endpoints — user sync on login."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.auth.middleware import AuthUser, common_dependencies, get_current_user
from api.dependencies import AppState, get_app_state

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=common_dependencies)


@router.post("/me")
async def sync_current_user(
    auth_user: AuthUser | None = Depends(get_current_user),
    state: AppState = Depends(get_app_state),
) -> dict:
    """Upsert the authenticated user record after login.

    Called by the frontend immediately after a successful Google OAuth sign-in
    to ensure a row exists in the users table.
    """
    if auth_user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    async with state.db_session_factory() as session:
        user = await state.user_repo.upsert_from_google(
            session,
            google_id=auth_user.google_id,
            email=auth_user.email,
            name=auth_user.name,
            picture=auth_user.picture,
        )

    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
    }
