"""Meta-tool for inter-agent messaging during execution."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any
from uuid import uuid4

from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)


class AgentMessageBus:
    """In-memory message bus for inter-agent communication.

    Messages are stored per-recipient and can be polled.
    Thread-safe via asyncio (single-threaded event loop).
    """

    def __init__(self) -> None:
        self._mailboxes: dict[str, list[dict[str, Any]]] = {}
        self._broadcast: list[dict[str, Any]] = []
        self._broadcast_cursor_by_agent: dict[str, int] = {}

    def send(
        self,
        from_id: str,
        to_id: str,
        message: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Send a message to a specific agent."""
        msg = {
            "message_id": f"msg_{uuid4().hex[:12]}",
            "from": from_id,
            "to": to_id,
            "message": message,
            "sent_at": time.time(),
            "metadata": metadata or {},
        }
        if to_id not in self._mailboxes:
            self._mailboxes[to_id] = []
        self._mailboxes[to_id].append(msg)

    def broadcast(
        self,
        from_id: str,
        message: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Broadcast a message to all agents."""
        msg = {
            "message_id": f"msg_{uuid4().hex[:12]}",
            "from": from_id,
            "to": "all",
            "message": message,
            "sent_at": time.time(),
            "metadata": metadata or {},
        }
        self._broadcast.append(msg)

    def receive(self, agent_id: str) -> list[dict[str, Any]]:
        """Get all pending messages for an agent (drains the mailbox)."""
        direct = self._mailboxes.pop(agent_id, [])
        start = self._broadcast_cursor_by_agent.get(agent_id, 0)
        # Include unseen broadcasts not from self.
        broadcasts = [m for m in self._broadcast[start:] if m["from"] != agent_id]
        self._broadcast_cursor_by_agent[agent_id] = len(self._broadcast)
        return direct + broadcasts

    def clear(self) -> None:
        """Clear all messages."""
        self._mailboxes.clear()
        self._broadcast.clear()
        self._broadcast_cursor_by_agent.clear()


class SendToAgent(LocalTool):
    """Send a message to another running agent."""

    def __init__(
        self,
        message_bus: AgentMessageBus,
        sender_id: str = "",
        target_validator: Callable[[str], bool] | None = None,
    ) -> None:
        self._bus = message_bus
        self._sender_id = sender_id
        self._target_validator = target_validator

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="agent_send",
            description=(
                "Send a message to another running agent by ID, or broadcast "
                "to all agents. Useful for sharing intermediate results, "
                "coordinating work, or requesting information."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": (
                            "Target agent ID. Use 'all' to broadcast to all agents."
                        ),
                    },
                    "message": {
                        "type": "string",
                        "description": "Message content to send.",
                    },
                },
                "required": ["agent_id", "message"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("meta", "agent", "messaging"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        target_id: str = kwargs.get("agent_id", "")
        message: str = kwargs.get("message", "")

        if not target_id.strip():
            return ToolResult.fail("agent_id must not be empty")
        if not message.strip():
            return ToolResult.fail("message must not be empty")

        if target_id == "all":
            self._bus.broadcast(self._sender_id, message)
            return ToolResult.ok("Message broadcast to all agents.")
        if self._target_validator is not None and not self._target_validator(target_id):
            return ToolResult.fail(f"Unknown or inactive agent_id: {target_id}")

        self._bus.send(self._sender_id, target_id, message)
        return ToolResult.ok(f"Message sent to agent {target_id[:8]}.")


class ReceiveMessages(LocalTool):
    """Receive pending messages from other agents."""

    def __init__(self, message_bus: AgentMessageBus, receiver_id: str = "") -> None:
        self._bus = message_bus
        self._receiver_id = receiver_id

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="agent_receive",
            description=(
                "Check for and receive any pending messages from other "
                "agents. Returns all unread messages."
            ),
            input_schema={
                "type": "object",
                "properties": {},
                "required": [],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("meta", "agent", "messaging"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        messages = self._bus.receive(self._receiver_id)

        if not messages:
            return ToolResult.ok(
                "No pending messages.",
                metadata={"count": 0},
            )

        return ToolResult.ok(
            json.dumps(messages, ensure_ascii=False),
            metadata={"count": len(messages)},
        )
