from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from agent.tools.sandbox.office_tools import (
    DocumentEdit,
    DocumentWrite,
    FileConvert,
    SlidesCreate,
    SlidesEdit,
    SpreadsheetEdit,
    SpreadsheetRead,
    SpreadsheetWrite,
)


class _LocalSandboxSession:
    async def write_file(self, path: str, content: str) -> None:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    async def read_file(self, path: str) -> str:
        return Path(path).read_text(encoding="utf-8")

    async def exec(
        self,
        command: str,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> Any:
        process = await asyncio.create_subprocess_shell(
            command,
            cwd=workdir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
        except TimeoutError:
            process.kill()
            await process.wait()
            return SimpleNamespace(exit_code=1, stdout="", stderr="Timed out")
        return SimpleNamespace(
            exit_code=process.returncode or 0,
            stdout=stdout.decode(),
            stderr=stderr.decode(),
        )


@pytest.mark.asyncio
async def test_spreadsheet_tools_can_write_read_and_edit_csv(tmp_path: Path) -> None:
    session = _LocalSandboxSession()
    path = tmp_path / "scores.csv"

    written = await SpreadsheetWrite().execute(
        session,
        path=str(path),
        columns=["name", "score"],
        rows=[["Ada", 5], ["Grace", 7]],
    )
    assert written.success

    preview = await SpreadsheetRead().execute(session, path=str(path))
    assert preview.success
    assert "Rows: 3" in preview.output
    assert "Ada | 5" in preview.output

    edited = await SpreadsheetEdit().execute(
        session,
        path=str(path),
        operation="update_cell",
        row_index=1,
        column="score",
        value=8,
    )
    assert edited.success
    assert path.read_text(encoding="utf-8") == "name,score\nAda,5\nGrace,8\n"


@pytest.mark.asyncio
async def test_spreadsheet_edit_updates_first_row_for_headerless_csv(
    tmp_path: Path,
) -> None:
    session = _LocalSandboxSession()
    path = tmp_path / "plain.csv"
    path.write_text("Ada,5\nGrace,7\n", encoding="utf-8")

    edited = await SpreadsheetEdit().execute(
        session,
        path=str(path),
        operation="update_cell",
        row_index=0,
        column=1,
        value=9,
    )

    assert edited.success
    assert path.read_text(encoding="utf-8") == "Ada,9\nGrace,7\n"


@pytest.mark.asyncio
async def test_document_and_slides_tools_update_artifacts(tmp_path: Path) -> None:
    session = _LocalSandboxSession()
    doc_path = tmp_path / "report.md"
    deck_path = tmp_path / "deck.html"

    written = await DocumentWrite().execute(
        session,
        path=str(doc_path),
        content="# Status\n",
    )
    assert written.success

    appended = await DocumentEdit().execute(
        session,
        path=str(doc_path),
        operation="append",
        text="Ready for review.\n",
    )
    assert appended.success
    assert doc_path.read_text(encoding="utf-8") == "# Status\nReady for review.\n"

    created = await SlidesCreate().execute(
        session,
        path=str(deck_path),
        title="Roadmap",
        slides=[{"title": "Overview", "body": "Current status"}],
    )
    assert created.success

    updated = await SlidesEdit().execute(
        session,
        path=str(deck_path),
        operation="append_slide",
        slide={"title": "Next", "body": "Follow-up tasks"},
    )
    assert updated.success

    html = deck_path.read_text(encoding="utf-8")
    assert "Overview" in html
    assert "Next" in html


@pytest.mark.asyncio
async def test_slides_escape_untrusted_html(tmp_path: Path) -> None:
    session = _LocalSandboxSession()
    deck_path = tmp_path / "unsafe.html"

    created = await SlidesCreate().execute(
        session,
        path=str(deck_path),
        title="<script>alert(1)</script>",
        slides=[
            {
                "title": "<b>Overview</b>",
                "body": "<script>alert(1)</script>",
                "bullets": ["<img src=x onerror=alert(1)>"],
            }
        ],
    )

    assert created.success
    html = deck_path.read_text(encoding="utf-8")
    assert "<script>alert(1)</script>" not in html
    assert "<img src=x onerror=alert(1)>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "&lt;b&gt;Overview&lt;/b&gt;" in html


@pytest.mark.asyncio
async def test_file_convert_transforms_csv_into_json(tmp_path: Path) -> None:
    session = _LocalSandboxSession()
    source_path = tmp_path / "table.csv"
    target_path = tmp_path / "table.json"
    source_path.write_text("name,score\nAda,5\n", encoding="utf-8")

    result = await FileConvert().execute(
        session,
        source_path=str(source_path),
        target_path=str(target_path),
    )

    assert result.success
    assert json.loads(target_path.read_text(encoding="utf-8")) == [
        {"name": "Ada", "score": "5"}
    ]
