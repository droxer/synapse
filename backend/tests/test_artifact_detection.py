"""Tests for shared artifact auto-detection helper."""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.tools.sandbox.artifact_detection import (
    DEFAULT_SEARCH_ROOTS,
    build_artifact_paths,
    find_new_output_files,
    snapshot_output_files,
)


@dataclass(frozen=True)
class FakeExecResult:
    stdout: str
    stderr: str
    exit_code: int
    success: bool


# Patch ExecResult so isinstance checks pass
@pytest.fixture(autouse=True)
def _patch_exec_result(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "agent.sandbox.base.ExecResult",
        FakeExecResult,
    )


def _make_session(find_stdout: str = "", success: bool = True) -> MagicMock:
    session = MagicMock()
    session.exec = AsyncMock(
        return_value=FakeExecResult(
            stdout=find_stdout,
            stderr="",
            exit_code=0 if success else 1,
            success=success,
        )
    )
    return session


def _make_session_with_responses(*responses: FakeExecResult) -> MagicMock:
    session = MagicMock()
    session.exec = AsyncMock(side_effect=list(responses))
    return session


class TestFindNewOutputFiles:
    """find_new_output_files should discover artifacts in all search roots."""

    @pytest.mark.asyncio
    async def test_finds_files_in_workspace(self) -> None:
        session = _make_session("/workspace/report.pdf\n/workspace/data.csv\n")
        result = await find_new_output_files(session, "/tmp/marker")
        assert "/workspace/report.pdf" in result
        assert "/workspace/data.csv" in result

    @pytest.mark.asyncio
    async def test_filters_text_intermediates_from_auto(self) -> None:
        session = _make_session("/workspace/outline.txt\n/workspace/slides.pptx\n")
        result = await find_new_output_files(session, "/tmp/marker")
        assert result == ["/workspace/slides.pptx"]

    @pytest.mark.asyncio
    async def test_skill_directory_files_not_auto_artifacts(self) -> None:
        session = _make_session("/home/user/skills/pdf/output.pdf\n")
        result = await find_new_output_files(session, "/tmp/marker")
        assert result == []

    @pytest.mark.asyncio
    async def test_excludes_specified_paths(self) -> None:
        session = _make_session("/workspace/script.py\n/workspace/report.pdf\n")
        result = await find_new_output_files(
            session,
            "/tmp/marker",
            exclude_paths=("/workspace/script.py",),
        )
        assert "/workspace/report.pdf" in result
        assert "/workspace/script.py" not in result

    @pytest.mark.asyncio
    async def test_returns_empty_on_no_results(self) -> None:
        session = _make_session("")
        result = await find_new_output_files(session, "/tmp/marker")
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_failure(self) -> None:
        session = _make_session("", success=False)
        result = await find_new_output_files(session, "/tmp/marker")
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_exception(self) -> None:
        session = MagicMock()
        session.exec = AsyncMock(side_effect=RuntimeError("boom"))
        result = await find_new_output_files(session, "/tmp/marker")
        assert result == []

    @pytest.mark.asyncio
    async def test_custom_search_roots(self) -> None:
        session = _make_session("/custom/dir/file.pdf\n")
        result = await find_new_output_files(
            session,
            "/tmp/marker",
            search_roots=("/custom/dir",),
        )
        assert "/custom/dir/file.pdf" in result

    @pytest.mark.asyncio
    async def test_default_search_roots_include_skills(self) -> None:
        assert "/workspace" in DEFAULT_SEARCH_ROOTS
        assert "/home/user/skills" in DEFAULT_SEARCH_ROOTS

    @pytest.mark.asyncio
    async def test_find_command_includes_both_roots(self) -> None:
        session = _make_session("")
        await find_new_output_files(session, "/tmp/marker")
        call_args = session.exec.call_args_list[0][0][0]
        assert "/workspace" in call_args
        assert "/home/user/skills" in call_args

    @pytest.mark.asyncio
    async def test_uses_snapshot_diff_when_marker_scan_misses_new_file(self) -> None:
        session = _make_session_with_responses(
            FakeExecResult(stdout="", stderr="", exit_code=0, success=True),
            FakeExecResult(
                stdout="/workspace/palantir-ontology-intro.pptx\t178150\t1712932200.0\n",
                stderr="",
                exit_code=0,
                success=True,
            ),
        )

        result = await find_new_output_files(
            session,
            "/tmp/marker",
            before_snapshot={},
        )

        assert result == ["/workspace/palantir-ontology-intro.pptx"]

    @pytest.mark.asyncio
    async def test_snapshot_diff_detects_rewritten_file(self) -> None:
        session = _make_session_with_responses(
            FakeExecResult(stdout="", stderr="", exit_code=0, success=True),
            FakeExecResult(
                stdout="/workspace/report.pptx\t2048\t1712932201.0\n",
                stderr="",
                exit_code=0,
                success=True,
            ),
        )

        result = await find_new_output_files(
            session,
            "/tmp/marker",
            before_snapshot={"/workspace/report.pptx": (1024, "1712932200.0")},
        )

        assert result == ["/workspace/report.pptx"]


class TestSnapshotOutputFiles:
    @pytest.mark.asyncio
    async def test_parses_size_and_mtime(self) -> None:
        session = _make_session(
            "/workspace/report.pdf\t512\t1712932200.123\n"
            "/workspace/deck.pptx\t2048\t1712932201.456\n"
        )

        result = await snapshot_output_files(session)

        assert result == {
            "/workspace/report.pdf": (512, "1712932200.123"),
            "/workspace/deck.pptx": (2048, "1712932201.456"),
        }


class TestBuildArtifactPaths:
    """build_artifact_paths prefers explicit output_files over auto-detection."""

    def test_explicit_wins_over_auto(self) -> None:
        """When output_files is set, auto-detected paths are ignored."""
        result = build_artifact_paths(
            ["/workspace/a.pdf"],
            ["/workspace/b.csv"],
        )
        assert result == ["/workspace/a.pdf"]

    def test_deduplicates(self) -> None:
        result = build_artifact_paths(
            ["/workspace/a.pdf"],
            ["/workspace/a.pdf"],
        )
        assert result == ["/workspace/a.pdf"]

    def test_excludes_paths_by_exact_match(self) -> None:
        result = build_artifact_paths(
            ["/tmp/script.py", "/workspace/report.pdf"],
            [],
            exclude_paths=("/tmp/script.py",),
        )
        assert result == ["/workspace/report.pdf"]

    def test_excludes_paths_by_basename(self) -> None:
        result = build_artifact_paths(
            [],
            ["/workspace/script.py", "/workspace/report.pdf"],
            exclude_paths=("/tmp/script.py",),
        )
        assert result == ["/workspace/report.pdf"]

    def test_skips_empty_strings(self) -> None:
        result = build_artifact_paths(["", "  "], ["/workspace/a.pdf"])
        assert result == ["/workspace/a.pdf"]

    def test_empty_inputs(self) -> None:
        result = build_artifact_paths([], [])
        assert result == []

    def test_skill_directory_auto_paths_dropped(self) -> None:
        """Staged skill copies must not appear as user artifacts."""
        result = build_artifact_paths(
            [],
            ["/home/user/skills/pdf/output.pdf"],
        )
        assert result == []

    def test_explicit_skill_path_allowed(self) -> None:
        """Model may still name a deliverable under the skill dir via output_files."""
        result = build_artifact_paths(
            ["/home/user/skills/pdf/final-deck.pptx"],
            ["/workspace/other.pptx"],
        )
        assert result == ["/home/user/skills/pdf/final-deck.pptx"]

    def test_auto_skips_text_intermediates(self) -> None:
        result = build_artifact_paths(
            [],
            ["/workspace/outline.txt", "/workspace/slides.pptx"],
        )
        assert result == ["/workspace/slides.pptx"]
