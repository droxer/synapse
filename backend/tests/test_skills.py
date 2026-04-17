"""Tests for the agent skills system (models, parser, discovery, registry, activate_skill)."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest.mock
import zipfile
from pathlib import Path
from types import MappingProxyType

import pytest

from agent.runtime.skill_setup import _iter_skill_files, categorize_skill_resources
from agent.skills.models import (
    SkillCatalogEntry,
    SkillContent,
    SkillMetadata,
    validate_skill_name,
)
from agent.skills.parser import parse_frontmatter, parse_skill_md
from agent.skills.discovery import SkillDiscoverer, _scan_directory
from agent.skills.loader import SkillRegistry
from agent.tools.local.activate_skill import ActivateSkill


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------


class TestValidateSkillName:
    def test_valid_names(self) -> None:
        assert validate_skill_name("web-research") is True
        assert validate_skill_name("a") is True
        assert validate_skill_name("code-project") is True
        assert validate_skill_name("data-analysis") is True
        assert validate_skill_name("a1b2") is True

    def test_invalid_names(self) -> None:
        assert validate_skill_name("") is False
        assert validate_skill_name("Web-Research") is False
        assert validate_skill_name("web_research") is False
        assert validate_skill_name("-leading-dash") is False
        assert validate_skill_name("trailing-dash-") is False
        assert validate_skill_name("a" * 65) is False
        assert validate_skill_name("has spaces") is False


class TestSkillMetadata:
    def test_frozen(self) -> None:
        meta = SkillMetadata(name="test", description="desc")
        with pytest.raises(AttributeError):
            meta.name = "changed"  # type: ignore[misc]

    def test_description_required_in_constructor(self) -> None:
        meta = SkillMetadata(name="test", description="A test skill")
        assert meta.description == "A test skill"

    def test_no_triggers_field(self) -> None:
        meta = SkillMetadata(name="test", description="desc")
        assert not hasattr(meta, "triggers")

    def test_metadata_field_is_mapping_proxy(self) -> None:
        meta = SkillMetadata(
            name="test",
            description="desc",
            metadata=MappingProxyType({"author": "me"}),
        )
        assert meta.metadata["author"] == "me"
        with pytest.raises(TypeError):
            meta.metadata["new_key"] = "value"  # type: ignore[index]

    def test_compatibility_is_optional_string(self) -> None:
        meta = SkillMetadata(
            name="test", description="desc", compatibility="Requires git"
        )
        assert meta.compatibility == "Requires git"

    def test_allowed_tools_tuple(self) -> None:
        meta = SkillMetadata(
            name="test", description="desc", allowed_tools=("Bash", "Read")
        )
        assert meta.allowed_tools == ("Bash", "Read")

    def test_defaults(self) -> None:
        meta = SkillMetadata(name="test", description="desc")
        assert meta.license == ""
        assert meta.compatibility is None
        assert meta.allowed_tools == ()
        assert meta.metadata == MappingProxyType({})


class TestSkillContent:
    def test_frozen(self) -> None:
        meta = SkillMetadata(name="test", description="desc")
        content = SkillContent(
            metadata=meta,
            instructions="# Test",
            directory_path=Path("/tmp"),
            source_type="bundled",
        )
        with pytest.raises(AttributeError):
            content.instructions = "changed"  # type: ignore[misc]

    def test_directory_path_is_path(self) -> None:
        meta = SkillMetadata(name="test", description="desc")
        content = SkillContent(
            metadata=meta,
            instructions="",
            directory_path=Path("/tmp/skill"),
            source_type="user",
        )
        assert isinstance(content.directory_path, Path)

    def test_source_type_required(self) -> None:
        meta = SkillMetadata(name="test", description="desc")
        content = SkillContent(
            metadata=meta,
            instructions="",
            directory_path=Path("/tmp"),
            source_type="project",
        )
        assert content.source_type == "project"


class TestSkillCatalogEntry:
    def test_no_source_path(self) -> None:
        entry = SkillCatalogEntry(name="test", description="desc")
        assert not hasattr(entry, "source_path")


# ---------------------------------------------------------------------------
# Parser tests
# ---------------------------------------------------------------------------


class TestParseFrontmatter:
    def test_valid_frontmatter(self) -> None:
        text = "---\nname: test\ndescription: A test\n---\n# Instructions"
        fm, body = parse_frontmatter(text)
        assert fm["name"] == "test"
        assert body == "# Instructions"

    def test_no_frontmatter(self) -> None:
        text = "# Just a markdown file"
        fm, body = parse_frontmatter(text)
        assert fm == {}
        assert body == text

    def test_yaml_containing_triple_dash(self) -> None:
        """Frontmatter with --- inside a YAML string value should not break."""
        text = '---\nname: test\ndescription: "Use --- when needed"\n---\nBody'
        fm, body = parse_frontmatter(text)
        assert fm["name"] == "test"
        assert "---" in fm["description"]
        assert body == "Body"

    def test_empty_frontmatter(self) -> None:
        text = "---\n---\n# Body"
        fm, body = parse_frontmatter(text)
        assert fm == {}
        assert body == text  # falls through since yaml.safe_load returns None

    def test_leading_newlines(self) -> None:
        text = "\n\n---\nname: test\n---\nBody"
        fm, body = parse_frontmatter(text)
        assert fm["name"] == "test"
        assert body == "Body"


class TestParseSkillMd:
    def test_parse_valid_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = os.path.join(tmp, "my-skill")
            os.makedirs(skill_dir)
            skill_file = os.path.join(skill_dir, "SKILL.md")
            with open(skill_file, "w") as f:
                f.write(
                    "---\n"
                    "name: my-skill\n"
                    "description: A test skill for testing\n"
                    "license: MIT\n"
                    "compatibility: Requires Python 3.12+\n"
                    "allowed-tools: Bash Read\n"
                    "metadata:\n"
                    "  author: tester\n"
                    "  version: 2.0\n"
                    "---\n"
                    "# Instructions\n"
                    "Do the thing.\n"
                )

            skill = parse_skill_md(skill_file)
            assert skill.metadata.name == "my-skill"
            assert skill.metadata.description == "A test skill for testing"
            assert skill.metadata.license == "MIT"
            assert skill.metadata.compatibility == "Requires Python 3.12+"
            assert skill.metadata.allowed_tools == ("Bash", "Read")
            assert skill.metadata.metadata["author"] == "tester"
            assert skill.metadata.metadata["version"] == "2.0"  # coerced to str
            assert isinstance(skill.directory_path, Path)
            assert skill.source_type == "unknown"  # parser sets default

    def test_parse_description_required(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = os.path.join(tmp, "no-desc")
            os.makedirs(skill_dir)
            skill_file = os.path.join(skill_dir, "SKILL.md")
            with open(skill_file, "w") as f:
                f.write("---\nname: no-desc\n---\nBody")

            with pytest.raises(ValueError, match="description"):
                parse_skill_md(skill_file)

    def test_parse_triggers_ignored_with_warning(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = os.path.join(tmp, "old-skill")
            os.makedirs(skill_dir)
            skill_file = os.path.join(skill_dir, "SKILL.md")
            with open(skill_file, "w") as f:
                f.write(
                    "---\n"
                    "name: old-skill\n"
                    "description: Old style skill\n"
                    "triggers:\n"
                    "  - do stuff\n"
                    "---\nBody"
                )

            skill = parse_skill_md(skill_file)
            assert not hasattr(skill.metadata, "triggers")

    def test_parse_compatibility_list_joined(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = os.path.join(tmp, "compat")
            os.makedirs(skill_dir)
            skill_file = os.path.join(skill_dir, "SKILL.md")
            with open(skill_file, "w") as f:
                f.write(
                    "---\n"
                    "name: compat\n"
                    "description: Compat test\n"
                    "compatibility:\n"
                    "  - Python 3.12\n"
                    "  - Node 18\n"
                    "---\nBody"
                )

            skill = parse_skill_md(skill_file)
            assert skill.metadata.compatibility == "Python 3.12, Node 18"

    def test_parse_no_name_falls_back_to_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = os.path.join(tmp, "fallback-name")
            os.makedirs(skill_dir)
            skill_file = os.path.join(skill_dir, "SKILL.md")
            with open(skill_file, "w") as f:
                f.write("---\ndescription: Has description\n---\nBody")

            skill = parse_skill_md(skill_file)
            assert skill.metadata.name == "fallback-name"

    def test_parse_file_not_found(self) -> None:
        with pytest.raises(FileNotFoundError):
            parse_skill_md("/nonexistent/SKILL.md")

    def test_parse_metadata_values_coerced_to_str(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = os.path.join(tmp, "coerce")
            os.makedirs(skill_dir)
            skill_file = os.path.join(skill_dir, "SKILL.md")
            with open(skill_file, "w") as f:
                f.write(
                    "---\n"
                    "name: coerce\n"
                    "description: Coerce test\n"
                    "metadata:\n"
                    "  version: 2.0\n"
                    "  count: 42\n"
                    "  active: true\n"
                    "---\nBody"
                )

            skill = parse_skill_md(skill_file)
            assert skill.metadata.metadata["version"] == "2.0"
            assert skill.metadata.metadata["count"] == "42"
            assert skill.metadata.metadata["active"] == "True"

    def test_parse_sandbox_template(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = os.path.join(tmp, "ds-skill")
            os.makedirs(skill_dir)
            skill_file = os.path.join(skill_dir, "SKILL.md")
            with open(skill_file, "w") as f:
                f.write(
                    "---\n"
                    "name: ds-skill\n"
                    "description: Data science skill\n"
                    "sandbox-template: data_science\n"
                    "---\nBody"
                )

            skill = parse_skill_md(skill_file)
            assert skill.metadata.sandbox_template == "data_science"

    def test_parse_no_sandbox_template_is_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = os.path.join(tmp, "plain")
            os.makedirs(skill_dir)
            skill_file = os.path.join(skill_dir, "SKILL.md")
            with open(skill_file, "w") as f:
                f.write("---\nname: plain\ndescription: Plain skill\n---\nBody")

            skill = parse_skill_md(skill_file)
            assert skill.metadata.sandbox_template is None

    def test_bundled_data_analysis_has_sandbox_template(self) -> None:
        """Verify the bundled data-analysis skill declares data_science template."""
        bundled_dir = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "agent",
            "skills",
            "bundled",
        )
        skill_file = os.path.join(bundled_dir, "data-analysis", "SKILL.md")
        skill = parse_skill_md(skill_file)
        assert skill.metadata.sandbox_template == "data_science"

    def test_bundled_data_analysis_has_allowed_tools(self) -> None:
        """Verify the bundled data-analysis skill declares allowed tools."""
        bundled_dir = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "agent",
            "skills",
            "bundled",
        )
        skill_file = os.path.join(bundled_dir, "data-analysis", "SKILL.md")
        skill = parse_skill_md(skill_file)
        expected = (
            "code_run",
            "code_interpret",
            "file_read",
            "file_write",
            "file_list",
            "file_edit",
            "user_message",
        )
        assert skill.metadata.allowed_tools == expected


# ---------------------------------------------------------------------------
# Discovery tests
# ---------------------------------------------------------------------------


class TestSkillDiscoverer:
    def test_discover_bundled(self) -> None:
        bundled_dir = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "agent",
            "skills",
            "bundled",
        )
        with tempfile.TemporaryDirectory() as fake_home:
            with unittest.mock.patch(
                "agent.skills.discovery.Path.home", return_value=Path(fake_home)
            ):
                discoverer = SkillDiscoverer(bundled_dir=bundled_dir)
                skills = discoverer.discover_all()
        names = {s.metadata.name for s in skills}
        assert "deep-research" in names
        assert "data-analysis" in names
        for s in skills:
            assert s.source_type == "bundled"

    def test_synapse_path_takes_priority_over_agents_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = os.path.join(tmp, "project")
            synapse_dir = os.path.join(project, ".synapse", "skills", "my-skill")
            agents_dir = os.path.join(project, ".agents", "skills", "my-skill")
            os.makedirs(synapse_dir)
            os.makedirs(agents_dir)

            with open(os.path.join(synapse_dir, "SKILL.md"), "w") as f:
                f.write("---\nname: my-skill\ndescription: From synapse\n---\nSynapse")
            with open(os.path.join(agents_dir, "SKILL.md"), "w") as f:
                f.write("---\nname: my-skill\ndescription: From agents\n---\nAgents")

            discoverer = SkillDiscoverer(
                project_dir=project,
                bundled_dir=os.path.join(tmp, "empty"),
                trust_project=True,
            )
            skills = discoverer.discover_all()
            skill = next(s for s in skills if s.metadata.name == "my-skill")
            assert skill.metadata.description == "From synapse"

    def test_source_type_tagging(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = os.path.join(tmp, "project")
            proj_skill = os.path.join(project, ".synapse", "skills", "proj-skill")
            os.makedirs(proj_skill)
            with open(os.path.join(proj_skill, "SKILL.md"), "w") as f:
                f.write("---\nname: proj-skill\ndescription: Project skill\n---\nBody")

            discoverer = SkillDiscoverer(
                project_dir=project,
                bundled_dir=os.path.join(tmp, "empty"),
                trust_project=True,
            )
            skills = discoverer.discover_all()
            skill = next((s for s in skills if s.metadata.name == "proj-skill"), None)
            assert skill is not None
            assert skill.source_type == "project"

    def test_trust_gating_skips_project_skills(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = os.path.join(tmp, "project")
            proj_skill = os.path.join(project, ".synapse", "skills", "untrusted")
            os.makedirs(proj_skill)
            with open(os.path.join(proj_skill, "SKILL.md"), "w") as f:
                f.write("---\nname: untrusted\ndescription: Untrusted\n---\nBody")

            discoverer = SkillDiscoverer(
                project_dir=project,
                bundled_dir=os.path.join(tmp, "empty"),
                trust_project=False,
            )
            skills = discoverer.discover_all()
            names = {s.metadata.name for s in skills}
            assert "untrusted" not in names

    def test_scan_skips_git_dirs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            git_dir = os.path.join(tmp, ".git", "skill")
            os.makedirs(git_dir)
            with open(os.path.join(git_dir, "SKILL.md"), "w") as f:
                f.write("---\nname: hidden\ndescription: Hidden\n---\nHidden")

            results = _scan_directory(tmp)
            names = {s.metadata.name for s in results}
            assert "hidden" not in names


# ---------------------------------------------------------------------------
# Registry tests
# ---------------------------------------------------------------------------


def _make_skill(
    name: str,
    description: str = "Default description for testing",
    source_type: str = "bundled",
) -> SkillContent:
    return SkillContent(
        metadata=SkillMetadata(name=name, description=description),
        instructions=f"# {name} instructions",
        directory_path=Path(f"/tmp/{name}"),
        source_type=source_type,
    )


class TestSkillRegistry:
    def test_find_by_name(self) -> None:
        skill = _make_skill("test")
        registry = SkillRegistry((skill,))
        assert registry.find_by_name("test") is skill
        assert registry.find_by_name("missing") is None

    def test_catalog_no_source_path(self) -> None:
        registry = SkillRegistry((_make_skill("a", "Alpha"), _make_skill("b", "Beta")))
        catalog = registry.catalog()
        assert len(catalog) == 2
        assert catalog[0].name == "a"
        assert not hasattr(catalog[0], "source_path")

    def test_catalog_prompt_section_xml_format(self) -> None:
        registry = SkillRegistry((_make_skill("web-research", "Research things"),))
        section = registry.catalog_prompt_section()
        assert "<available_skills>" in section
        assert "<name>web-research</name>" in section
        assert "<description>Research things</description>" in section
        assert "activate_skill" in section

    def test_catalog_prompt_section_no_triggers(self) -> None:
        registry = SkillRegistry((_make_skill("test", "Test skill"),))
        section = registry.catalog_prompt_section()
        assert "Use when:" not in section
        assert "trigger" not in section.lower()

    def test_catalog_prompt_section_empty(self) -> None:
        registry = SkillRegistry(())
        assert registry.catalog_prompt_section() == ""

    def test_add_and_remove(self) -> None:
        registry = SkillRegistry(())
        new_registry = registry.add_skill(_make_skill("new"))
        assert registry.find_by_name("new") is None
        assert new_registry.find_by_name("new") is not None
        removed = new_registry.remove_skill("new")
        assert removed.find_by_name("new") is None

    def test_add_replaces_existing(self) -> None:
        old = _make_skill("dup", "old")
        new = _make_skill("dup", "new")
        registry = SkillRegistry((old,))
        updated = registry.add_skill(new)
        assert updated.find_by_name("dup").metadata.description == "new"

    def test_names(self) -> None:
        registry = SkillRegistry((_make_skill("a"), _make_skill("b")))
        assert set(registry.names()) == {"a", "b"}

    def test_all_skills(self) -> None:
        skills = (_make_skill("x"), _make_skill("y"))
        registry = SkillRegistry(skills)
        assert registry.all_skills() == skills


# ---------------------------------------------------------------------------
# match_description tests
# ---------------------------------------------------------------------------


class TestMatchDescription:
    def test_no_match_below_threshold(self) -> None:
        skill = _make_skill("web-research", "Deep web research with triangulation")
        registry = SkillRegistry((skill,))
        assert registry.match_description("hello world") is None

    def test_match_with_sufficient_overlap(self) -> None:
        skill = _make_skill(
            "web-research",
            "Deep web research with multi-query triangulation and source credibility",
        )
        registry = SkillRegistry((skill,))
        result = registry.match_description(
            "please research this topic with web sources"
        )
        assert result is not None
        assert result.metadata.name == "web-research"

    def test_case_insensitive(self) -> None:
        skill = _make_skill("web-research", "Deep web RESEARCH methodology")
        registry = SkillRegistry((skill,))
        result = registry.match_description("RESEARCH this DEEP topic on the WEB")
        assert result is not None

    def test_most_overlap_wins(self) -> None:
        web = _make_skill("web-research", "research topics on the web with sources")
        data = _make_skill(
            "data-analysis", "analyze datasets charts statistics research"
        )
        registry = SkillRegistry((web, data))
        result = registry.match_description("analyze these datasets with charts")
        assert result is not None
        assert result.metadata.name == "data-analysis"

    def test_empty_text(self) -> None:
        skill = _make_skill("test", "Some description")
        registry = SkillRegistry((skill,))
        assert registry.match_description("") is None

    def test_no_skills(self) -> None:
        registry = SkillRegistry(())
        assert registry.match_description("research something") is None

    def test_data_analysis_matches_csv_request(self) -> None:
        """data-analysis skill should match 'analyze this CSV data'."""
        bundled_dir = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "agent",
            "skills",
            "bundled",
        )
        from agent.skills.discovery import SkillDiscoverer

        discoverer = SkillDiscoverer(bundled_dir=bundled_dir)
        skills = discoverer.discover_all()
        registry = SkillRegistry(tuple(skills))
        result = registry.match_description("analyze this CSV data")
        assert result is not None
        assert result.metadata.name == "data-analysis"

    def test_tie_breaks_by_insertion_order(self) -> None:
        a = _make_skill("skill-a", "analyze data charts")
        b = _make_skill("skill-b", "analyze data charts")
        registry = SkillRegistry((a, b))
        result = registry.match_description("analyze data charts")
        assert result is not None
        assert result.metadata.name == "skill-a"

    def test_exact_name_token_match_beats_generic_description_overlap(self) -> None:
        named = _make_skill("data-analysis", "general helpers for tasks")
        generic = _make_skill("generic-research", "analyze data charts and datasets")
        registry = SkillRegistry((generic, named))

        result = registry.match_description("please use data-analysis for this task")

        assert result is not None
        assert result.metadata.name == "data-analysis"

    def test_weak_generic_overlap_does_not_auto_match(self) -> None:
        registry = SkillRegistry(
            (
                _make_skill("skill-a", "help users with tasks"),
                _make_skill("skill-b", "assist with user requests"),
            )
        )

        assert registry.match_description("help with this task") is None


# ---------------------------------------------------------------------------
# ActivateSkill tool tests
# ---------------------------------------------------------------------------


class TestActivateSkill:
    def test_definition(self) -> None:
        registry = SkillRegistry(())
        tool = ActivateSkill(skill_registry=registry)
        defn = tool.definition()
        assert defn.name == "activate_skill"
        assert "name" in defn.input_schema["properties"]

    @pytest.mark.asyncio
    async def test_activate_existing_skill(self) -> None:
        skill = _make_skill("test-skill")
        registry = SkillRegistry((skill,))
        tool = ActivateSkill(skill_registry=registry)

        result = await tool.execute(name="test-skill")
        assert result.success is True
        assert "<skill_content " in result.output
        assert "test-skill" in result.output
        assert "Skill directory:" in result.output

    @pytest.mark.asyncio
    async def test_activate_missing_skill(self) -> None:
        registry = SkillRegistry((_make_skill("other"),))
        tool = ActivateSkill(skill_registry=registry)

        result = await tool.execute(name="missing")
        assert result.success is False
        assert "not found" in result.error
        assert "other" in result.error

    @pytest.mark.asyncio
    async def test_activate_already_active_skill(self) -> None:
        skill = _make_skill("data-analysis")
        registry = SkillRegistry((skill,))
        tool = ActivateSkill(
            skill_registry=registry,
            active_skill_name="data-analysis",
        )

        result = await tool.execute(name="data-analysis")
        assert result.success is True
        assert "already active" in result.output

    def test_no_mutable_setter(self) -> None:
        """active_skill_name should be read-only (no setter)."""
        registry = SkillRegistry(())
        tool = ActivateSkill(skill_registry=registry)
        with pytest.raises(AttributeError):
            tool.active_skill_name = "should-fail"  # type: ignore[misc]

    @pytest.mark.asyncio
    async def test_categorized_resources(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = os.path.join(tmp, "rich-skill")
            os.makedirs(os.path.join(skill_dir, "scripts"))
            os.makedirs(os.path.join(skill_dir, "references"))
            os.makedirs(os.path.join(skill_dir, "assets"))
            with open(os.path.join(skill_dir, "SKILL.md"), "w") as f:
                f.write("---\nname: rich-skill\ndescription: Has everything\n---\nBody")
            with open(os.path.join(skill_dir, "scripts", "run.py"), "w") as f:
                f.write("print('run')")
            with open(os.path.join(skill_dir, "references", "guide.md"), "w") as f:
                f.write("# Guide")
            with open(os.path.join(skill_dir, "assets", "template.html"), "w") as f:
                f.write("<html/>")

            skill = parse_skill_md(os.path.join(skill_dir, "SKILL.md"))
            registry = SkillRegistry((skill,))
            tool = ActivateSkill(skill_registry=registry)

            result = await tool.execute(name="rich-skill")
            assert result.success is True
            assert "<scripts>" in result.output
            assert "scripts/run.py" in result.output
            assert "<references>" in result.output
            assert "references/guide.md" in result.output
            assert "<assets>" in result.output
            assert "assets/template.html" in result.output

    def test_categorized_resources_skip_unsafe_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = Path(tmp) / "rich-skill"
            scripts_dir = skill_dir / "scripts"
            scripts_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                "---\nname: rich-skill\ndescription: Has everything\n---\nBody",
                encoding="utf-8",
            )
            outside = Path(tmp) / "secret.txt"
            outside.write_text("secret", encoding="utf-8")
            (scripts_dir / "run.py").write_text("print('run')", encoding="utf-8")
            (scripts_dir / "leak.txt").symlink_to(outside)

            categorized = categorize_skill_resources(skill_dir)

            assert categorized["scripts"] == ["scripts/run.py"]

    def test_iter_skill_files_rejects_symlinked_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = Path(tmp) / "skill"
            skill_dir.mkdir()
            outside = Path(tmp) / "secret.txt"
            outside.write_text("secret", encoding="utf-8")
            (skill_dir / "SKILL.md").write_text(
                "---\nname: skill\ndescription: Test\n---\nBody",
                encoding="utf-8",
            )
            (skill_dir / "linked.txt").symlink_to(outside)

            with pytest.raises(ValueError, match="Unsafe skill file"):
                _iter_skill_files(skill_dir)


# ---------------------------------------------------------------------------
# Installer tests
# ---------------------------------------------------------------------------


class TestSkillInstaller:
    def test_list_installed_empty(self) -> None:
        from agent.skills.installer import SkillInstaller

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=tmp)
            assert installer.list_installed() == ()

    def test_uninstall_nonexistent(self) -> None:
        from agent.skills.installer import SkillInstaller

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=tmp)
            assert installer.uninstall("nonexistent") is False

    def test_install_and_list(self) -> None:
        from agent.skills.installer import SkillInstaller

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=os.path.join(tmp, "installed"))

            # Create a source skill
            source_dir = os.path.join(tmp, "source", "test-skill")
            os.makedirs(source_dir)
            with open(os.path.join(source_dir, "SKILL.md"), "w") as f:
                f.write("---\nname: test-skill\ndescription: Test\n---\nBody")

            skill = parse_skill_md(os.path.join(source_dir, "SKILL.md"))
            installed = installer._install_skill_dir(source_dir, skill)

            assert installed.metadata.name == "test-skill"

            listed = installer.list_installed()
            assert len(listed) == 1
            assert listed[0].name == "test-skill"

            # Uninstall
            assert installer.uninstall("test-skill") is True
            assert installer.list_installed() == ()

    def test_install_rejects_symlinked_file(self) -> None:
        from agent.skills.installer import SkillInstaller

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=os.path.join(tmp, "installed"))
            source_dir = Path(tmp) / "source" / "test-skill"
            source_dir.mkdir(parents=True)
            (source_dir / "SKILL.md").write_text(
                "---\nname: test-skill\ndescription: Test\n---\nBody",
                encoding="utf-8",
            )
            outside = Path(tmp) / "secret.txt"
            outside.write_text("secret", encoding="utf-8")
            (source_dir / "linked.txt").symlink_to(outside)

            skill = parse_skill_md(str(source_dir / "SKILL.md"))

            with pytest.raises(ValueError, match="symlinked file"):
                installer._install_skill_dir(str(source_dir), skill)

    @pytest.mark.asyncio
    async def test_install_from_git_invalid_url(self) -> None:
        from agent.skills.installer import SkillInstaller

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=tmp)
            with pytest.raises(ValueError, match="HTTPS"):
                await installer.install_from_git("http://example.com/repo.git")

    @pytest.mark.asyncio
    async def test_install_from_url_invalid_url(self) -> None:
        from agent.skills.installer import SkillInstaller

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=tmp)
            with pytest.raises(ValueError, match="HTTPS"):
                await installer.install_from_url("http://example.com/SKILL.md")


# ---------------------------------------------------------------------------
# Security tests — Zip Slip, SSRF, option injection
# ---------------------------------------------------------------------------


class TestZipSlipPrevention:
    """Verify that malicious zip entries with path traversal are rejected."""

    def test_zip_slip_rejected(self) -> None:
        from agent.skills.installer import _safe_extract_zip

        with tempfile.TemporaryDirectory() as tmp:
            # Create a zip with a path traversal entry
            archive_path = os.path.join(tmp, "evil.zip")
            extract_dir = os.path.join(tmp, "extracted")
            os.makedirs(extract_dir, exist_ok=True)

            with zipfile.ZipFile(archive_path, "w") as zf:
                zf.writestr("../../etc/evil.txt", "pwned")

            with pytest.raises(ValueError, match="path traversal"):
                _safe_extract_zip(archive_path, extract_dir)

    def test_safe_zip_allowed(self) -> None:
        from agent.skills.installer import _safe_extract_zip

        with tempfile.TemporaryDirectory() as tmp:
            archive_path = os.path.join(tmp, "safe.zip")
            extract_dir = os.path.join(tmp, "extracted")

            with zipfile.ZipFile(archive_path, "w") as zf:
                zf.writestr(
                    "skill/SKILL.md", "---\nname: ok\ndescription: OK\n---\nBody"
                )

            _safe_extract_zip(archive_path, extract_dir)
            assert os.path.isfile(os.path.join(extract_dir, "skill", "SKILL.md"))


class TestSSRFPrevention:
    """Verify that internal/private URLs are blocked."""

    def test_localhost_blocked(self) -> None:
        from agent.skills.installer import _validate_not_internal

        with pytest.raises(ValueError, match="blocked internal host"):
            _validate_not_internal("https://localhost/SKILL.md")

    def test_metadata_endpoint_blocked(self) -> None:
        from agent.skills.installer import _validate_not_internal

        with pytest.raises(ValueError, match="blocked internal host"):
            _validate_not_internal("https://169.254.169.254/latest/meta-data/")

    def test_private_ip_blocked(self) -> None:
        from agent.skills.installer import _validate_not_internal

        with pytest.raises(ValueError, match="private IP"):
            _validate_not_internal("https://10.0.0.1/SKILL.md")

        with pytest.raises(ValueError, match="private IP"):
            _validate_not_internal("https://192.168.1.1/SKILL.md")

        with pytest.raises(ValueError, match="private IP"):
            _validate_not_internal("https://172.16.0.1/SKILL.md")

    def test_public_url_allowed(self) -> None:
        from agent.skills.installer import _validate_not_internal

        # Should not raise
        _validate_not_internal("https://github.com/user/repo")

    @pytest.mark.asyncio
    async def test_install_from_url_blocks_internal_host_before_request(self) -> None:
        from unittest.mock import patch

        from agent.skills.installer import SkillInstaller

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=tmp)
            with patch(
                "agent.skills.installer.httpx.AsyncClient.stream",
                side_effect=AssertionError("network should not be reached"),
            ) as mock_stream:
                with pytest.raises(ValueError, match="blocked internal host"):
                    await installer.install_from_url("https://localhost/SKILL.md")
                mock_stream.assert_not_called()

    @pytest.mark.asyncio
    async def test_install_from_git_blocks_internal_host_before_clone(self) -> None:
        from unittest.mock import patch

        from agent.skills.installer import SkillInstaller

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=tmp)
            with patch(
                "agent.skills.installer.subprocess.run",
                side_effect=AssertionError("git clone should not be reached"),
            ) as mock_run:
                with pytest.raises(ValueError, match="blocked internal host"):
                    await installer.install_from_git("https://localhost/repo.git")
                mock_run.assert_not_called()


class TestGitOptionInjection:
    """Verify git clone uses -- separator to prevent option injection."""

    @pytest.mark.asyncio
    async def test_git_clone_uses_separator(self) -> None:
        """The git clone command should include '--' before the URL."""
        from unittest.mock import patch
        from agent.skills.installer import SkillInstaller

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=tmp)

            with patch("agent.skills.installer.subprocess.run") as mock_run:
                mock_run.side_effect = subprocess.CalledProcessError(
                    1, "git", stderr=b"expected failure"
                )
                with pytest.raises(RuntimeError):
                    await installer.install_from_git("https://example.com/repo.git")

                # Verify '--' is in the command before the URL
                call_args = mock_run.call_args[0][0]
                assert "--" in call_args
                url_idx = call_args.index("https://example.com/repo.git")
                sep_idx = call_args.index("--")
                assert sep_idx < url_idx


class TestGitNotFound:
    """Verify clear error message when git is not installed."""

    @pytest.mark.asyncio
    async def test_git_not_found_error(self) -> None:
        from unittest.mock import patch
        from agent.skills.installer import SkillInstaller

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=tmp)

            with patch(
                "agent.skills.installer.subprocess.run",
                side_effect=FileNotFoundError("git not found"),
            ):
                with pytest.raises(RuntimeError, match="git is not installed"):
                    await installer.install_from_git("https://example.com/repo.git")


class TestInstallFromUpload:
    """Tests for SkillInstaller.install_from_upload."""

    @pytest.mark.asyncio
    async def test_upload_single_skill_md(self) -> None:
        from agent.skills.installer import SkillInstaller, UploadedFile

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=os.path.join(tmp, "installed"))
            content = b"---\nname: uploaded-skill\ndescription: An uploaded skill\n---\n# Instructions\nDo stuff."
            files = [UploadedFile(filename="SKILL.md", data=content)]
            skill = await installer.install_from_upload(files)
            assert skill.metadata.name == "uploaded-skill"
            assert skill.source_type == "user"

    @pytest.mark.asyncio
    async def test_upload_zip(self) -> None:
        from agent.skills.installer import SkillInstaller, UploadedFile
        import io

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=os.path.join(tmp, "installed"))

            # Build a zip in memory
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as zf:
                zf.writestr(
                    "my-skill/SKILL.md",
                    "---\nname: zip-skill\ndescription: From zip\n---\nBody",
                )
            zip_data = buf.getvalue()

            files = [UploadedFile(filename="skill.zip", data=zip_data)]
            skill = await installer.install_from_upload(files)
            assert skill.metadata.name == "zip-skill"

    @pytest.mark.asyncio
    async def test_upload_multiple_files(self) -> None:
        from agent.skills.installer import SkillInstaller, UploadedFile

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=os.path.join(tmp, "installed"))
            files = [
                UploadedFile(
                    filename="SKILL.md",
                    data=b"---\nname: folder-skill\ndescription: Folder upload\n---\nBody",
                ),
                UploadedFile(
                    filename="scripts/helper.py",
                    data=b"print('hello')",
                ),
            ]
            skill = await installer.install_from_upload(files)
            assert skill.metadata.name == "folder-skill"

    @pytest.mark.asyncio
    async def test_upload_path_traversal_rejected(self) -> None:
        from agent.skills.installer import SkillInstaller, UploadedFile

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=os.path.join(tmp, "installed"))
            files = [
                UploadedFile(
                    filename="../../../etc/passwd",
                    data=b"evil",
                ),
            ]
            with pytest.raises(ValueError, match="Path traversal"):
                await installer.install_from_upload(files)

    @pytest.mark.asyncio
    async def test_upload_size_limit(self) -> None:
        from agent.skills.installer import (
            SkillInstaller,
            UploadedFile,
            _MAX_DOWNLOAD_SIZE,
        )

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=os.path.join(tmp, "installed"))
            files = [
                UploadedFile(
                    filename="SKILL.md",
                    data=b"x" * (_MAX_DOWNLOAD_SIZE + 1),
                ),
            ]
            with pytest.raises(ValueError, match="too large"):
                await installer.install_from_upload(files)

    @pytest.mark.asyncio
    async def test_upload_no_files(self) -> None:
        from agent.skills.installer import SkillInstaller

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=os.path.join(tmp, "installed"))
            with pytest.raises(ValueError, match="No files"):
                await installer.install_from_upload([])

    @pytest.mark.asyncio
    async def test_upload_no_skill_md(self) -> None:
        from agent.skills.installer import SkillInstaller, UploadedFile

        with tempfile.TemporaryDirectory() as tmp:
            installer = SkillInstaller(install_dir=os.path.join(tmp, "installed"))
            files = [
                UploadedFile(filename="README.md", data=b"# Just a readme"),
                UploadedFile(filename="helper.py", data=b"print('hi')"),
            ]
            with pytest.raises(ValueError, match="No SKILL.md"):
                await installer.install_from_upload(files)


class TestFindSkillMd:
    """Verify _find_skill_md prefers root-level and rejects ambiguous matches."""

    def test_prefers_root_level(self) -> None:
        from agent.skills.installer import _find_skill_md

        with tempfile.TemporaryDirectory() as tmp:
            # Root level SKILL.md
            with open(os.path.join(tmp, "SKILL.md"), "w") as f:
                f.write("---\nname: root\ndescription: Root\n---\nBody")

            # Nested SKILL.md
            nested = os.path.join(tmp, "sub", "dir")
            os.makedirs(nested)
            with open(os.path.join(nested, "SKILL.md"), "w") as f:
                f.write("---\nname: nested\ndescription: Nested\n---\nBody")

            result = _find_skill_md(tmp)
            assert result == os.path.join(tmp, "SKILL.md")

    def test_multiple_at_same_depth_raises(self) -> None:
        from agent.skills.installer import _find_skill_md

        with tempfile.TemporaryDirectory() as tmp:
            # Two SKILL.md files at depth 1
            dir_a = os.path.join(tmp, "a")
            dir_b = os.path.join(tmp, "b")
            os.makedirs(dir_a)
            os.makedirs(dir_b)
            with open(os.path.join(dir_a, "SKILL.md"), "w") as f:
                f.write("---\nname: a\ndescription: A\n---\nBody")
            with open(os.path.join(dir_b, "SKILL.md"), "w") as f:
                f.write("---\nname: b\ndescription: B\n---\nBody")

            with pytest.raises(ValueError, match="multiple SKILL.md"):
                _find_skill_md(tmp)

    def test_no_skill_md_returns_none(self) -> None:
        from agent.skills.installer import _find_skill_md

        with tempfile.TemporaryDirectory() as tmp:
            assert _find_skill_md(tmp) is None


# ---------------------------------------------------------------------------
# ToolRegistry replace_tool tests
# ---------------------------------------------------------------------------


class TestToolRegistryReplaceSkill:
    """Test that ToolRegistry supports replacing an existing tool."""

    def test_replace_tool(self) -> None:
        from agent.tools.registry import ToolRegistry as ToolReg

        skill_a = _make_skill("test")
        registry_a = SkillRegistry((skill_a,))
        tool_a = ActivateSkill(skill_registry=registry_a, active_skill_name=None)

        tool_reg = ToolReg()
        tool_reg = tool_reg.register(tool_a)
        assert tool_reg.get("activate_skill") is tool_a

        # Replace with new instance
        tool_b = ActivateSkill(skill_registry=registry_a, active_skill_name="test")
        tool_reg2 = tool_reg.replace_tool(tool_b)
        assert tool_reg2.get("activate_skill") is tool_b
        # Original unchanged
        assert tool_reg.get("activate_skill") is tool_a


class TestToolRegistryFilterByNames:
    """Test that ToolRegistry.filter_by_names returns only requested tools."""

    def test_filter_by_names_keeps_matching(self) -> None:
        from agent.tools.registry import ToolRegistry as ToolReg

        skill = _make_skill("test")
        reg = SkillRegistry((skill,))
        tool_a = ActivateSkill(skill_registry=reg)
        ActivateSkill(skill_registry=reg, active_skill_name="test")

        tool_reg = ToolReg()
        tool_reg = tool_reg.register(tool_a)
        # replace_tool to add a second tool with a different name is not possible
        # with ActivateSkill (same name), so test with just the single tool
        filtered = tool_reg.filter_by_names({"activate_skill"})
        assert filtered.get("activate_skill") is tool_a

    def test_filter_by_names_excludes_non_matching(self) -> None:
        from agent.tools.registry import ToolRegistry as ToolReg

        skill = _make_skill("test")
        reg = SkillRegistry((skill,))
        tool = ActivateSkill(skill_registry=reg)

        tool_reg = ToolReg()
        tool_reg = tool_reg.register(tool)
        filtered = tool_reg.filter_by_names({"nonexistent"})
        assert filtered.get("activate_skill") is None

    def test_filter_by_names_returns_new_registry(self) -> None:
        from agent.tools.registry import ToolRegistry as ToolReg

        skill = _make_skill("test")
        reg = SkillRegistry((skill,))
        tool = ActivateSkill(skill_registry=reg)

        tool_reg = ToolReg()
        tool_reg = tool_reg.register(tool)
        filtered = tool_reg.filter_by_names({"activate_skill"})
        # Original is unchanged — immutable style
        assert filtered is not tool_reg
        assert tool_reg.get("activate_skill") is tool


class TestRedundantSkillActivationEmit:
    @pytest.mark.asyncio
    async def test_emit_redundant_skill_activation_notifies_subscribers(self) -> None:
        from agent.runtime.skill_setup import emit_redundant_skill_activation
        from api.events import AgentEvent, EventEmitter, EventType

        received: list[AgentEvent] = []

        async def cb(ev: AgentEvent) -> None:
            received.append(ev)

        emitter = EventEmitter()
        emitter.subscribe(cb)
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "tu-1",
                        "is_error": False,
                    },
                ],
            },
        ]
        await emit_redundant_skill_activation(
            emitter, skill_name="docx", tool_id="tu-1", messages=messages
        )
        assert len(received) == 1
        assert received[0].type == EventType.SKILL_ACTIVATED
        assert received[0].data["name"] == "docx"
        assert received[0].data["source"] == "already_active"

    @pytest.mark.asyncio
    async def test_emit_redundant_skill_activation_skips_on_tool_error(self) -> None:
        from agent.runtime.skill_setup import emit_redundant_skill_activation
        from api.events import AgentEvent, EventEmitter

        received: list[AgentEvent] = []

        async def cb(ev: AgentEvent) -> None:
            received.append(ev)

        emitter = EventEmitter()
        emitter.subscribe(cb)
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "tu-1",
                        "is_error": True,
                    },
                ],
            },
        ]
        await emit_redundant_skill_activation(
            emitter, skill_name="docx", tool_id="tu-1", messages=messages
        )
        assert received == []
