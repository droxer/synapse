"""Tool for storing key-value pairs in persistent memory."""

from __future__ import annotations

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


class MemoryStore(LocalTool):
    """Store a value in the agent's memory under a namespaced key."""

    def __init__(
        self,
        store: dict[str, str] | None = None,
        persistent_store: PersistentMemoryStore | None = None,
    ) -> None:
        self._store = store if store is not None else {}
        self._persistent = persistent_store

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="memory_store",
            description=(
                "Store a key-value pair in the agent's persistent memory. "
                "Memory persists across conversations."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "The key to store the value under.",
                    },
                    "value": {
                        "type": "string",
                        "description": "The value to store.",
                    },
                    "namespace": {
                        "type": "string",
                        "description": "Namespace for grouping related entries.",
                        "default": "default",
                    },
                },
                "required": ["key", "value"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("memory",),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        key: str = kwargs.get("key", "")
        value: str = kwargs.get("value", "")
        namespace: str = kwargs.get("namespace", "default")

        if not key.strip():
            return ToolResult.fail("Key must not be empty")
        if not value:
            return ToolResult.fail("Value must not be empty")

        if self._persistent is not None and self._persistent.is_available:
            try:
                await self._persistent.store(key, value, namespace)
                return ToolResult.ok(
                    f"Stored value under '{namespace}:{key}' (persistent).",
                    metadata={"namespace": namespace, "key": key, "persistent": True},
                )
            except Exception as exc:
                logger.warning(
                    "memory_persistent_store_fallback key={} error={}", key, exc
                )

        compound_key = f"{namespace}:{key}"
        self._store[compound_key] = value
        return ToolResult.ok(
            f"Stored value under '{compound_key}'.",
            metadata={"namespace": namespace, "key": key, "persistent": False},
        )
