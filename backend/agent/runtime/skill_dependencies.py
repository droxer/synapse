"""Helpers for safe skill dependency installation."""

from __future__ import annotations

import re
import shlex

from loguru import logger

_SUPPORTED_MANAGERS = {"pip", "npm"}
_SAFE_DEPENDENCY_RE = re.compile(r"^[A-Za-z0-9._/@<>=!~+,:\-\[\]]+$")


def group_safe_dependencies(dependencies: tuple[str, ...]) -> dict[str, list[str]]:
    """Parse dependencies, dropping unsupported or unsafe entries."""
    grouped: dict[str, list[str]] = {}
    for dep in dependencies:
        if ":" in dep:
            manager, package = dep.split(":", 1)
        else:
            manager, package = "pip", dep

        manager = manager.strip().lower()
        package = package.strip()

        if manager not in _SUPPORTED_MANAGERS:
            logger.warning("unknown_dependency_manager manager={}", manager)
            continue

        if (
            not package
            or package.startswith("-")
            or not _SAFE_DEPENDENCY_RE.fullmatch(package)
        ):
            logger.warning(
                "unsafe_skill_dependency_skipped manager={} package={}",
                manager,
                package,
            )
            continue

        grouped.setdefault(manager, []).append(package)

    return grouped


def build_install_command(manager: str, packages: list[str]) -> str:
    """Build a shell-safe installation command for validated packages."""
    package_args = " ".join(shlex.quote(package) for package in packages)
    if manager == "pip":
        return f"pip install {package_args}"
    if manager == "npm":
        return f"npm install {package_args}"
    raise ValueError(f"Unsupported dependency manager: {manager}")
