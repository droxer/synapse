"""Authentication endpoints — user sync on login and user profile/preferences."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from api.auth.middleware import AuthUser, common_dependencies, get_current_user
from api.dependencies import AppState, get_app_state

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=common_dependencies)

_VALID_THEMES = {"light", "dark", "system"}
_VALID_LOCALES = {"en", "zh-CN", "zh-TW"}


def _user_response(user) -> dict:
    """Build a consistent user response dict."""
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "theme": user.theme,
        "locale": user.locale,
    }


class PreferencesUpdate(BaseModel):
    """Request body for updating user preferences."""

    theme: str | None = None
    locale: str | None = None

    @field_validator("theme")
    @classmethod
    def validate_theme(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_THEMES:
            raise ValueError(f"theme must be one of {_VALID_THEMES}")
        return v

    @field_validator("locale")
    @classmethod
    def validate_locale(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_LOCALES:
            raise ValueError(f"locale must be one of {_VALID_LOCALES}")
        return v


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

    return _user_response(user)


# ---------------------------------------------------------------------------
# User profile & preferences — mounted on /user/* to avoid NextAuth conflict
# on /api/auth/* in the frontend proxy.
# ---------------------------------------------------------------------------

user_router = APIRouter(prefix="/user", tags=["user"], dependencies=common_dependencies)


@user_router.get("/me")
async def get_current_user_profile(
    auth_user: AuthUser | None = Depends(get_current_user),
    state: AppState = Depends(get_app_state),
) -> dict:
    """Return the current user's profile including preferences."""
    if auth_user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    async with state.db_session_factory() as session:
        user = await state.user_repo.find_by_google_id(session, auth_user.google_id)

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return _user_response(user)


@user_router.patch("/me/preferences")
async def update_preferences(
    body: PreferencesUpdate,
    auth_user: AuthUser | None = Depends(get_current_user),
    state: AppState = Depends(get_app_state),
) -> dict:
    """Update theme and/or locale preferences for the authenticated user."""
    if auth_user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    if body.theme is None and body.locale is None:
        raise HTTPException(status_code=400, detail="No preferences to update")

    async with state.db_session_factory() as session:
        user = await state.user_repo.update_preferences(
            session,
            google_id=auth_user.google_id,
            theme=body.theme,
            locale=body.locale,
        )

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return _user_response(user)
