from __future__ import annotations

from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult
from agent.tools.registry import ToolRegistry


class _RichTool(LocalTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="rich_tool",
            description="Base description.",
            title="Rich Tool",
            input_schema={"type": "object", "properties": {}},
            output_schema={"type": "object", "properties": {"ok": {"type": "boolean"}}},
            annotations={"readOnlyHint": True, "longRunningHint": False},
            execution_context=ExecutionContext.LOCAL,
            tags=("alpha", "beta"),
        )

    async def execute(self, **kwargs) -> ToolResult:
        return ToolResult.ok("ok")


def test_registry_export_includes_rich_tool_metadata_in_description() -> None:
    registry = ToolRegistry().register(_RichTool())

    tools = registry.to_anthropic_tools()

    assert tools[0]["name"] == "rich_tool"
    assert "Title: Rich Tool" in tools[0]["description"]
    assert "Tags: alpha, beta" in tools[0]["description"]
    assert "Behavior hints:" in tools[0]["description"]
    assert "Output schema:" in tools[0]["description"]
