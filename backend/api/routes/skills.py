"""Skill management route handlers."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from loguru import logger
from pydantic import BaseModel

from agent.skills.installer import SkillInstaller, UploadedFile as UploadedFileModel
from agent.skills.loader import SkillRegistry
from agent.skills.registry_client import SkillRegistryClient
from agent.state.repository import SkillRepository
from api.auth import AuthUser, common_dependencies, get_current_user
from api.dependencies import AppState, get_app_state, get_db_session
from api.routes.conversations import _resolve_user_id

router = APIRouter(prefix="/skills", dependencies=common_dependencies)

# Protects concurrent registry mutations (install / uninstall)
_registry_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SkillInstallRequest(BaseModel):
    """Body for POST /skills/install.

    The only required field is ``url`` (a GitHub repo URL).
    ``source`` is auto-detected from the URL when omitted.
    """

    url: str | None = None
    source: str | None = None  # "git", "url", or "registry" — auto-detected when absent
    name: str | None = None
    skill_path: str | None = None


class SkillResponse(BaseModel):
    """Skill detail response."""

    name: str
    description: str
    source_path: str
    source_type: str  # "bundled", "user", or "project"
    instructions: str | None = None
    enabled: bool = True
    activation_count: int = 0
    last_activated_at: str | None = None


class SkillListResponse(BaseModel):
    """Response for GET /skills."""

    skills: list[SkillResponse]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_skill_installer(state: AppState) -> SkillInstaller:
    """Retrieve the SkillInstaller from app state."""
    installer = getattr(state, "skill_installer", None)
    if installer is None:
        raise HTTPException(status_code=503, detail="Skills system not initialized")
    return installer


def _get_skill_repo(state: AppState) -> SkillRepository | None:
    """Retrieve the SkillRepository from app state (may be None)."""
    return getattr(state, "skill_repo", None)


def _get_skill_registry(state: AppState) -> SkillRegistry:
    """Retrieve the SkillRegistry from app state."""
    registry = getattr(state, "skill_registry", None)
    if registry is None:
        raise HTTPException(status_code=503, detail="Skills system not initialized")
    return registry


async def _sync_skill_to_db(
    state: AppState,
    session: Any,
    auth_user: AuthUser | None,
    skill: Any,
) -> None:
    """Persist a single installed skill to the database for the current user."""
    skill_repo = _get_skill_repo(state)
    if skill_repo is None:
        return
    user_id = await _resolve_user_id(auth_user, state)
    if user_id is None:
        return
    discovered = [
        (
            skill.metadata.name,
            skill.metadata.description,
            skill.source_type,
            str(skill.directory_path),
        )
    ]
    # Fetch existing user skills so sync_user_skills doesn't delete them
    existing_records = await skill_repo.list_skills(session, user_id=user_id)
    existing_user = [
        (r.name, r.description, r.source_type, r.source_path)
        for r in existing_records
        if r.user_id is not None
    ]
    # Merge existing with newly installed (new skill overwrites if same name)
    merged: dict[str, tuple[str, str, str, str]] = {t[0]: t for t in existing_user}
    merged[skill.metadata.name] = discovered[0]
    await skill_repo.sync_user_skills(session, user_id, list(merged.values()))


async def _remove_skill_from_db(
    state: AppState,
    session: Any,
    auth_user: AuthUser | None,
    skill_name: str,
) -> None:
    """Remove a skill from the database for the current user."""
    skill_repo = _get_skill_repo(state)
    if skill_repo is None:
        return
    user_id = await _resolve_user_id(auth_user, state)
    if user_id is None:
        return
    existing_records = await skill_repo.list_skills(session, user_id=user_id)
    remaining = [
        (r.name, r.description, r.source_type, r.source_path)
        for r in existing_records
        if r.user_id is not None and r.name != skill_name
    ]
    await skill_repo.sync_user_skills(session, user_id, remaining)


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------


@router.get("")
async def list_skills(
    state: AppState = Depends(get_app_state),
    session: Any = Depends(get_db_session),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    """GET /skills — list bundled + current user's skills with DB metadata."""
    registry = _get_skill_registry(state)
    skill_repo = _get_skill_repo(state)

    user_id = await _resolve_user_id(auth_user, state)

    # Lazily sync user-installed skills from disk to database on first list
    if skill_repo is not None and user_id is not None:
        user_skills_on_disk = [
            (
                s.metadata.name,
                s.metadata.description,
                s.source_type,
                str(s.directory_path),
            )
            for s in registry.all_skills()
            if s.source_type != "bundled"
        ]
        if user_skills_on_disk:
            await skill_repo.sync_user_skills(session, user_id, user_skills_on_disk)

    # Query DB for skills visible to this user (shared + user-owned)
    db_records: dict[str, Any] = {}
    if skill_repo is not None:
        for record in await skill_repo.list_skills(session, user_id=user_id):
            db_records[record.name] = record

    # Only include skills that exist in the DB for this user
    # (shared/bundled skills have user_id=NULL, user skills have user_id set)
    visible_names = set(db_records.keys()) if db_records else set()

    skills = []
    for skill in registry.all_skills():
        name = skill.metadata.name
        if visible_names and name not in visible_names:
            continue
        db_record = db_records.get(name)
        skills.append(
            SkillResponse(
                name=name,
                description=skill.metadata.description,
                source_path=str(skill.directory_path),
                source_type=skill.source_type,
                enabled=db_record.enabled if db_record else True,
                activation_count=db_record.activation_count if db_record else 0,
                last_activated_at=(
                    db_record.last_activated_at.isoformat()
                    if db_record and db_record.last_activated_at
                    else None
                ),
            )
        )

    return {"skills": [s.model_dump() for s in skills]}


@router.get("/registry/search")
async def search_registry(
    q: str,
    state: AppState = Depends(get_app_state),
) -> dict[str, Any]:
    """GET /skills/registry/search?q=... — search the remote skill registry."""
    installer = _get_skill_installer(state)

    from config.settings import get_settings

    settings = get_settings()
    client = SkillRegistryClient(
        registry_url=settings.SKILLS_REGISTRY_URL,
        installer=installer,
    )

    results = await client.search(q)
    return {
        "results": [{"name": r.name, "description": r.description} for r in results]
    }


@router.get("/{name}")
async def get_skill(
    name: str,
    state: AppState = Depends(get_app_state),
) -> dict[str, Any]:
    """GET /skills/{name} — get full skill detail."""
    registry = _get_skill_registry(state)

    skill = registry.find_by_name(name)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill '{name}' not found")

    return SkillResponse(
        name=skill.metadata.name,
        description=skill.metadata.description,
        source_path=str(skill.directory_path),
        source_type=skill.source_type,
        instructions=skill.instructions,
    ).model_dump()


def _detect_source(url: str) -> str:
    """Infer the install source type from a URL.

    GitHub / GitLab / Bitbucket URLs → "git", otherwise "url".
    """
    from urllib.parse import urlparse

    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    git_hosts = {"github.com", "gitlab.com", "bitbucket.org"}
    if host in git_hosts or url.endswith(".git"):
        return "git"
    return "url"


@router.post("/install", status_code=201)
async def install_skill(
    request: SkillInstallRequest,
    state: AppState = Depends(get_app_state),
    session: Any = Depends(get_db_session),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    """POST /skills/install — install a skill from git, URL, or registry.

    When only ``url`` is provided, the source type is auto-detected.
    """
    installer = _get_skill_installer(state)

    # Auto-detect source from URL when not explicitly provided
    source = request.source
    if source is None:
        if request.url:
            source = _detect_source(request.url)
        elif request.name:
            source = "registry"
        else:
            raise HTTPException(status_code=400, detail="url is required")

    try:
        if source == "git":
            if not request.url:
                raise HTTPException(
                    status_code=400, detail="url is required for git source"
                )
            skill = await installer.install_from_git(request.url, request.skill_path)

        elif source == "url":
            if not request.url:
                raise HTTPException(
                    status_code=400, detail="url is required for url source"
                )
            skill = await installer.install_from_url(request.url)

        elif source == "registry":
            if not request.name:
                raise HTTPException(
                    status_code=400, detail="name is required for registry source"
                )

            from config.settings import get_settings

            settings = get_settings()
            client = SkillRegistryClient(
                registry_url=settings.SKILLS_REGISTRY_URL,
                installer=installer,
            )
            skill = await client.install(request.name)

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid source: {source}. Must be 'git', 'url', or 'registry'",
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # Update the live registry under lock to prevent concurrent overwrites
    async with _registry_lock:
        registry = _get_skill_registry(state)
        state.skill_registry = registry.add_skill(skill)

    logger.info("Installed skill '{}' from {}", skill.metadata.name, source)

    # Persist to database for the current user
    await _sync_skill_to_db(state, session, auth_user, skill)

    return SkillResponse(
        name=skill.metadata.name,
        description=skill.metadata.description,
        source_path=str(skill.directory_path),
        source_type=skill.source_type,
    ).model_dump()


@router.post("/upload", status_code=201)
async def upload_skill(
    files: list[UploadFile],
    state: AppState = Depends(get_app_state),
    session: Any = Depends(get_db_session),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    """POST /skills/upload — install a skill from uploaded files (zip, SKILL.md, or folder)."""
    installer = _get_skill_installer(state)

    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    try:
        uploaded: list[UploadedFileModel] = []
        for f in files:
            data = await f.read()
            uploaded.append(
                UploadedFileModel(filename=f.filename or "unknown", data=data)
            )

        skill = await installer.install_from_upload(uploaded)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    async with _registry_lock:
        registry = _get_skill_registry(state)
        state.skill_registry = registry.add_skill(skill)

    logger.info("Installed skill '{}' from upload", skill.metadata.name)

    # Persist to database for the current user
    await _sync_skill_to_db(state, session, auth_user, skill)

    return SkillResponse(
        name=skill.metadata.name,
        description=skill.metadata.description,
        source_path=str(skill.directory_path),
        source_type=skill.source_type,
    ).model_dump()


@router.delete("/{name}")
async def uninstall_skill(
    name: str,
    state: AppState = Depends(get_app_state),
    session: Any = Depends(get_db_session),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, str]:
    """DELETE /skills/{name} — uninstall a user-installed skill."""
    registry = _get_skill_registry(state)
    installer = _get_skill_installer(state)

    # Check if skill exists
    skill = registry.find_by_name(name)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill '{name}' not found")

    # Don't allow uninstalling bundled skills
    if skill.source_type == "bundled":
        raise HTTPException(status_code=403, detail="Cannot uninstall bundled skills")

    removed = installer.uninstall(name)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Skill '{name}' not installed")

    async with _registry_lock:
        registry = _get_skill_registry(state)
        state.skill_registry = registry.remove_skill(name)

    # Remove from database
    await _remove_skill_from_db(state, session, auth_user, name)

    return {"detail": f"Skill '{name}' uninstalled"}


class SkillToggleRequest(BaseModel):
    """Body for PATCH /skills/{name}."""

    enabled: bool


@router.patch("/{name}")
async def toggle_skill(
    name: str,
    request: SkillToggleRequest,
    state: AppState = Depends(get_app_state),
    session: Any = Depends(get_db_session),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    """PATCH /skills/{name} — toggle a skill's enabled state."""
    skill_repo = _get_skill_repo(state)
    if skill_repo is None:
        raise HTTPException(status_code=503, detail="Skills system not initialized")

    user_id = await _resolve_user_id(auth_user, state)
    record = await skill_repo.set_enabled(
        session, name, request.enabled, user_id=user_id
    )
    if record is None:
        raise HTTPException(status_code=404, detail=f"Skill '{name}' not found")

    return {
        "name": record.name,
        "enabled": record.enabled,
    }
