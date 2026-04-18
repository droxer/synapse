"""Tests for file_write artifact filtering."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.tools.sandbox.file_ops import FileWrite


def _make_session() -> MagicMock:
    session = MagicMock()
    session.write_file = AsyncMock()
    return session


class TestFileWriteArtifactFiltering:
    """file_write should only emit artifact_paths for output files, not scripts."""

    @pytest.mark.asyncio
    async def test_docx_file_is_artifact_by_default(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/report.docx",
            content="fake content",
        )
        assert result.success
        assert result.metadata is not None
        assert result.metadata.get("artifact_paths") == ["/workspace/report.docx"]

    @pytest.mark.asyncio
    async def test_doc_file_is_artifact_by_default(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/report.doc",
            content="fake content",
        )
        assert result.success
        assert result.metadata is not None
        assert result.metadata.get("artifact_paths") == ["/workspace/report.doc"]

    @pytest.mark.asyncio
    async def test_js_file_is_not_artifact_by_default(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/create_docx.js",
            content="console.log('hello')",
        )
        assert result.success
        assert result.metadata is not None
        assert "artifact_paths" not in result.metadata

    @pytest.mark.asyncio
    async def test_py_file_is_not_artifact_by_default(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/generate.py",
            content="print('hello')",
        )
        assert result.success
        assert result.metadata is not None
        assert "artifact_paths" not in result.metadata

    @pytest.mark.asyncio
    async def test_explicit_is_artifact_true_overrides_heuristic(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/script.js",
            content="// final deliverable",
            is_artifact=True,
        )
        assert result.success
        assert result.metadata is not None
        assert result.metadata.get("artifact_paths") == ["/workspace/script.js"]

    @pytest.mark.asyncio
    async def test_explicit_is_artifact_false_suppresses_artifact(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/report.docx",
            content="fake content",
            is_artifact=False,
        )
        assert result.success
        assert result.metadata is not None
        assert "artifact_paths" not in result.metadata

    @pytest.mark.asyncio
    async def test_pdf_file_is_artifact_by_default(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/output.pdf",
            content="fake pdf",
        )
        assert result.success
        assert result.metadata is not None
        assert result.metadata.get("artifact_paths") == ["/workspace/output.pdf"]

    @pytest.mark.asyncio
    async def test_html_file_is_artifact_by_default(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/paper-folding-demo.html",
            content="<html><body>Hello</body></html>",
        )
        assert result.success
        assert result.metadata is not None
        assert result.metadata.get("artifact_paths") == [
            "/workspace/paper-folding-demo.html"
        ]

    @pytest.mark.asyncio
    async def test_tsv_file_is_artifact_by_default(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/data.tsv",
            content="a\tb\tc",
        )
        assert result.success
        assert result.metadata is not None
        assert result.metadata.get("artifact_paths") == ["/workspace/data.tsv"]

    @pytest.mark.asyncio
    async def test_sh_file_is_not_artifact_by_default(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/setup.sh",
            content="#!/bin/bash",
        )
        assert result.success
        assert result.metadata is not None
        assert "artifact_paths" not in result.metadata

    @pytest.mark.asyncio
    async def test_extensionless_file_is_not_artifact_by_default(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/Makefile",
            content="all: build",
        )
        assert result.success
        assert result.metadata is not None
        assert "artifact_paths" not in result.metadata

    @pytest.mark.asyncio
    async def test_json_file_is_not_artifact_by_default(self) -> None:
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/report.json",
            content='{"ok": true}',
        )
        assert result.success
        assert result.metadata is not None
        assert "artifact_paths" not in result.metadata

    @pytest.mark.asyncio
    async def test_is_artifact_absent_uses_heuristic_for_csv(self) -> None:
        """When is_artifact is not passed at all, the heuristic decides."""
        tool = FileWrite()
        result = await tool.execute(
            session=_make_session(),
            path="/workspace/data.csv",
            content="a,b,c",
        )
        assert result.success
        assert result.metadata is not None
        assert result.metadata.get("artifact_paths") == ["/workspace/data.csv"]
