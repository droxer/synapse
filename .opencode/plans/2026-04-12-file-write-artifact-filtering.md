# file_write Artifact Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent intermediate code/script files (e.g., `create_docx.js`) from appearing in the artifact Files tab when written via `file_write`, by adding an `is_artifact` parameter and extension-based heuristic.

**Architecture:** Add an optional `is_artifact` boolean parameter to `file_write`. When unset (default), use an extension-based heuristic: files with known output extensions (`.docx`, `.pdf`, `.png`, etc.) are treated as artifacts; code/script files (`.js`, `.py`, `.sh`) are not. When explicitly set to `true`/`false`, the explicit value wins. Extract `_AUTO_DETECT_EXTENSIONS` from `code_run.py` into a shared module so both tools use the same set.

**Tech Stack:** Python 3.12+, pytest, ruff

---

### Task 1: Extract shared artifact extensions constant

**Files:**
- Create: `backend/agent/tools/sandbox/constants.py`
- Modify: `backend/agent/tools/sandbox/code_run.py:37-46`

- [ ] **Step 1: Create the shared constants module**

```python
"""Shared constants for sandbox tools."""

from __future__ import annotations

# File extensions treated as output artifacts (not intermediate code/scripts).
# Used by code_run (auto-detection) and file_write (heuristic).
ARTIFACT_EXTENSIONS = frozenset(
    {
        ".docx", ".pptx", ".xlsx",
        ".pdf", ".csv", ".txt", ".md",
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
        ".zip", ".tar", ".gz",
        ".json", ".xml",
        ".mp4", ".mp3",
    }
)
```

- [ ] **Step 2: Update code_run.py to import from constants**

Replace the local `_AUTO_DETECT_EXTENSIONS` definition in `code_run.py` (lines 35-46) with an import:

```python
from agent.tools.sandbox.constants import ARTIFACT_EXTENSIONS as _AUTO_DETECT_EXTENSIONS
```

All existing references to `_AUTO_DETECT_EXTENSIONS` in `code_run.py` (lines 37, 177) remain valid via the alias.

- [ ] **Step 3: Run tests to verify no regressions**

Run: `uv run pytest backend/tests/test_streaming.py -v`
Expected: All `TestCodeRunStreaming` tests pass — the import change is purely structural.

Also run: `uv run ruff check backend/agent/tools/sandbox/constants.py backend/agent/tools/sandbox/code_run.py`
Expected: No lint errors.

- [ ] **Step 4: Commit**

```bash
git add backend/agent/tools/sandbox/constants.py backend/agent/tools/sandbox/code_run.py
git commit -m "refactor: extract ARTIFACT_EXTENSIONS to shared sandbox constants"
```

---

### Task 2: Add `is_artifact` parameter to `file_write`

**Files:**
- Modify: `backend/agent/tools/sandbox/file_ops.py:58-110`
- Create: `backend/tests/test_file_write_artifact.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_file_write_artifact.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest backend/tests/test_file_write_artifact.py -v`
Expected: `test_js_file_is_not_artifact_by_default`, `test_py_file_is_not_artifact_by_default`, `test_explicit_is_artifact_false_suppresses_artifact`, `test_sh_file_is_not_artifact_by_default`, `test_extensionless_file_is_not_artifact_by_default` all FAIL because `file_write` currently always sets `artifact_paths`.

- [ ] **Step 3: Implement the `is_artifact` parameter and heuristic in `FileWrite`**

In `backend/agent/tools/sandbox/file_ops.py`, make these changes:

**Add import at the top (after `import shlex`, before the existing imports from agent):**

```python
import os
```

**Add import from constants (after `from agent.tools.base import ...`):**

```python
from agent.tools.sandbox.constants import ARTIFACT_EXTENSIONS
```

**Update `FileWrite.definition()` input_schema — add `is_artifact` property to the schema (insert after the `content` property):**

```python
                    "is_artifact": {
                        "type": "boolean",
                        "description": (
                            "Whether this file is a final output artifact "
                            "that should be shown to the user (e.g. a report, "
                            "chart, or export). Defaults to auto-detect based "
                            "on file extension. Set to false for intermediate "
                            "helper scripts or temp files."
                        ),
                    },
```

**Replace the return statement in `FileWrite.execute()` (lines 103-110) with:**

```python
        metadata: dict[str, Any] = {
            "path": path,
            "bytes_written": len(content),
        }

        # Determine whether this file should be treated as an artifact.
        # Explicit is_artifact wins; otherwise use extension heuristic.
        is_artifact = kwargs.get("is_artifact")
        if is_artifact is None:
            _, ext = os.path.splitext(path)
            is_artifact = ext.lower() in ARTIFACT_EXTENSIONS
        if is_artifact:
            metadata["artifact_paths"] = [path]

        return ToolResult.ok(
            f"Successfully wrote {len(content)} bytes to {path}",
            metadata=metadata,
        )
```

Note: This also requires adding `Any` to the typing import if not already there. Check the existing import — it already imports `Any` from `typing` on line 6.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest backend/tests/test_file_write_artifact.py -v`
Expected: All 9 tests PASS.

- [ ] **Step 5: Run full test suite and lint**

Run: `uv run pytest backend/tests/ -v --timeout=30`
Run: `uv run ruff check backend/agent/tools/sandbox/file_ops.py`
Expected: No regressions, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add backend/agent/tools/sandbox/file_ops.py backend/tests/test_file_write_artifact.py
git commit -m "feat: add is_artifact param to file_write with extension heuristic

Prevents intermediate script files (e.g. create_docx.js) from showing
in the artifact Files tab. Uses ARTIFACT_EXTENSIONS heuristic when
is_artifact is not explicitly set."
```

---

### Summary

| File | Action |
|------|--------|
| `backend/agent/tools/sandbox/constants.py` | Create — shared `ARTIFACT_EXTENSIONS` |
| `backend/agent/tools/sandbox/code_run.py` | Modify — import from constants instead of local definition |
| `backend/agent/tools/sandbox/file_ops.py` | Modify — add `is_artifact` param + extension heuristic |
| `backend/tests/test_file_write_artifact.py` | Create — 9 test cases covering all scenarios |

**No frontend changes needed** — the fix is entirely backend. The artifact view will simply stop receiving `ARTIFACT_CREATED` events for intermediate script files.
