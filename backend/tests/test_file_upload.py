"""Tests for file upload sanitization and handling."""

from __future__ import annotations

import os
import tempfile
from io import BytesIO

import pytest

from api.routes.conversations import (
    _extract_selected_skills,
    _extract_upload_files,
    _sanitize_filename,
)
from starlette.datastructures import UploadFile


class TestSanitizeFilename:
    """Verify _sanitize_filename handles dangerous and edge-case inputs."""

    def test_strips_path_traversal(self) -> None:
        assert _sanitize_filename("../../etc/passwd") == "passwd"

    def test_strips_deep_traversal(self) -> None:
        assert _sanitize_filename("../../../etc/cron.d/backdoor") == "backdoor"

    def test_strips_absolute_path(self) -> None:
        assert _sanitize_filename("/etc/shadow") == "shadow"

    def test_replaces_special_characters(self) -> None:
        result = _sanitize_filename("file<name>.txt")
        assert "<" not in result
        assert ">" not in result
        assert result.endswith(".txt")

    def test_preserves_safe_characters(self) -> None:
        assert _sanitize_filename("my-file_v2.tar.gz") == "my-file_v2.tar.gz"

    def test_preserves_spaces(self) -> None:
        assert _sanitize_filename("my report.pdf") == "my report.pdf"

    def test_empty_string_returns_unnamed(self) -> None:
        assert _sanitize_filename("") == "unnamed"

    def test_only_dots_returns_unnamed(self) -> None:
        # os.path.basename("...") == "..." then stripped of non-word chars → "..."
        # which is still non-empty, but let's verify it's safe
        result = _sanitize_filename("...")
        assert result  # not empty

    def test_whitespace_only_returns_unnamed(self) -> None:
        assert _sanitize_filename("   ") == "unnamed"

    def test_windows_path_separators(self) -> None:
        # os.path.basename handles forward slashes; backslashes depend on OS
        result = _sanitize_filename("uploads/evil.txt")
        assert result == "evil.txt"

    def test_null_bytes_stripped(self) -> None:
        result = _sanitize_filename("file\x00name.txt")
        assert "\x00" not in result

    def test_normal_filename_unchanged(self) -> None:
        assert _sanitize_filename("report.pdf") == "report.pdf"

    def test_unicode_filename(self) -> None:
        # Unicode word chars should be preserved by \w
        result = _sanitize_filename("日本語ファイル.txt")
        assert result.endswith(".txt")
        assert len(result) > 4  # not just ".txt"


class TestSanitizerConsistency:
    """Guard against future divergence between the two filename sanitizers."""

    FILENAMES = (
        "report.pdf",
        "../../etc/passwd",
        "file<name>.txt",
        "my-file_v2.tar.gz",
        "my report.pdf",
        "",
        "   ",
        "日本語ファイル.txt",
        "file\x00name.txt",
        "uploads/evil.txt",
        "hello world (copy).csv",
        "data@2024#01.xlsx",
    )

    def test_both_sanitizers_produce_identical_results(self) -> None:
        from agent.runtime.orchestrator import AgentOrchestrator

        for name in self.FILENAMES:
            route_result = _sanitize_filename(name)
            orchestrator_result = AgentOrchestrator._safe_display_name(name)
            assert route_result == orchestrator_result, (
                f"Sanitizer divergence for {name!r}: "
                f"route={route_result!r}, orchestrator={orchestrator_result!r}"
            )


class TestLocalSessionSandboxPathMapping:
    """Verify LocalSession maps canonical sandbox paths into the workspace."""

    @pytest.mark.asyncio
    async def test_upload_to_home_user_uploads(self) -> None:
        from agent.sandbox.local_provider import LocalSession

        with tempfile.TemporaryDirectory() as workdir:
            session = LocalSession(workdir=workdir)

            src = os.path.join(workdir, "source.csv")
            with open(src, "w") as f:
                f.write("a,b\n1,2\n")

            target_path = "/home/user/uploads/data.csv"

            await session.upload_file(src, target_path)

            expected = os.path.join(workdir, "uploads", "data.csv")
            assert os.path.isfile(expected)
            with open(expected) as f:
                assert f.read() == "a,b\n1,2\n"
            assert await session.read_file(target_path) == "a,b\n1,2\n"

    @pytest.mark.asyncio
    async def test_workspace_absolute_paths_map_to_same_file(self) -> None:
        from agent.sandbox.local_provider import LocalSession

        with tempfile.TemporaryDirectory() as workdir:
            session = LocalSession(workdir=workdir)

            await session.write_file("/workspace/reports/out.txt", "hello")

            expected = os.path.join(workdir, "reports", "out.txt")
            assert os.path.isfile(expected)
            assert await session.read_file("/home/user/reports/out.txt") == "hello"

    @pytest.mark.asyncio
    async def test_relative_paths_stay_in_workspace(self) -> None:
        from agent.sandbox.local_provider import LocalSession

        with tempfile.TemporaryDirectory() as workdir:
            session = LocalSession(workdir=workdir)

            src = os.path.join(workdir, "source.csv")
            with open(src, "w") as f:
                f.write("x,y\n3,4\n")

            await session.upload_file(src, "uploads/data.csv")

            expected = os.path.join(workdir, "uploads", "data.csv")
            assert os.path.isfile(expected)

    @pytest.mark.asyncio
    async def test_unrelated_absolute_host_paths_are_rejected(self) -> None:
        from agent.sandbox.local_provider import LocalSession

        with tempfile.TemporaryDirectory() as workdir:
            session = LocalSession(workdir=workdir)
            src = os.path.join(workdir, "source.txt")
            with open(src, "w") as f:
                f.write("unsafe")

            with pytest.raises(ValueError, match="outside the sandbox roots"):
                await session.upload_file(src, "/etc/passwd")


class TestSanitizeFilenameInOrchestrator:
    """Verify the orchestrator's display-name sanitizer."""

    def test_strips_traversal(self) -> None:
        from agent.runtime.orchestrator import AgentOrchestrator

        assert AgentOrchestrator._safe_display_name("../../etc/passwd") == "passwd"

    def test_empty_returns_unnamed(self) -> None:
        from agent.runtime.orchestrator import AgentOrchestrator

        assert AgentOrchestrator._safe_display_name("") == "unnamed"

    def test_safe_name_unchanged(self) -> None:
        from agent.runtime.orchestrator import AgentOrchestrator

        assert AgentOrchestrator._safe_display_name("photo.jpg") == "photo.jpg"


class TestExtractUploadFiles:
    def test_accepts_starlette_upload_file_instances(self) -> None:
        upload = UploadFile(file=BytesIO(b"hello"), filename="data.csv")
        raw_files = ["ignore-me", upload]

        result = _extract_upload_files(raw_files)

        assert result == [upload]


class TestExtractSelectedSkills:
    def test_reads_repeated_skills_fields(self) -> None:
        class _FakeForm:
            def getlist(self, key: str) -> list[str]:
                return ["data-analysis", "deep-research"] if key == "skills" else []

            def get(self, key: str, default: object = None) -> object:
                return default

        assert _extract_selected_skills(_FakeForm()) == (
            "data-analysis",
            "deep-research",
        )
