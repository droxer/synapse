"""Skill file browsing endpoints — directory tree and file content."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse

from api.auth import AuthUser, common_dependencies, get_current_user
from api.dependencies import AppState, get_app_state
from api.routes.conversations import _resolve_user_id
from api.skill_scope import visible_skill_or_404

router = APIRouter(prefix="/skills", dependencies=common_dependencies)

# Directories to skip when building the file tree
_SKIP_DIRS = frozenset(
    {
        ".git",
        "__pycache__",
        "node_modules",
        ".venv",
        "venv",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "__pypackages__",
        ".tox",
        ".eggs",
    }
)

# Binary extensions to exclude from the tree
_BINARY_EXTS = frozenset(
    {
        ".ttf",
        ".woff",
        ".woff2",
        ".eot",
        ".otf",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".bmp",
        ".ico",
        ".webp",
        ".svg",
        ".pyc",
        ".pyo",
        ".so",
        ".dylib",
        ".dll",
        ".o",
        ".a",
        ".zip",
        ".tar",
        ".gz",
        ".bz2",
        ".xz",
        ".7z",
        ".rar",
        ".pdf",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
        ".exe",
        ".bin",
        ".dat",
        ".db",
        ".sqlite",
        ".mp3",
        ".mp4",
        ".wav",
        ".avi",
        ".mov",
    }
)

_MAX_DEPTH = 6
_MAX_FILES = 500
_MAX_FILE_SIZE = 1_048_576  # 1 MB


async def _resolve_skill_directory(
    name: str,
    state: AppState,
    auth_user: AuthUser | None,
) -> Path:
    """Look up a skill by name and return its directory path."""
    user_id = await _resolve_user_id(auth_user, state)
    skill = await visible_skill_or_404(state, name=name, user_id=user_id)
    return skill.directory_path


def _build_tree(
    root: str, depth: int = 0, counter: list[int] | None = None
) -> list[dict[str, Any]]:
    """Recursively build a file tree from *root*.

    Returns a list of nodes sorted: directories first, then alphabetical,
    with SKILL.md always first among files.
    """
    if counter is None:
        counter = [0]

    if depth > _MAX_DEPTH:
        return []

    try:
        entries = sorted(os.scandir(root), key=lambda e: e.name.lower())
    except PermissionError:
        return []

    dirs: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []

    for entry in entries:
        if counter[0] >= _MAX_FILES:
            break

        if entry.is_dir(follow_symlinks=False):
            if entry.name in _SKIP_DIRS:
                continue
            children = _build_tree(entry.path, depth + 1, counter)
            if children:  # Only include non-empty directories
                dirs.append(
                    {
                        "name": entry.name,
                        "path": _rel_path(entry.path, root, depth),
                        "type": "directory",
                        "children": children,
                    }
                )
        elif entry.is_file(follow_symlinks=False):
            ext = os.path.splitext(entry.name)[1].lower()
            if ext in _BINARY_EXTS:
                continue
            counter[0] += 1
            files.append(
                {
                    "name": entry.name,
                    "path": _rel_path(entry.path, root, depth),
                    "type": "file",
                }
            )

    # Sort files: SKILL.md first, then alphabetical
    files.sort(key=lambda f: (0 if f["name"] == "SKILL.md" else 1, f["name"].lower()))
    dirs.sort(key=lambda d: d["name"].lower())

    return dirs + files


def _rel_path(abs_path: str, tree_root: str, depth: int) -> str:
    """Compute a path relative to the skill directory root.

    For depth=0 entries the result is just the name. For deeper entries
    we walk up to find the skill root (the directory at depth 0).
    """
    # We always want paths relative to the *original* root passed to the
    # top-level _build_tree call, but _build_tree recurses with sub-dirs.
    # The simplest approach: always compute from the first parent at depth 0.
    return os.path.relpath(abs_path, _find_tree_root(abs_path, depth))


def _find_tree_root(path: str, depth: int) -> str:
    """Walk *depth* levels up from *path*'s parent to find the tree root."""
    p = os.path.dirname(path)
    for _ in range(depth):
        p = os.path.dirname(p)
    return p


@router.get("/{name}/files")
async def list_skill_files(
    name: str,
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """GET /skills/{name}/files — return the skill's directory tree as JSON."""
    skill_dir = await _resolve_skill_directory(name, state, auth_user)
    if not skill_dir.is_dir():
        return []
    return _build_tree(str(skill_dir))


@router.get("/{name}/files/{path:path}")
async def get_skill_file(
    name: str,
    path: str,
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> PlainTextResponse:
    """GET /skills/{name}/files/{path} — return a single file's content as text/plain."""
    skill_dir = await _resolve_skill_directory(name, state, auth_user)

    # Resolve and validate the requested path
    requested = (skill_dir / path).resolve()
    skill_dir_resolved = skill_dir.resolve()

    # Security: prevent directory traversal
    try:
        requested.relative_to(skill_dir_resolved)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path traversal not allowed")

    if not requested.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    # Check file size
    file_size = requested.stat().st_size
    if file_size > _MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (>1MB)")

    try:
        content = requested.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=415, detail="Binary file cannot be displayed as text"
        )

    return PlainTextResponse(content)
