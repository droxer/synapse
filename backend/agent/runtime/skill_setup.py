"""Helpers for staging and activating skills inside sandbox sessions."""

from __future__ import annotations

import os
import shlex
from pathlib import Path
from typing import Any

from loguru import logger

from agent.sandbox.base import SANDBOX_HOME_DIR
from agent.skills.models import SkillContent
from agent.tools.executor import ToolExecutor
from api.events import EventEmitter, EventType

_SKILL_SANDBOX_ROOT = f"{SANDBOX_HOME_DIR}/skills"
_SKIP_DIRS = frozenset(
    {
        ".git",
        "__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".venv",
        "venv",
        "node_modules",
    }
)
_MAX_FILES_PER_CATEGORY = 50


def skill_sandbox_dir(skill_name: str) -> str:
    """Return the canonical sandbox directory for *skill_name*."""
    return f"{_SKILL_SANDBOX_ROOT}/{skill_name}"


def build_skill_prompt_content(skill: SkillContent) -> str:
    """Return the injected prompt payload for an activated skill."""
    sandbox_dir = skill_sandbox_dir(skill.metadata.name)
    lines = [f'<skill_content name="{skill.metadata.name}">']
    lines.append(skill.instructions)
    lines.append("")
    lines.append(f"Sandbox skill directory: {sandbox_dir}")
    lines.append("Resolve execution paths against this sandbox directory.")
    lines.append(f"Host skill directory (reference only): {skill.directory_path}")
    resources = categorize_skill_resources(skill.directory_path)
    if any(resources.values()):
        lines.append("")
        lines.append("<skill_resources>")
        for category in ("scripts", "references", "assets"):
            files = resources.get(category, [])
            if files:
                lines.append(f"  <{category}>")
                for path in files[:_MAX_FILES_PER_CATEGORY]:
                    lines.append(f"    <file>{path}</file>")
                if len(files) > _MAX_FILES_PER_CATEGORY:
                    lines.append(
                        f"    <!-- {len(files) - _MAX_FILES_PER_CATEGORY} more files -->"
                    )
                lines.append(f"  </{category}>")
        other = resources.get("other", [])
        if other:
            lines.append("  <other>")
            for path in other[:_MAX_FILES_PER_CATEGORY]:
                lines.append(f"    <file>{path}</file>")
            lines.append("  </other>")
        lines.append("</skill_resources>")
    lines.append("</skill_content>")
    return "\n".join(lines)


def resolve_skill_template(
    executor: ToolExecutor,
    skill: SkillContent,
) -> str:
    """Resolve the template used to stage *skill*."""
    if skill.metadata.sandbox_template:
        return skill.metadata.sandbox_template
    if executor.sandbox_config is not None:
        return executor.sandbox_config.template
    return "default"


async def stage_skill_into_sandbox(
    executor: ToolExecutor,
    skill: SkillContent,
) -> str:
    """Upload *skill* into the sandbox and return its canonical path."""
    template = resolve_skill_template(executor, skill)
    skill_name = skill.metadata.name
    target_dir = skill_sandbox_dir(skill_name)

    if isinstance(executor, ToolExecutor) and executor.sandbox_provider is None:
        logger.info(
            "skill_staging_skipped_no_provider name={} template={}",
            skill_name,
            template,
        )
        return target_dir

    if executor.is_skill_staged(template, skill_name):
        return target_dir

    session = await executor.get_sandbox_session_for_template(template)
    mkdir_result = await session.exec(f"mkdir -p {shlex.quote(target_dir)}")
    if not mkdir_result.success:
        detail = mkdir_result.stderr or mkdir_result.stdout or "unknown error"
        raise RuntimeError(
            f"Failed to prepare skill directory '{target_dir}': {detail}"
        )

    for local_path, rel_path in _iter_skill_files(skill.directory_path):
        remote_path = f"{target_dir}/{rel_path}"
        remote_parent = os.path.dirname(remote_path)
        mkdir_parent = await session.exec(f"mkdir -p {shlex.quote(remote_parent)}")
        if not mkdir_parent.success:
            detail = mkdir_parent.stderr or mkdir_parent.stdout or "unknown error"
            raise RuntimeError(
                f"Failed to prepare skill subdirectory '{remote_parent}': {detail}"
            )
        await session.upload_file(str(local_path), remote_path)

    executor.mark_skill_staged(template, skill_name)
    logger.info(
        "skill_staged name={} template={} target_dir={}",
        skill_name,
        template,
        target_dir,
    )
    return target_dir


async def prepare_skill_for_turn(
    *,
    executor: ToolExecutor,
    skill: SkillContent,
    emitter: EventEmitter,
    source: str,
    install_dependencies: Any,
) -> str:
    """Stage skill resources and install dependencies for the current turn."""
    try:
        sandbox_dir = await stage_skill_into_sandbox(executor, skill)
    except Exception as exc:
        await emit_skill_setup_failed(
            emitter=emitter,
            skill_name=skill.metadata.name,
            phase="resources",
            error=str(exc),
            source=source,
        )
        raise RuntimeError(
            f"Failed to prepare skill '{skill.metadata.name}' resources: {exc}"
        ) from exc

    set_active_skill_directory = getattr(executor, "set_active_skill_directory", None)
    if callable(set_active_skill_directory):
        set_active_skill_directory(sandbox_dir)

    if skill.metadata.sandbox_template:
        executor.set_sandbox_template(skill.metadata.sandbox_template)
        logger.info(
            "skill_sandbox_template name={} template={}",
            skill.metadata.name,
            skill.metadata.sandbox_template,
        )

    if skill.metadata.dependencies:
        try:
            await install_dependencies()
        except Exception as exc:
            raise RuntimeError(
                f"Failed to install dependencies for skill "
                f"'{skill.metadata.name}': {exc}"
            ) from exc

    await emitter.emit(
        EventType.SKILL_ACTIVATED,
        {"name": skill.metadata.name, "source": source},
    )
    return sandbox_dir


async def emit_skill_setup_failed(
    *,
    emitter: EventEmitter,
    skill_name: str,
    phase: str,
    error: str,
    source: str,
    manager: str | None = None,
    packages: str | None = None,
) -> None:
    """Emit the unified skill setup failure event."""
    payload = {
        "name": skill_name,
        "phase": phase,
        "error": error,
        "source": source,
    }
    if manager:
        payload["manager"] = manager
    if packages:
        payload["packages"] = packages
    await emitter.emit(EventType.SKILL_SETUP_FAILED, payload)


def tool_use_had_error_result(messages: list[dict[str, Any]], tool_id: str) -> bool:
    """Return True if messages contain an ``is_error`` tool_result for ``tool_use_id``."""
    for msg in messages:
        if msg.get("role") != "user":
            continue
        msg_content = msg.get("content")
        if not isinstance(msg_content, list):
            continue
        for block in msg_content:
            if (
                isinstance(block, dict)
                and block.get("type") == "tool_result"
                and block.get("tool_use_id") == tool_id
                and block.get("is_error") is True
            ):
                return True
    return False


async def emit_redundant_skill_activation(
    emitter: EventEmitter,
    *,
    skill_name: str,
    tool_id: str | None,
    messages: list[dict[str, Any]],
) -> None:
    """Emit ``skill_activated`` when the model calls ``activate_skill`` for an already-active skill.

    Clients (e.g. the web UI) wait on this event to mark the skill row complete; without it,
    a redundant activation stays stuck in a loading state even though the tool already returned.
    """
    if tool_id is not None and tool_use_had_error_result(messages, tool_id):
        return
    await emitter.emit(
        EventType.SKILL_ACTIVATED,
        {"name": skill_name, "source": "already_active"},
    )


def categorize_skill_resources(directory: Path) -> dict[str, list[str]]:
    """Categorize non-SKILL.md skill resources by top-level directory."""
    categories: dict[str, list[str]] = {
        "scripts": [],
        "references": [],
        "assets": [],
        "other": [],
    }

    if not directory.is_dir():
        return categories

    for root, _dirs, files in os.walk(directory):
        for fname in sorted(files):
            if fname == "SKILL.md":
                continue
            rel = os.path.relpath(os.path.join(root, fname), directory)
            top_dir = rel.split(os.sep)[0] if os.sep in rel else None
            if top_dir in categories:
                categories[top_dir].append(rel)
            else:
                categories["other"].append(rel)

    return categories


def _iter_skill_files(skill_dir: Path) -> list[tuple[Path, str]]:
    """Return the files that should be staged for a skill bundle."""
    files: list[tuple[Path, str]] = []
    for root, dirs, filenames in os.walk(skill_dir):
        dirs[:] = sorted(d for d in dirs if d not in _SKIP_DIRS)
        for filename in sorted(filenames):
            local_path = Path(root) / filename
            rel_path = local_path.relative_to(skill_dir).as_posix()
            files.append((local_path, rel_path))
    return files
