"""Shared artifact auto-detection for sandbox tools.

Scans sandbox directories for newly created output files after tool
execution.  Used by ``code_run`` and ``shell_exec`` to discover
artifacts the LLM forgot to list explicitly.
"""

from __future__ import annotations

import os
import shlex
from typing import Any

from agent.sandbox.base import SANDBOX_HOME_DIR
from agent.tools.sandbox.constants import ARTIFACT_EXTENSIONS

# Directories scanned for auto-detected output files.
# Skills stage resources under ~/skills/, so we scan that in addition
# to the default /workspace working directory.
_SKILL_DIR = f"{SANDBOX_HOME_DIR}/skills"
DEFAULT_SEARCH_ROOTS: tuple[str, ...] = ("/workspace", _SKILL_DIR)

ArtifactSnapshot = dict[str, tuple[int, str]]


def _build_find_name_clauses() -> str:
    return " -o ".join(
        f"-name {shlex.quote('*' + ext)}" for ext in sorted(ARTIFACT_EXTENSIONS)
    )


def _build_find_roots(search_roots: tuple[str, ...]) -> str:
    return " ".join(shlex.quote(r) for r in search_roots)


async def snapshot_output_files(
    session: Any,
    *,
    search_roots: tuple[str, ...] = DEFAULT_SEARCH_ROOTS,
) -> ArtifactSnapshot:
    """Return current artifact candidates keyed by path.

    Snapshot values combine file size and mtime so callers can detect
    newly created files and files rewritten too quickly for ``find -newer``
    to notice on coarse-timestamp filesystems.
    """
    try:
        from agent.sandbox.base import ExecResult

        name_clauses = _build_find_name_clauses()
        roots = _build_find_roots(search_roots)
        find_cmd = (
            f"find {roots} -type f \\( {name_clauses} \\) "
            "-printf '%p\\t%s\\t%T@\\n' 2>/dev/null"
        )
        result = await session.exec(find_cmd)
        if not isinstance(result, ExecResult):
            return {}
        if not result.success or not result.stdout.strip():
            return {}

        snapshot: ArtifactSnapshot = {}
        for line in result.stdout.splitlines():
            path, sep, rest = line.partition("\t")
            if not sep:
                continue
            size_text, sep, mtime = rest.partition("\t")
            if not sep:
                continue
            try:
                snapshot[path.strip()] = (int(size_text.strip()), mtime.strip())
            except ValueError:
                continue
        return snapshot
    except Exception:
        return {}


async def find_new_output_files(
    session: Any,
    ts_marker: str,
    *,
    exclude_paths: tuple[str, ...] = (),
    search_roots: tuple[str, ...] = DEFAULT_SEARCH_ROOTS,
    before_snapshot: ArtifactSnapshot | None = None,
) -> list[str]:
    """Return paths of output-type files created after *ts_marker*.

    Scans *search_roots* for files with extensions in
    ``ARTIFACT_EXTENSIONS`` that are newer than the timestamp marker.
    Returns an empty list on any error so failures never break the
    main flow.

    Args:
        session: An active sandbox session.
        ts_marker: Path to a marker file touched before execution.
        exclude_paths: Paths (basenames) to exclude from results.
        search_roots: Directories to scan.
    """
    try:
        from agent.sandbox.base import ExecResult

        name_clauses = _build_find_name_clauses()
        roots = _build_find_roots(search_roots)
        find_cmd = (
            f"find {roots} -newer {shlex.quote(ts_marker)} -type f "
            f"\\( {name_clauses} \\) 2>/dev/null"
        )

        find_result = await session.exec(find_cmd)
        if not isinstance(find_result, ExecResult):
            return []
        if not find_result.success:
            return []

        exclude_basenames = frozenset(os.path.basename(p) for p in exclude_paths)
        candidates = [
            p.strip()
            for p in find_result.stdout.strip().splitlines()
            if p.strip() and os.path.basename(p.strip()) not in exclude_basenames
        ]

        if before_snapshot is not None:
            after_snapshot = await snapshot_output_files(
                session,
                search_roots=search_roots,
            )
            for path, fingerprint in after_snapshot.items():
                if os.path.basename(path) in exclude_basenames:
                    continue
                if path in exclude_paths:
                    continue
                if before_snapshot.get(path) != fingerprint:
                    candidates.append(path)

        seen: set[str] = set()
        result: list[str] = []
        for path in candidates:
            if path in seen:
                continue
            seen.add(path)
            result.append(path)
        return result
    except Exception:
        return []


def build_artifact_paths(
    explicit: list[str],
    auto_found: list[str],
    *,
    exclude_paths: tuple[str, ...] = (),
) -> list[str]:
    """Merge explicit and auto-detected artifact paths.

    Deduplicates results and excludes any paths whose basename matches
    *exclude_paths* (e.g. the script file itself).
    """
    exclude_basenames = frozenset(os.path.basename(p) for p in exclude_paths)

    seen: set[str] = set()
    result: list[str] = []

    for path in explicit + auto_found:
        path = path.strip()
        if not path:
            continue
        if os.path.basename(path) in exclude_basenames:
            continue
        if path in exclude_paths:
            continue
        if path not in seen:
            seen.add(path)
            result.append(path)

    return result
