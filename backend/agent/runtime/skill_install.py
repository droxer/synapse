"""Install skill sandbox dependencies with optional strict failure handling."""

from __future__ import annotations

from loguru import logger

from agent.runtime.skill_dependencies import (
    build_install_command,
    group_safe_dependencies,
)
from agent.tools.executor import ToolExecutor
from api.events import EventEmitter, EventType
from config.settings import get_settings


async def install_skill_dependencies_for_turn(
    executor: ToolExecutor,
    dependencies: tuple[str, ...],
    emitter: EventEmitter,
    *,
    context: str = "agent",
    skill_name: str | None = None,
    source: str | None = None,
    raise_on_error: bool = False,
) -> None:
    """Run pip/npm installs for *dependencies*.

    On failure: emits :data:`EventType.SKILL_DEPENDENCY_FAILED` and logs.
    If ``SKILL_DEPENDENCY_INSTALL_STRICT`` is enabled in settings, or
    ``raise_on_error`` is True, raises ``RuntimeError`` after the first
    failed install batch.
    """
    settings = get_settings()
    strict = settings.SKILL_DEPENDENCY_INSTALL_STRICT or raise_on_error
    by_manager = group_safe_dependencies(dependencies)

    for manager, packages in by_manager.items():
        packages_str = " ".join(packages)
        logger.info(
            "{}_auto_installing_skill_dependencies manager={} packages={}",
            context,
            manager,
            packages_str,
        )
        err_detail: str | None = None
        try:
            session = await executor.get_sandbox_session()
            result = await session.exec(
                build_install_command(manager, packages), timeout=120
            )

            if not result.success:
                err_detail = result.stderr or result.stdout or "unknown error"
                logger.error(
                    "{}_skill_dependency_install_failed manager={} packages={} error={}",
                    context,
                    manager,
                    packages_str,
                    err_detail,
                )
            else:
                logger.info(
                    "{}_skill_dependencies_installed manager={} packages={}",
                    context,
                    manager,
                    packages_str,
                )
                continue
        except Exception as exc:
            err_detail = str(exc)
            logger.error(
                "{}_skill_dependency_install_error manager={} packages={} error={}",
                context,
                manager,
                packages_str,
                exc,
            )

        await emitter.emit(
            EventType.SKILL_DEPENDENCY_FAILED,
            {
                "name": skill_name,
                "manager": manager,
                "packages": packages_str,
                "error": err_detail or "unknown error",
                "context": context,
                "source": source,
            },
        )
        if skill_name and source:
            await emitter.emit(
                EventType.SKILL_SETUP_FAILED,
                {
                    "name": skill_name,
                    "phase": "dependencies",
                    "manager": manager,
                    "packages": packages_str,
                    "error": err_detail or "unknown error",
                    "source": source,
                },
            )
        if strict:
            raise RuntimeError(
                f"Skill dependency install failed ({context}): "
                f"{manager} {packages_str}: {err_detail}"
            )
