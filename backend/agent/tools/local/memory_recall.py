"""Tool for recalling entries from memory by substring search."""

from __future__ import annotations

import json

from typing import TYPE_CHECKING, Any

from loguru import logger

from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)

if TYPE_CHECKING:
    from agent.memory.store import PersistentMemoryStore


class MemoryRecall(LocalTool):
    """Search the agent's memory for entries matching a query."""

    def __init__(
        self,
        store: dict[str, str] | None = None,
        persistent_store: PersistentMemoryStore | None = None,
    ) -> None:
        self._store = store if store is not None else {}
        self._persistent = persistent_store

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="memory_search",
            description=(
                "Search agent memory for entries matching a query string. "
                "Searches both conversation-specific and global memories."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Substring to search for in keys and values.",
                    },
                    "namespace": {
                        "type": "string",
                        "description": "Namespace to search within.",
                        "default": "default",
                    },
                },
                "required": ["query"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("memory",),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        query: str = kwargs.get("query", "")
        namespace: str = kwargs.get("namespace", "default")

        if not query.strip():
            return ToolResult.fail("Query must not be empty")

        if self._persistent is not None and self._persistent.is_available:
            try:
                matches = await self._persistent.recall(query, namespace)
                return ToolResult.ok(
                    json.dumps(matches, ensure_ascii=False),
                    metadata={"match_count": len(matches), "namespace": namespace},
                )
            except Exception as exc:
                logger.warning(
                    "memory_persistent_recall_fallback query={} error={}", query, exc
                )

        # Fallback to in-memory search
        prefix = f"{namespace}:"
        query_lower = query.lower()
        matches = {
            k: v
            for k, v in self._store.items()
            if k.startswith(prefix)
            and (query_lower in k.lower() or query_lower in v.lower())
        }
        return ToolResult.ok(
            json.dumps(matches, ensure_ascii=False),
            metadata={"match_count": len(matches), "namespace": namespace},
        )
