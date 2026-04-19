"""Tests for code search tools."""

from __future__ import annotations

import json

from agent.tools.base import ExecutionContext
from agent.tools.sandbox.code_search import FileGlob, FileSearch


class TestFileGlob:
    def test_definition(self) -> None:
        tool = FileGlob()
        defn = tool.definition()
        assert defn.name == "file_glob"
        assert defn.execution_context == ExecutionContext.SANDBOX
        assert "pattern" in defn.input_schema["required"]

    async def test_empty_pattern_fails(self) -> None:
        tool = FileGlob()

        class MockSession:
            pass

        result = await tool.execute(session=MockSession(), pattern="")
        assert not result.success
        assert "empty" in result.error.lower()

    async def test_whitespace_pattern_fails(self) -> None:
        tool = FileGlob()

        class MockSession:
            pass

        result = await tool.execute(session=MockSession(), pattern="   ")
        assert not result.success
        assert "empty" in result.error.lower()


class TestFileSearch:
    def test_definition(self) -> None:
        tool = FileSearch()
        defn = tool.definition()
        assert defn.name == "file_search"
        assert defn.execution_context == ExecutionContext.SANDBOX
        assert "pattern" in defn.input_schema["required"]

    async def test_empty_pattern_fails(self) -> None:
        tool = FileSearch()

        class MockSession:
            pass

        result = await tool.execute(session=MockSession(), pattern="")
        assert not result.success

    async def test_whitespace_pattern_fails(self) -> None:
        tool = FileSearch()

        class MockSession:
            pass

        result = await tool.execute(session=MockSession(), pattern="  ")
        assert not result.success

    async def test_uses_scripted_search_without_shell_interpolation(self) -> None:
        tool = FileSearch()
        writes: dict[str, str] = {}

        class MockSession:
            async def write_file(self, path: str, content: str) -> None:
                writes[path] = content

            async def exec(self, command: str, timeout: int | None = None):
                if command == "python3 /tmp/file_search.py":
                    return type(
                        "Result",
                        (),
                        {
                            "exit_code": 0,
                            "stdout": json.dumps(
                                {
                                    "exit_code": 1,
                                    "stdout": "",
                                    "stderr": "",
                                }
                            ),
                            "stderr": "",
                        },
                    )()
                raise AssertionError(f"Unexpected command: {command}")

        result = await tool.execute(
            session=MockSession(),
            pattern="needle",
            path="$(touch /tmp/pwned)",
            include="*.py$(touch /tmp/pwned)",
        )

        assert result.success
        script = writes["/tmp/file_search.py"]
        assert "$(touch /tmp/pwned)" in script
