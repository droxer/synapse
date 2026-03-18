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
from api.auth import common_dependencies
from api.dependencies import AppState, get_app_state

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


def _get_skill_registry(state: AppState) -> SkillRegistry:
    """Retrieve the SkillRegistry from app state."""
    registry = getattr(state, "skill_registry", None)
    if registry is None:
        raise HTTPException(status_code=503, detail="Skills system not initialized")
    return registry


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------


@router.get("")
async def list_skills(
    state: AppState = Depends(get_app_state),
) -> dict[str, Any]:
    """GET /skills — list all discovered skills with source info."""
    registry = _get_skill_registry(state)

    skills = []
    for skill in registry.all_skills():
        skills.append(
            SkillResponse(
                name=skill.metadata.name,
                description=skill.metadata.description,
                source_path=str(skill.directory_path),
                source_type=skill.source_type,
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
            raise HTTPException(
                status_code=400, detail="url is required"
            )

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

    return {"detail": f"Skill '{name}' uninstalled"}
