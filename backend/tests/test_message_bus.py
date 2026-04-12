"""Tests for inter-agent messaging."""

from __future__ import annotations

import json

from agent.tools.meta.send_message import (
    AgentMessageBus,
    ReceiveMessages,
    SendToAgent,
)


class TestAgentMessageBus:
    def test_send_and_receive(self) -> None:
        bus = AgentMessageBus()
        bus.send("a1", "a2", "hello")
        msgs = bus.receive("a2")
        assert len(msgs) == 1
        assert msgs[0]["message"] == "hello"
        assert msgs[0]["from"] == "a1"

    def test_receive_drains_direct_mailbox(self) -> None:
        bus = AgentMessageBus()
        bus.send("a1", "a2", "msg1")
        bus.receive("a2")
        # Direct messages are drained, but broadcasts persist
        bus2_msgs = bus.receive("a2")
        # No direct messages remain
        direct_msgs = [m for m in bus2_msgs if m["to"] != "all"]
        assert len(direct_msgs) == 0

    def test_broadcast(self) -> None:
        bus = AgentMessageBus()
        bus.broadcast("a1", "hey all")
        msgs_a2 = bus.receive("a2")
        msgs_a3 = bus.receive("a3")
        assert len(msgs_a2) >= 1
        assert len(msgs_a3) >= 1
        assert msgs_a2[0]["to"] == "all"

    def test_broadcast_excludes_sender(self) -> None:
        bus = AgentMessageBus()
        bus.broadcast("a1", "hey all")
        msgs = bus.receive("a1")
        assert len(msgs) == 0

    def test_broadcast_is_not_redelivered(self) -> None:
        bus = AgentMessageBus()
        bus.broadcast("a1", "hey all")
        first = bus.receive("a2")
        second = bus.receive("a2")
        assert len(first) == 1
        assert second == []

    def test_clear(self) -> None:
        bus = AgentMessageBus()
        bus.send("a1", "a2", "msg")
        bus.broadcast("a1", "bcast")
        bus.clear()
        assert bus.receive("a2") == []

    def test_multiple_messages(self) -> None:
        bus = AgentMessageBus()
        bus.send("a1", "a2", "msg1")
        bus.send("a3", "a2", "msg2")
        msgs = bus.receive("a2")
        assert len(msgs) == 2


class TestSendToAgent:
    async def test_send_direct(self) -> None:
        bus = AgentMessageBus()
        tool = SendToAgent(bus, sender_id="agent1")
        result = await tool.execute(agent_id="agent2", message="hello")
        assert result.success
        msgs = bus.receive("agent2")
        assert len(msgs) == 1

    async def test_send_broadcast(self) -> None:
        bus = AgentMessageBus()
        tool = SendToAgent(bus, sender_id="agent1")
        result = await tool.execute(agent_id="all", message="hey")
        assert result.success

    async def test_empty_message_fails(self) -> None:
        bus = AgentMessageBus()
        tool = SendToAgent(bus, sender_id="agent1")
        result = await tool.execute(agent_id="agent2", message="")
        assert not result.success

    async def test_empty_agent_id_fails(self) -> None:
        bus = AgentMessageBus()
        tool = SendToAgent(bus, sender_id="agent1")
        result = await tool.execute(agent_id="", message="hello")
        assert not result.success

    async def test_unknown_target_fails(self) -> None:
        bus = AgentMessageBus()
        tool = SendToAgent(
            bus,
            sender_id="agent1",
            target_validator=lambda target_id: target_id == "agent2",
        )
        result = await tool.execute(agent_id="missing", message="hello")
        assert not result.success


class TestReceiveMessages:
    async def test_no_messages(self) -> None:
        bus = AgentMessageBus()
        tool = ReceiveMessages(bus, receiver_id="agent1")
        result = await tool.execute()
        assert result.success
        assert result.metadata["count"] == 0

    async def test_with_messages(self) -> None:
        bus = AgentMessageBus()
        bus.send("agent2", "agent1", "hello")
        tool = ReceiveMessages(bus, receiver_id="agent1")
        result = await tool.execute()
        assert result.success
        assert result.metadata["count"] == 1
        msgs = json.loads(result.output)
        assert msgs[0]["message"] == "hello"
