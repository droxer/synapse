"""Parser for SKILL.md files (YAML frontmatter + markdown body)."""

from __future__ import annotations

import os
from pathlib import Path
from types import MappingProxyType

import yaml
from loguru import logger

from agent.skills.models import SkillContent, SkillMetadata, validate_skill_name

# Standard frontmatter keys defined by the Agent Skills spec
_KNOWN_KEYS = frozenset(
    {
        "name",
        "description",
        "license",
        "compatibility",
        "allowed-tools",
        "dependencies",
        "sandbox-template",
        "metadata",
    }
)

# Deprecated keys — log warnings but don't fail
_DEPRECATED_KEYS = {
    "triggers": "triggers field is deprecated; use description-based activation instead",
    "custom_metadata": "custom_metadata is renamed to metadata",
}


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Split YAML frontmatter from the markdown body.

    Uses line-by-line detection of --- delimiters to avoid breaking
    on YAML content that contains --- as a value.

    Returns (frontmatter_dict, body_str). If no frontmatter is found,
    returns an empty dict and the full text as body.
    """
    lines = text.lstrip("\n").splitlines(keepends=True)
    if not lines or not lines[0].rstrip() == "---":
        return {}, text

    # Find closing --- (must be on its own line)
    end_line = None
    for i in range(1, len(lines)):
        if lines[i].rstrip() == "---":
            end_line = i
            break

    if end_line is None:
        return {}, text

    raw_yaml = "".join(lines[1:end_line])
    body = "".join(lines[end_line + 1 :]).lstrip("\n")

    parsed = yaml.safe_load(raw_yaml)
    if not isinstance(parsed, dict):
        return {}, text

    return parsed, body


def parse_skill_md(path: str) -> SkillContent:
    """Parse a SKILL.md file into a SkillContent object.

    Parameters
    ----------
    path:
        Absolute or relative path to a SKILL.md file.

    Returns
    -------
    SkillContent with parsed metadata and instructions.

    Raises
    ------
    FileNotFoundError if path does not exist.
    ValueError if description is missing (required by spec).
    """
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Skill file not found: {path}")

    with open(path, "r", encoding="utf-8") as fh:
        raw_text = fh.read()

    fm, body = parse_frontmatter(raw_text)
    directory_path = Path(os.path.dirname(os.path.abspath(path)))

    # Extract name — fall back to directory name
    name = fm.get("name", "")
    if not name:
        name = directory_path.name

    # Lenient: warn on name format mismatch but don't error
    if not validate_skill_name(name):
        logger.warning("Skill name '{}' does not match naming convention", name)

    # Warn on name/directory mismatch
    dir_name = directory_path.name
    if name != dir_name and dir_name not in (".", ""):
        logger.debug(
            "Skill name '{}' does not match directory name '{}'", name, dir_name
        )

    # Description is required by spec
    description = fm.get("description", "")
    if not description:
        raise ValueError(
            f"Skill '{name}' has no description (required by Agent Skills spec)"
        )

    # Log deprecation warnings for old fields
    for key, warning_msg in _DEPRECATED_KEYS.items():
        if key in fm:
            logger.warning("{} (in skill '{}')", warning_msg, name)

    # Parse compatibility — coerce old list format to string
    compatibility_raw = fm.get("compatibility")
    compatibility: str | None = None
    if isinstance(compatibility_raw, list):
        logger.warning(
            "Skill '{}': compatibility as list is deprecated, use a string", name
        )
        compatibility = ", ".join(str(item) for item in compatibility_raw)
    elif isinstance(compatibility_raw, str):
        compatibility = compatibility_raw

    # Parse allowed-tools — space-delimited string to tuple
    allowed_tools_raw = fm.get("allowed-tools", "")
    allowed_tools: tuple[str, ...] = ()
    if isinstance(allowed_tools_raw, str) and allowed_tools_raw.strip():
        allowed_tools = tuple(allowed_tools_raw.strip().split())

    # Parse dependencies — list of "manager:package" strings (e.g. "npm:pptxgenjs")
    dependencies_raw = fm.get("dependencies", [])
    dependencies: tuple[str, ...] = ()
    if isinstance(dependencies_raw, list):
        deps: list[str] = []
        for dep in dependencies_raw:
            dep_str = str(dep).strip()
            if dep_str:
                deps.append(dep_str)
        dependencies = tuple(deps)
    elif isinstance(dependencies_raw, str) and dependencies_raw.strip():
        dependencies = tuple(dependencies_raw.strip().split())

    # Parse sandbox-template — optional string
    sandbox_template_raw = fm.get("sandbox-template")
    sandbox_template: str | None = None
    if isinstance(sandbox_template_raw, str) and sandbox_template_raw.strip():
        sandbox_template = sandbox_template_raw.strip()

    # Parse metadata — coerce all values to str
    metadata_raw = fm.get("metadata", {})
    metadata_dict: dict[str, str] = {}
    if isinstance(metadata_raw, dict):
        metadata_dict = {str(k): str(v) for k, v in metadata_raw.items()}

    skill_metadata = SkillMetadata(
        name=name,
        description=description,
        license=fm.get("license", ""),
        compatibility=compatibility,
        allowed_tools=allowed_tools,
        dependencies=dependencies,
        sandbox_template=sandbox_template,
        metadata=MappingProxyType(metadata_dict),
    )

    return SkillContent(
        metadata=skill_metadata,
        instructions=body,
        directory_path=directory_path,
        source_type="unknown",  # Caller (discovery) sets the real value
    )
