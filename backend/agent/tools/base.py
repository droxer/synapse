"""Base tool abstractions with sandbox affinity."""

from __future__ import annotations

import types
from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ExecutionContext(Enum):
    """Where a tool should be executed."""

    LOCAL = "local"
    SANDBOX = "sandbox"


@dataclass(frozen=True)
class ToolResult:
    """Immutable result of a tool execution."""

    success: bool
    output: str
    error: str | None = None
    metadata: types.MappingProxyType[str, Any] | dict[str, Any] | None = None

    @classmethod
    def ok(cls, output: str, metadata: dict[str, Any] | None = None) -> ToolResult:
        """Create a successful result."""
        frozen_metadata = (
            types.MappingProxyType(metadata) if metadata is not None else None
        )
        return cls(success=True, output=output, metadata=frozen_metadata)

    @classmethod
    def fail(cls, error: str) -> ToolResult:
        """Create a failed result."""
        return cls(success=False, output="", error=error)


@dataclass(frozen=True)
class ToolDefinition:
    """Immutable description of a tool's interface."""

    name: str
    description: str
    input_schema: Mapping[str, Any]
    execution_context: ExecutionContext
    title: str | None = None
    output_schema: Mapping[str, Any] | None = None
    annotations: Mapping[str, Any] = field(default_factory=dict)
    tags: tuple[str, ...] = field(default=())


class LocalTool(ABC):
    """Abstract base for tools that run in the local process."""

    @abstractmethod
    def definition(self) -> ToolDefinition:
        """Return the tool's definition."""

    @abstractmethod
    async def execute(self, **kwargs: Any) -> ToolResult:
        """Execute the tool with the given arguments."""


class SandboxTool(ABC):
    """Abstract base for tools that run inside a sandbox."""

    @abstractmethod
    def definition(self) -> ToolDefinition:
        """Return the tool's definition."""

    @abstractmethod
    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        """Execute the tool within a sandbox session."""
