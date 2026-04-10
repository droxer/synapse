"""Tool registry for managing and querying available tools."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    SandboxTool,
    ToolDefinition,
)


class ToolRegistry:
    """Immutable-style registry of available tools.

    Each mutation method returns a new registry instance,
    leaving the original unchanged.
    """

    def __init__(
        self,
        tools: dict[str, LocalTool | SandboxTool] | None = None,
    ) -> None:
        self._tools: dict[str, LocalTool | SandboxTool] = dict(tools) if tools else {}

    # -- Mutation (returns new registry) ------------------------------------

    def register(self, tool: LocalTool | SandboxTool) -> ToolRegistry:
        """Return a new registry with *tool* added.

        Raises ValueError if a tool with the same name is already registered.
        """
        definition = tool.definition()
        name = definition.name

        if name in self._tools:
            raise ValueError(f"Tool already registered: {name}")

        new_tools = {**self._tools, name: tool}
        return ToolRegistry(tools=new_tools)

    def replace_tool(self, tool: LocalTool | SandboxTool) -> ToolRegistry:
        """Return a new registry with *tool* replaced (or added if new).

        Unlike register(), this does not raise on duplicate names.
        """
        definition = tool.definition()
        name = definition.name
        new_tools = {**self._tools, name: tool}
        return ToolRegistry(tools=new_tools)

    def filter_by_names(self, names: set[str]) -> ToolRegistry:
        """Return a new registry containing only tools whose names are in *names*."""
        filtered = {name: tool for name, tool in self._tools.items() if name in names}
        return ToolRegistry(tools=filtered)

    def filter_by_names_or_tags(
        self,
        names: set[str],
        tags: set[str],
    ) -> ToolRegistry:
        """Return a registry keeping tools matched by name or tag."""
        filtered = {
            name: tool
            for name, tool in self._tools.items()
            if name in names or bool(tags & set(tool.definition().tags or ()))
        }
        return ToolRegistry(tools=filtered)

    def remove_by_tag(self, tag: str) -> ToolRegistry:
        """Return a new registry excluding tools that carry *tag*."""
        filtered = {
            name: tool
            for name, tool in self._tools.items()
            if tag not in (tool.definition().tags or ())
        }
        return ToolRegistry(tools=filtered)

    def merge(self, other: ToolRegistry) -> ToolRegistry:
        """Return a new registry containing tools from both *self* and *other*.

        Raises ValueError if any tool names collide.
        """
        collisions = set(self._tools) & set(other._tools)
        if collisions:
            raise ValueError(f"Tool name collision during merge: {collisions}")
        merged = {**self._tools, **other._tools}
        return ToolRegistry(tools=merged)

    # -- Queries ------------------------------------------------------------

    def get(self, name: str) -> LocalTool | SandboxTool | None:
        """Look up a tool by name, returning None if not found."""
        return self._tools.get(name)

    def list_tools(self) -> tuple[ToolDefinition, ...]:
        """Return definitions of all registered tools."""
        return tuple(tool.definition() for tool in self._tools.values())

    def is_sandbox_tool(self, name: str) -> bool:
        """Return True if *name* refers to a SandboxTool."""
        tool = self._tools.get(name)
        if tool is None:
            raise KeyError(f"Unknown tool: {name}")
        return isinstance(tool, SandboxTool)

    # -- Serialisation helpers ----------------------------------------------

    def _json_safe(self, value: Any) -> Any:
        """Normalize nested mapping/sequence values to JSON-serializable types."""
        if isinstance(value, Mapping):
            return {str(key): self._json_safe(nested) for key, nested in value.items()}
        if isinstance(value, list | tuple):
            return [self._json_safe(item) for item in value]
        return value

    def to_anthropic_tools(self) -> list[dict[str, Any]]:
        """Convert all tools to Anthropic API format."""
        results: list[dict[str, Any]] = []
        for tool in self._tools.values():
            defn = tool.definition()
            results.append(
                {
                    "name": defn.name,
                    "description": defn.description,
                    "input_schema": self._json_safe(defn.input_schema),
                }
            )
        return results

    def grouped_descriptions(self) -> str:
        """Return a human-readable string grouping tools by execution context."""
        groups: dict[ExecutionContext, list[ToolDefinition]] = {
            ExecutionContext.LOCAL: [],
            ExecutionContext.SANDBOX: [],
        }

        for tool in self._tools.values():
            defn = tool.definition()
            groups[defn.execution_context].append(defn)

        lines: list[str] = []
        for ctx, definitions in groups.items():
            if not definitions:
                continue
            lines.append(f"[{ctx.value.upper()}]")
            for defn in definitions:
                tags = f"  ({', '.join(defn.tags)})" if defn.tags else ""
                lines.append(f"  - {defn.name}: {defn.description}{tags}")
            lines.append("")

        return "\n".join(lines).rstrip()
