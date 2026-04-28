"""Tool for listing all memory entries."""

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
from agent.memory.safety import validate_memory_text

if TYPE_CHECKING:
    from agent.memory.store import PersistentMemoryStore


class MemoryList(LocalTool):
    """List all entries in the agent's memory."""

    def __init__(
        self,
        store: dict[str, str] | None = None,
        persistent_store: PersistentMemoryStore | None = None,
    ) -> None:
        self._store = store if store is not None else {}
        self._persistent = persistent_store

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="memory_list",
            description=(
                "List stored memory entries in a namespace. Reads persistent "
                "user-scoped memory when available, otherwise the current runtime store."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "namespace": {
                        "type": "string",
                        "description": "Namespace to list entries from.",
                        "default": "default",
                    },
                },
                "required": [],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("memory",),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        namespace: str = kwargs.get("namespace", "default")

        if self._persistent is not None and self._persistent.is_available:
            try:
                entries = await self._persistent.list_entries(namespace)
                return ToolResult.ok(
                    json.dumps(entries, ensure_ascii=False),
                    metadata={
                        "count": len(entries),
                        "namespace": namespace,
                        "persistent": True,
                    },
                )
            except Exception as exc:
                logger.warning(
                    "memory_persistent_list_fallback namespace={} error={}",
                    namespace,
                    exc,
                )

        # Fallback to in-memory
        prefix = f"{namespace}:"
        matches = {
            k: v
            for k, v in self._store.items()
            if k.startswith(prefix)
            and validate_memory_text(k).accepted
            and validate_memory_text(v).accepted
        }
        return ToolResult.ok(
            json.dumps(matches, ensure_ascii=False),
            metadata={
                "count": len(matches),
                "namespace": namespace,
                "persistent": False,
            },
        )
