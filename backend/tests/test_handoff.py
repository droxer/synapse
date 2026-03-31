"""Tests for agent handoff functionality."""

import asyncio
from unittest.mock import MagicMock

import pytest

from agent.runtime.sub_agent_manager import SubAgentManager, _format_handoff_context
from agent.runtime.task_runner import (
    AgentResult,
    HandoffRequest,
    TaskAgentConfig,
    TaskAgentRunner,
)
from agent.tools.meta.handoff import AgentHandoff
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter


class TestHandoffRequest:
    def test_frozen(self):
        req = HandoffRequest(
            target_role="reviewer",
            task_description="Review the code",
            context="Code is complete",
            source_messages=({"role": "user", "content": "hello"},),
            remaining_handoffs=2,
        )
        with pytest.raises(AttributeError):
            req.target_role = "coder"

    def test_fields(self):
        req = HandoffRequest(
            target_role="reviewer",
            task_description="Review the code",
            context="",
            source_messages=(),
            remaining_handoffs=3,
        )
        assert req.target_role == "reviewer"
        assert req.task_description == "Review the code"
        assert req.remaining_handoffs == 3


class TestTaskAgentConfigMaxHandoffs:
    def test_default_max_handoffs(self):
        cfg = TaskAgentConfig(task_description="test")
        assert cfg.max_handoffs == 3

    def test_custom_max_handoffs(self):
        cfg = TaskAgentConfig(task_description="test", max_handoffs=5)
        assert cfg.max_handoffs == 5


class TestAgentResultHandoff:
    def test_default_no_handoff(self):
        result = AgentResult(agent_id="abc", success=True, summary="done")
        assert result.handoff is None

    def test_with_handoff(self):
        req = HandoffRequest(
            target_role="reviewer",
            task_description="Review",
            context="",
            source_messages=(),
            remaining_handoffs=2,
        )
        result = AgentResult(
            agent_id="abc", success=True, summary="handing off", handoff=req
        )
        assert result.handoff is req


class TestTaskAgentRunnerHandoff:
    @pytest.mark.asyncio
    async def test_on_handoff_sets_request(self):
        """Verify the on_handoff callback stores the HandoffRequest."""
        runner = TaskAgentRunner(
            agent_id="test-id",
            config=TaskAgentConfig(task_description="test task"),
            claude_client=MagicMock(),
            tool_registry=ToolRegistry(),
            tool_executor=MagicMock(),
            event_emitter=EventEmitter(),
        )
        req = HandoffRequest(
            target_role="reviewer",
            task_description="review",
            context="",
            source_messages=(),
            remaining_handoffs=2,
        )
        await runner.on_handoff(req)
        assert runner._handoff_request is not None
        assert runner._handoff_request.target_role == "reviewer"


class TestAgentHandoffTool:
    def test_definition(self):
        tool = AgentHandoff(on_handoff=self._noop_callback, max_handoffs=3)
        defn = tool.definition()
        assert defn.name == "agent_handoff"
        assert "target_role" in str(defn.input_schema)
        assert "task_description" in str(defn.input_schema)

    @staticmethod
    async def _noop_callback(req):
        pass

    @pytest.mark.asyncio
    async def test_execute_success(self):
        captured = []

        async def capture(req):
            captured.append(req)

        tool = AgentHandoff(on_handoff=capture, max_handoffs=3)
        result = await tool.execute(
            target_role="reviewer",
            task_description="Review code",
            context="Code is ready",
        )
        assert result.success
        assert len(captured) == 1
        assert captured[0].target_role == "reviewer"
        assert captured[0].task_description == "Review code"
        assert captured[0].remaining_handoffs == 2

    @pytest.mark.asyncio
    async def test_execute_empty_role_fails(self):
        tool = AgentHandoff(on_handoff=self._noop_callback, max_handoffs=3)
        result = await tool.execute(target_role="", task_description="Review code")
        assert not result.success

    @pytest.mark.asyncio
    async def test_execute_empty_description_fails(self):
        tool = AgentHandoff(on_handoff=self._noop_callback, max_handoffs=3)
        result = await tool.execute(target_role="reviewer", task_description="")
        assert not result.success

    @pytest.mark.asyncio
    async def test_execute_no_handoffs_remaining(self):
        tool = AgentHandoff(on_handoff=self._noop_callback, max_handoffs=0)
        result = await tool.execute(
            target_role="reviewer", task_description="Review code"
        )
        assert not result.success
        assert "task_complete" in result.error.lower()


class TestSubAgentManagerHandoff:
    """Integration tests: verify SubAgentManager handles handoff correctly."""

    def test_handoff_chain_config_propagation(self):
        """Verify config propagation through a handoff chain."""
        cfg = TaskAgentConfig(
            task_description="initial task",
            role="coder",
            max_handoffs=3,
        )
        handoff = HandoffRequest(
            target_role="reviewer",
            task_description="review code",
            context="done coding",
            source_messages=({"role": "user", "content": "build X"},),
            remaining_handoffs=2,
        )
        new_cfg = TaskAgentConfig(
            task_description=handoff.task_description,
            context=_format_handoff_context(
                handoff.source_messages, handoff.context, cfg.role
            ),
            sandbox_template=cfg.sandbox_template,
            role=handoff.target_role,
            max_handoffs=handoff.remaining_handoffs,
        )
        assert new_cfg.max_handoffs == 2
        assert new_cfg.role == "reviewer"
        assert "build X" in new_cfg.context
        assert "done coding" in new_cfg.context

    @pytest.mark.asyncio
    async def test_run_agent_handoff_loop(self):
        """Test that _run_agent loops on handoff and returns final result."""
        handoff_result = AgentResult(
            agent_id="test",
            success=True,
            summary="handing off",
            handoff=HandoffRequest(
                target_role="reviewer",
                task_description="review",
                context="ready",
                source_messages=({"role": "user", "content": "hi"},),
                remaining_handoffs=1,
            ),
        )
        final_result = AgentResult(
            agent_id="test",
            success=True,
            summary="review complete",
        )

        call_count = 0

        async def mock_execute(agent_id, config):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return handoff_result
            return final_result

        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )
        manager._execute_agent = mock_execute
        manager._configs["test-agent"] = TaskAgentConfig(
            task_description="code it", role="coder", max_handoffs=3
        )

        result = await manager._run_agent(
            "test-agent",
            TaskAgentConfig(task_description="code it", role="coder", max_handoffs=3),
        )
        assert result.success
        assert result.summary == "review complete"
        assert result.handoff is None
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_multi_step_handoff_chain(self):
        """Test a chain of 3 handoffs (coder → reviewer → deployer → done)."""
        call_count = 0

        async def mock_execute(agent_id, config):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return AgentResult(
                    agent_id=agent_id,
                    success=True,
                    summary="coded",
                    handoff=HandoffRequest(
                        target_role="reviewer",
                        task_description="review",
                        context="",
                        source_messages=(),
                        remaining_handoffs=2,
                    ),
                )
            if call_count == 2:
                return AgentResult(
                    agent_id=agent_id,
                    success=True,
                    summary="reviewed",
                    handoff=HandoffRequest(
                        target_role="deployer",
                        task_description="deploy",
                        context="",
                        source_messages=(),
                        remaining_handoffs=1,
                    ),
                )
            return AgentResult(agent_id=agent_id, success=True, summary="deployed")

        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )
        manager._execute_agent = mock_execute
        manager._configs["a"] = TaskAgentConfig(
            task_description="build", role="coder", max_handoffs=3
        )

        result = await manager._run_agent(
            "a",
            TaskAgentConfig(task_description="build", role="coder", max_handoffs=3),
        )
        assert call_count == 3
        assert result.summary == "deployed"


class TestFormatHandoffContext:
    def test_formats_messages_and_context(self):
        messages = (
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "I found a bug"},
        )
        result = _format_handoff_context(messages, "Needs security review", "coder")
        assert "coder" in result
        assert "hello" in result
        assert "I found a bug" in result
        assert "security review" in result

    def test_empty_messages(self):
        result = _format_handoff_context((), "", "coder")
        assert "coder" in result

    def test_no_handoff_context(self):
        messages = ({"role": "user", "content": "test"},)
        result = _format_handoff_context(messages, "", "coder")
        assert "test" in result


class TestSubAgentSpawnLimits:
    @pytest.mark.asyncio
    async def test_max_total_is_enforced_during_concurrent_spawn_attempts(self):
        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
            max_total=1,
        )

        async def mock_run_agent(agent_id, config):
            await asyncio.sleep(0)
            return AgentResult(agent_id=agent_id, success=True, summary="done")

        manager._run_agent = mock_run_agent

        results = await asyncio.gather(
            manager.spawn(TaskAgentConfig(task_description="first")),
            manager.spawn(TaskAgentConfig(task_description="second")),
            return_exceptions=True,
        )

        assert sum(isinstance(result, str) for result in results) == 1
        assert sum(isinstance(result, RuntimeError) for result in results) == 1

        await manager.cleanup()

    @pytest.mark.asyncio
    async def test_cleanup_resets_spawn_capacity_for_reuse(self):
        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
            max_total=1,
        )

        async def mock_run_agent(agent_id, config):
            await asyncio.sleep(0)
            return AgentResult(agent_id=agent_id, success=True, summary="done")

        manager._run_agent = mock_run_agent

        first_agent = await manager.spawn(TaskAgentConfig(task_description="first"))
        await manager.cleanup()

        assert first_agent
        assert manager.total_spawned == 0

        second_agent = await manager.spawn(TaskAgentConfig(task_description="second"))

        assert second_agent

        await manager.cleanup()
