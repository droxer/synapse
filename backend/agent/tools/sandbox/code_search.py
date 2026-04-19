"""Code search tools for finding files and searching content in the sandbox."""

from __future__ import annotations

import json
import shlex
from typing import Any

from agent.tools.base import (
    ExecutionContext,
    SandboxTool,
    ToolDefinition,
    ToolResult,
)


class FileGlob(SandboxTool):
    """Find files matching a glob pattern in the sandbox."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="file_glob",
            description=(
                "Find files matching a glob pattern. Returns a list of matching file paths "
                "with type and size information. Useful for discovering project structure."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": (
                            "Glob pattern to match files (e.g., '**/*.py', 'src/**/*.ts', '*.json'). "
                            "Searches from /workspace by default."
                        ),
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory to search in. Defaults to /workspace.",
                        "default": "/workspace",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results to return.",
                        "default": 100,
                    },
                },
                "required": ["pattern"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("search", "files", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        pattern: str = kwargs.get("pattern", "")
        path: str = kwargs.get("path", "/workspace")
        max_results: int = kwargs.get("max_results", 100)

        if not pattern.strip():
            return ToolResult.fail("Pattern must not be empty")

        # Use find with -path for glob matching, or python glob for proper support
        script = f'''\
import glob
import os
import json

results = []
pattern = "{pattern.replace('"', '\\"')}"
base = "{path.replace('"', '\\"')}"
full_pattern = os.path.join(base, pattern)

for match in sorted(glob.glob(full_pattern, recursive=True))[:{max_results}]:
    try:
        stat = os.stat(match)
        results.append({{
            "path": match,
            "type": "directory" if os.path.isdir(match) else "file",
            "size": stat.st_size,
        }})
    except OSError:
        results.append({{"path": match, "type": "unknown", "size": 0}})

print(json.dumps(results))
'''
        script_path = "/tmp/file_glob.py"
        await session.write_file(script_path, script)
        result = await session.exec(f"python3 {script_path}", timeout=30)

        if result.exit_code != 0:
            error = result.stderr or result.stdout or "Unknown error"
            return ToolResult.fail(f"Glob search failed: {error}")

        output = result.stdout.strip()
        try:
            matches = json.loads(output)
        except json.JSONDecodeError:
            return ToolResult.fail(f"Failed to parse results: {output}")

        if not matches:
            return ToolResult.ok(
                f"No files found matching '{pattern}' in {path}",
                metadata={"count": 0, "pattern": pattern},
            )

        # Format as readable output
        lines = [f"Found {len(matches)} match(es) for '{pattern}':"]
        for m in matches:
            size_str = f" ({m['size']} bytes)" if m["type"] == "file" else "/"
            lines.append(f"  {m['path']}{size_str if m['type'] == 'file' else '/'}")

        return ToolResult.ok(
            "\n".join(lines),
            metadata={"count": len(matches), "pattern": pattern, "matches": matches},
        )


class FileSearch(SandboxTool):
    """Search file contents using regex patterns in the sandbox."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="file_search",
            description=(
                "Search for a regex pattern in file contents. Returns matching lines with "
                "file paths, line numbers, and surrounding context. Like grep -rn."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search for in file contents.",
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory or file to search in. Defaults to /workspace.",
                        "default": "/workspace",
                    },
                    "include": {
                        "type": "string",
                        "description": "File glob pattern to filter which files to search (e.g., '*.py', '*.ts').",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of matching lines to return.",
                        "default": 50,
                    },
                    "context_lines": {
                        "type": "integer",
                        "description": "Number of context lines before and after each match.",
                        "default": 0,
                    },
                },
                "required": ["pattern"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("search", "content", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        pattern: str = kwargs.get("pattern", "")
        path: str = kwargs.get("path", "/workspace")
        include: str = kwargs.get("include", "")
        max_results: int = kwargs.get("max_results", 50)
        context_lines: int = kwargs.get("context_lines", 0)

        if not pattern.strip():
            return ToolResult.fail("Pattern must not be empty")

        payload = {
            "pattern": pattern,
            "path": path,
            "include": include,
            "max_results": max_results,
            "context_lines": context_lines,
        }
        script = (
            "import json, subprocess\n"
            f"payload = json.loads({json.dumps(payload, ensure_ascii=True)!r})\n"
            "cmd = ['grep', '-rn', '--color=never', '-m', str(payload['max_results'])]\n"
            "context_lines = int(payload.get('context_lines', 0))\n"
            "if context_lines > 0:\n"
            "    cmd.extend(['-C', str(context_lines)])\n"
            "include = str(payload.get('include', '')).strip()\n"
            "if include:\n"
            "    cmd.extend(['--include', include])\n"
            "cmd.extend([payload['pattern'], payload['path']])\n"
            "result = subprocess.run(cmd, capture_output=True, text=True)\n"
            "print(json.dumps({'exit_code': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}))\n"
        )
        script_path = "/tmp/file_search.py"
        await session.write_file(script_path, script)
        result = await session.exec(f"python3 {shlex.quote(script_path)}", timeout=30)

        # grep returns exit code 1 when no matches found
        if result.exit_code != 0:
            error = result.stderr or result.stdout or "Unknown error"
            return ToolResult.fail(f"Search failed: {error}")

        try:
            payload_result = json.loads(result.stdout)
        except json.JSONDecodeError:
            return ToolResult.fail(f"Failed to parse search results: {result.stdout}")

        exit_code = int(payload_result.get("exit_code", 1))
        stdout = str(payload_result.get("stdout", ""))
        stderr = str(payload_result.get("stderr", ""))

        if exit_code == 1 and not stdout:
            return ToolResult.ok(
                f"No matches found for '{pattern}' in {path}",
                metadata={"count": 0, "pattern": pattern},
            )

        if exit_code not in (0, 1):
            return ToolResult.fail(f"Search failed: {stderr or 'Unknown error'}")

        output = stdout.strip()
        if not output:
            return ToolResult.ok(
                f"No matches found for '{pattern}' in {path}",
                metadata={"count": 0, "pattern": pattern},
            )

        # Count actual match lines (exclude context separator lines)
        match_count = sum(
            1 for line in output.split("\n") if line and not line.startswith("--")
        )

        return ToolResult.ok(
            output,
            metadata={"count": match_count, "pattern": pattern, "path": path},
        )
