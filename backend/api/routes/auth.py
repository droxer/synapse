"""Authentication endpoints — user sync on login and user profile/preferences."""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from api.auth.middleware import AuthUser, common_dependencies, get_current_user
from api.dependencies import AppState, get_app_state
from config.settings import get_settings

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=common_dependencies)

_VALID_THEMES = {"light", "dark", "system"}
_VALID_LOCALES = {"en", "zh-CN", "zh-TW"}
_NONCE_PATTERN = re.compile(r"^[A-Fa-f0-9]{32}$")
_DESKTOP_TOKEN_TTL_SECONDS = 120


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


class DesktopTokenStoreRequest(BaseModel):
    """Payload stored during desktop OAuth handoff."""

    nonce: str
    email: str
    name: str = ""
    image: str = ""
    googleId: str = ""

    @field_validator("nonce")
    @classmethod
    def validate_nonce(cls, value: str) -> str:
        if not _NONCE_PATTERN.fullmatch(value):
            raise ValueError("nonce must be a 32-character hexadecimal string")
        return value


def _desktop_nonce_key(nonce: str) -> str:
    return f"desktop-token:{nonce}"


async def _open_redis():
    """Open a Redis client for desktop auth token exchange."""
    from redis import asyncio as redis_asyncio

    return redis_asyncio.from_url(get_settings().REDIS_URL, decode_responses=True)


async def store_desktop_token(body: DesktopTokenStoreRequest) -> dict[str, bool]:
    """Store a short-lived desktop auth token payload."""
    client = await _open_redis()
    try:
        payload = {
            "email": body.email,
            "name": body.name,
            "image": body.image,
            "googleId": body.googleId,
        }
        await client.set(
            _desktop_nonce_key(body.nonce),
            json.dumps(payload),
            ex=_DESKTOP_TOKEN_TTL_SECONDS,
        )
    finally:
        await client.aclose()
    return {"ok": True}


async def consume_desktop_token(nonce: str) -> dict[str, object]:
    """Consume a single-use desktop auth token payload."""
    if not _NONCE_PATTERN.fullmatch(nonce):
        raise HTTPException(status_code=400, detail="Invalid nonce")

    client = await _open_redis()
    try:
        payload = await client.getdel(_desktop_nonce_key(nonce))
    finally:
        await client.aclose()

    if payload is None:
        raise HTTPException(status_code=404, detail="Desktop token pending")

    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=404, detail="Desktop token pending") from exc

    email = str(parsed.get("email", "")).strip()
    if not email:
        raise HTTPException(status_code=404, detail="Desktop token pending")

    return {
        "status": "complete",
        "user": {
            "email": email,
            "name": str(parsed.get("name", "")),
            "image": str(parsed.get("image", "")),
            "googleId": str(parsed.get("googleId", "")),
        },
    }


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
