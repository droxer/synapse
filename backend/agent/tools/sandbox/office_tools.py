"""Office-style document, spreadsheet, slide, and conversion tools."""

from __future__ import annotations

import html
import json
from typing import Any

from agent.tools.base import ExecutionContext, SandboxTool, ToolDefinition, ToolResult

_SCRIPT_PATH = "/tmp/_office_tool.py"


def _artifact_metadata(path: str, **extra: Any) -> dict[str, Any]:
    metadata = {"path": path, "artifact_paths": [path]}
    metadata.update(extra)
    return metadata


class SpreadsheetRead(SandboxTool):
    """Read a CSV or TSV file with a compact preview."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="spreadsheet_read",
            title="Spreadsheet Read",
            description=(
                "Read a CSV or TSV spreadsheet file from the sandbox and return "
                "a tabular preview with row and column counts."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to a .csv or .tsv file.",
                    }
                },
                "required": ["path"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("document", "spreadsheet", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path = str(kwargs.get("path", "")).strip()
        if not path:
            return ToolResult.fail("path must not be empty")

        script = (
            "import csv, json, pathlib\n"
            f"path = pathlib.Path({path!r})\n"
            "delimiter = '\\t' if path.suffix.lower() == '.tsv' else ','\n"
            "with path.open(newline='', encoding='utf-8') as handle:\n"
            "    rows = list(csv.reader(handle, delimiter=delimiter))\n"
            "preview = rows[:25]\n"
            "payload = {\n"
            "    'row_count': len(rows),\n"
            "    'column_count': max((len(r) for r in rows), default=0),\n"
            "    'preview': preview,\n"
            "}\n"
            "print(json.dumps(payload, ensure_ascii=False))\n"
        )
        await session.write_file(_SCRIPT_PATH, script)
        result = await session.exec(f"python3 {_SCRIPT_PATH}", timeout=20)
        if result.exit_code != 0:
            return ToolResult.fail(
                result.stderr or result.stdout or "Failed to read spreadsheet"
            )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            return ToolResult.fail(
                f"Invalid spreadsheet preview payload: {result.stdout[:200]}"
            )

        preview_rows = payload.get("preview", [])
        lines = [
            f"Rows: {payload.get('row_count', 0)}",
            f"Columns: {payload.get('column_count', 0)}",
            "",
            "Preview:",
        ]
        for row in preview_rows:
            lines.append(" | ".join(str(cell) for cell in row))
        return ToolResult.ok(
            "\n".join(lines),
            metadata={
                "path": path,
                "row_count": payload.get("row_count", 0),
                "column_count": payload.get("column_count", 0),
            },
        )


class SpreadsheetWrite(SandboxTool):
    """Write a CSV or TSV spreadsheet artifact."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="spreadsheet_write",
            title="Spreadsheet Write",
            description=(
                "Create or overwrite a CSV/TSV spreadsheet file. Provide either "
                "raw content or structured columns/rows."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute output path."},
                    "content": {
                        "type": "string",
                        "description": "Raw CSV/TSV content to write.",
                    },
                    "columns": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional header row.",
                    },
                    "rows": {
                        "type": "array",
                        "items": {
                            "type": "array",
                            "items": {"type": ["string", "number", "boolean", "null"]},
                        },
                        "description": "Structured rows written after the header.",
                    },
                    "delimiter": {
                        "type": "string",
                        "description": "Field delimiter, defaults from file extension.",
                    },
                },
                "required": ["path"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("document", "spreadsheet", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path = str(kwargs.get("path", "")).strip()
        if not path:
            return ToolResult.fail("path must not be empty")

        raw_content = kwargs.get("content")
        if isinstance(raw_content, str) and raw_content:
            await session.write_file(path, raw_content)
            return ToolResult.ok(
                f"Wrote spreadsheet to {path}",
                metadata=_artifact_metadata(path),
            )

        payload = {
            "path": path,
            "columns": kwargs.get("columns", []),
            "rows": kwargs.get("rows", []),
            "delimiter": kwargs.get("delimiter"),
        }
        script = (
            "import csv, json, pathlib\n"
            f"payload = json.loads({json.dumps(payload, ensure_ascii=True)!r})\n"
            "path = pathlib.Path(payload['path'])\n"
            "delimiter = payload.get('delimiter') or ('\\t' if path.suffix.lower() == '.tsv' else ',')\n"
            "path.parent.mkdir(parents=True, exist_ok=True)\n"
            "with path.open('w', newline='', encoding='utf-8') as handle:\n"
            "    writer = csv.writer(handle, delimiter=delimiter)\n"
            "    columns = payload.get('columns') or []\n"
            "    if columns:\n"
            "        writer.writerow(columns)\n"
            "    for row in payload.get('rows') or []:\n"
            "        writer.writerow(row)\n"
        )
        await session.write_file(_SCRIPT_PATH, script)
        result = await session.exec(f"python3 {_SCRIPT_PATH}", timeout=20)
        if result.exit_code != 0:
            return ToolResult.fail(
                result.stderr or result.stdout or "Failed to write spreadsheet"
            )
        return ToolResult.ok(
            f"Wrote spreadsheet to {path}",
            metadata=_artifact_metadata(path),
        )


class SpreadsheetEdit(SandboxTool):
    """Edit a CSV or TSV spreadsheet."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="spreadsheet_edit",
            title="Spreadsheet Edit",
            description=(
                "Edit a CSV/TSV spreadsheet by appending rows or updating a cell."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "operation": {
                        "type": "string",
                        "enum": ["append_rows", "update_cell"],
                    },
                    "rows": {
                        "type": "array",
                        "items": {
                            "type": "array",
                            "items": {"type": ["string", "number", "boolean", "null"]},
                        },
                    },
                    "row_index": {"type": "integer"},
                    "column": {
                        "type": ["string", "integer"],
                        "description": "Column name or zero-based index.",
                    },
                    "has_header": {
                        "type": "boolean",
                        "description": (
                            "Whether the first row is a header row when updating a cell. "
                            "Defaults to true when column is a name, otherwise false."
                        ),
                    },
                    "value": {"type": ["string", "number", "boolean", "null"]},
                },
                "required": ["path", "operation"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("document", "spreadsheet", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path = str(kwargs.get("path", "")).strip()
        operation = str(kwargs.get("operation", "")).strip()
        if not path:
            return ToolResult.fail("path must not be empty")
        if operation not in {"append_rows", "update_cell"}:
            return ToolResult.fail("operation must be append_rows or update_cell")

        payload = {
            "path": path,
            "operation": operation,
            "rows": kwargs.get("rows", []),
            "row_index": kwargs.get("row_index"),
            "column": kwargs.get("column"),
            "has_header": kwargs.get("has_header"),
            "value": kwargs.get("value"),
        }
        script = (
            "import csv, json, pathlib\n"
            f"payload = json.loads({json.dumps(payload, ensure_ascii=True)!r})\n"
            "path = pathlib.Path(payload['path'])\n"
            "delimiter = '\\t' if path.suffix.lower() == '.tsv' else ','\n"
            "with path.open(newline='', encoding='utf-8') as handle:\n"
            "    rows = list(csv.reader(handle, delimiter=delimiter))\n"
            "op = payload['operation']\n"
            "if op == 'append_rows':\n"
            "    rows.extend(payload.get('rows') or [])\n"
            "else:\n"
            "    row_index = payload.get('row_index')\n"
            "    column = payload.get('column')\n"
            "    if row_index is None or column is None:\n"
            "        raise SystemExit('row_index and column are required for update_cell')\n"
            "    if isinstance(column, str):\n"
            "        if not rows:\n"
            "            raise SystemExit('cannot resolve column name without a header row')\n"
            "        try:\n"
            "            column_index = rows[0].index(column)\n"
            "        except ValueError as exc:\n"
            "            raise SystemExit(f'unknown column: {column}') from exc\n"
            "    else:\n"
            "        column_index = int(column)\n"
            "    has_header = payload.get('has_header')\n"
            "    if has_header is None:\n"
            "        has_header = isinstance(column, str)\n"
            "    target_row = int(row_index) + (1 if has_header else 0)\n"
            "    if target_row < 0 or target_row >= len(rows):\n"
            "        raise SystemExit('row_index out of range')\n"
            "    row = rows[target_row]\n"
            "    while column_index >= len(row):\n"
            "        row.append('')\n"
            "    row[column_index] = '' if payload.get('value') is None else str(payload.get('value'))\n"
            "with path.open('w', newline='', encoding='utf-8') as handle:\n"
            "    writer = csv.writer(handle, delimiter=delimiter)\n"
            "    writer.writerows(rows)\n"
        )
        await session.write_file(_SCRIPT_PATH, script)
        result = await session.exec(f"python3 {_SCRIPT_PATH}", timeout=20)
        if result.exit_code != 0:
            return ToolResult.fail(
                result.stderr or result.stdout or "Failed to edit spreadsheet"
            )
        return ToolResult.ok(
            f"Updated spreadsheet {path}",
            metadata=_artifact_metadata(path),
        )


class DocumentWrite(SandboxTool):
    """Write a text-like document artifact."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="document_write",
            title="Document Write",
            description="Create or overwrite a document file such as .txt, .md, .html, or .json.",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("document", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path = str(kwargs.get("path", "")).strip()
        content = str(kwargs.get("content", ""))
        if not path:
            return ToolResult.fail("path must not be empty")
        await session.write_file(path, content)
        return ToolResult.ok(
            f"Wrote document to {path}",
            metadata=_artifact_metadata(path),
        )


class DocumentEdit(SandboxTool):
    """Edit an existing text document."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="document_edit",
            title="Document Edit",
            description="Append to or replace text inside an existing document.",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "operation": {
                        "type": "string",
                        "enum": ["append", "replace"],
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to append when operation=append.",
                    },
                    "old_text": {
                        "type": "string",
                        "description": "Text to replace when operation=replace.",
                    },
                    "new_text": {
                        "type": "string",
                        "description": "Replacement text when operation=replace.",
                    },
                },
                "required": ["path", "operation"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("document", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path = str(kwargs.get("path", "")).strip()
        operation = str(kwargs.get("operation", "")).strip()
        if not path:
            return ToolResult.fail("path must not be empty")
        if operation not in {"append", "replace"}:
            return ToolResult.fail("operation must be append or replace")
        try:
            content = await session.read_file(path)
        except Exception as exc:
            return ToolResult.fail(f"Failed to read document: {exc}")

        if operation == "append":
            text = str(kwargs.get("text", ""))
            if not text:
                return ToolResult.fail("text must not be empty for append")
            updated = f"{content}{text}"
        else:
            old_text = str(kwargs.get("old_text", ""))
            new_text = str(kwargs.get("new_text", ""))
            if not old_text:
                return ToolResult.fail("old_text must not be empty for replace")
            if old_text not in content:
                return ToolResult.fail("old_text not found in document")
            updated = content.replace(old_text, new_text, 1)

        await session.write_file(path, updated)
        return ToolResult.ok(
            f"Updated document {path}",
            metadata=_artifact_metadata(path),
        )


def _render_slides_html(title: str, slides: list[dict[str, Any]]) -> str:
    sections: list[str] = []
    for slide in slides:
        slide_title = html.escape(str(slide.get("title", "")).strip() or "Untitled")
        body = html.escape(str(slide.get("body", "")).strip())
        bullets = slide.get("bullets", [])
        bullet_html = ""
        if isinstance(bullets, list) and bullets:
            bullet_html = (
                "<ul>"
                + "".join(f"<li>{html.escape(str(item))}</li>" for item in bullets)
                + "</ul>"
            )
        sections.append(
            '<section class="slide">'
            f"<h2>{slide_title}</h2>"
            f"<p>{body}</p>"
            f"{bullet_html}"
            "</section>"
        )
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        f"<title>{html.escape(title)}</title>"
        "<style>"
        "body{margin:0;font-family:Arial,sans-serif;background:#f5f7fb;color:#111827;}"
        ".deck{display:flex;flex-direction:column;gap:24px;padding:32px;}"
        ".slide{min-height:420px;background:white;border:1px solid #d0d7e2;border-radius:20px;padding:40px;box-shadow:0 20px 40px rgba(15,23,42,0.08);}"
        ".slide h2{margin:0 0 20px;font-size:32px;}"
        ".slide p,.slide li{font-size:20px;line-height:1.5;}"
        "ul{margin-top:16px;}"
        "</style></head><body>"
        f'<main class="deck">{"".join(sections)}</main>'
        "</body></html>"
    )


class SlidesCreate(SandboxTool):
    """Create a lightweight HTML slide deck artifact."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="slides_create",
            title="Slides Create",
            description="Create an HTML slide deck artifact from structured slide data.",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "title": {"type": "string"},
                    "slides": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "body": {"type": "string"},
                                "bullets": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                            },
                            "required": ["title"],
                        },
                    },
                },
                "required": ["path", "slides"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("document", "slides", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path = str(kwargs.get("path", "")).strip()
        slides = kwargs.get("slides", [])
        if not path:
            return ToolResult.fail("path must not be empty")
        if not isinstance(slides, list) or not slides:
            return ToolResult.fail("slides must contain at least one slide")
        title = str(kwargs.get("title", "")).strip() or "Slide Deck"
        html = _render_slides_html(title, slides)
        await session.write_file(path, html)
        return ToolResult.ok(
            f"Created slide deck at {path}",
            metadata=_artifact_metadata(path),
        )


class SlidesEdit(SandboxTool):
    """Edit a lightweight HTML slide deck artifact."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="slides_edit",
            title="Slides Edit",
            description="Append a slide or replace an existing HTML slide deck.",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "operation": {
                        "type": "string",
                        "enum": ["append_slide", "replace_all"],
                    },
                    "title": {"type": "string"},
                    "slide": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "body": {"type": "string"},
                            "bullets": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                        },
                    },
                    "slides": {
                        "type": "array",
                        "items": {"type": "object"},
                    },
                },
                "required": ["path", "operation"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("document", "slides", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path = str(kwargs.get("path", "")).strip()
        operation = str(kwargs.get("operation", "")).strip()
        if not path:
            return ToolResult.fail("path must not be empty")
        if operation not in {"append_slide", "replace_all"}:
            return ToolResult.fail("operation must be append_slide or replace_all")

        if operation == "replace_all":
            slides = kwargs.get("slides", [])
            if not isinstance(slides, list) or not slides:
                return ToolResult.fail("slides must contain at least one slide")
            title = str(kwargs.get("title", "")).strip() or "Slide Deck"
            html = _render_slides_html(title, slides)
            await session.write_file(path, html)
        else:
            slide = kwargs.get("slide")
            if not isinstance(slide, dict):
                return ToolResult.fail("slide must be an object for append_slide")
            snippet = _render_slides_html("Slide Deck", [slide])
            try:
                current = await session.read_file(path)
            except Exception as exc:
                return ToolResult.fail(f"Failed to read slide deck: {exc}")
            marker = '<main class="deck">'
            end_marker = "</main>"
            if marker not in current or end_marker not in current:
                return ToolResult.fail(
                    "Existing slide deck does not match the expected HTML format"
                )
            snippet_body = snippet.split(marker, 1)[1].split(end_marker, 1)[0]
            updated = current.replace(end_marker, f"{snippet_body}{end_marker}", 1)
            await session.write_file(path, updated)

        return ToolResult.ok(
            f"Updated slide deck {path}",
            metadata=_artifact_metadata(path),
        )


class FileConvert(SandboxTool):
    """Convert between a small set of common text and data formats."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="file_convert",
            title="File Convert",
            description=(
                "Convert between plain text, markdown, HTML, CSV/TSV, and JSON "
                "for lightweight office-style workflows."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "source_path": {"type": "string"},
                    "target_path": {"type": "string"},
                },
                "required": ["source_path", "target_path"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("document", "conversion", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        source_path = str(kwargs.get("source_path", "")).strip()
        target_path = str(kwargs.get("target_path", "")).strip()
        if not source_path or not target_path:
            return ToolResult.fail("source_path and target_path must not be empty")

        payload = {"source_path": source_path, "target_path": target_path}
        script = (
            "import csv, html, json, pathlib, re\n"
            f"payload = json.loads({json.dumps(payload, ensure_ascii=True)!r})\n"
            "source = pathlib.Path(payload['source_path'])\n"
            "target = pathlib.Path(payload['target_path'])\n"
            "target.parent.mkdir(parents=True, exist_ok=True)\n"
            "src_ext = source.suffix.lower()\n"
            "dst_ext = target.suffix.lower()\n"
            "text = source.read_text(encoding='utf-8')\n"
            "if src_ext in {'.txt', '.md'} and dst_ext == '.html':\n"
            "    body = ''.join(f'<p>{html.escape(line)}</p>' for line in text.splitlines() if line.strip())\n"
            "    target.write_text(f'<!doctype html><html><body>{body}</body></html>', encoding='utf-8')\n"
            "elif src_ext == '.html' and dst_ext in {'.txt', '.md'}:\n"
            "    cleaned = re.sub(r'<[^>]+>', '', text)\n"
            "    target.write_text(cleaned.strip(), encoding='utf-8')\n"
            "elif src_ext in {'.csv', '.tsv'} and dst_ext == '.json':\n"
            "    delimiter = '\\t' if src_ext == '.tsv' else ','\n"
            "    with source.open(newline='', encoding='utf-8') as handle:\n"
            "        rows = list(csv.DictReader(handle, delimiter=delimiter))\n"
            "    target.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')\n"
            "elif src_ext == '.json' and dst_ext in {'.csv', '.tsv'}:\n"
            "    rows = json.loads(text)\n"
            "    if not isinstance(rows, list) or not rows:\n"
            "        raise SystemExit('JSON input must be a non-empty array of objects')\n"
            "    if not all(isinstance(row, dict) for row in rows):\n"
            "        raise SystemExit('JSON rows must be objects')\n"
            "    fieldnames = list(rows[0].keys())\n"
            "    delimiter = '\\t' if dst_ext == '.tsv' else ','\n"
            "    with target.open('w', newline='', encoding='utf-8') as handle:\n"
            "        writer = csv.DictWriter(handle, fieldnames=fieldnames, delimiter=delimiter)\n"
            "        writer.writeheader()\n"
            "        writer.writerows(rows)\n"
            "else:\n"
            "    raise SystemExit(f'Unsupported conversion: {src_ext} -> {dst_ext}')\n"
        )
        await session.write_file(_SCRIPT_PATH, script)
        result = await session.exec(f"python3 {_SCRIPT_PATH}", timeout=20)
        if result.exit_code != 0:
            return ToolResult.fail(
                result.stderr or result.stdout or "Failed to convert file"
            )
        return ToolResult.ok(
            f"Converted {source_path} to {target_path}",
            metadata=_artifact_metadata(target_path, source_path=source_path),
        )
