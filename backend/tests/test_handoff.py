"""Tests for agent handoff functionality."""

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agent.runtime.sub_agent_manager import SubAgentManager, _format_handoff_context
from agent.runtime.planner import PLANNER_SYSTEM_PROMPT
from agent.runtime.task_runner import (
    AgentResult,
    AgentRunMetrics,
    HandoffRequest,
    TaskAgentConfig,
    TaskAgentRunner,
)
from agent.tools.meta.handoff import AgentHandoff
from agent.tools.registry import ToolRegistry
from api.builders import _build_planner_orchestrator
from api.events import EventEmitter
from config.settings import Settings


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
    async def test_on_handoff_sets_request(self, monkeypatch):
        """Verify the on_handoff callback stores the HandoffRequest."""
        monkeypatch.setattr(
            "agent.runtime.task_runner.get_settings",
            lambda: SimpleNamespace(
                COMPACT_FULL_INTERACTIONS=5,
                COMPACT_FULL_DIALOGUE_TURNS=5,
                COMPACT_TOKEN_BUDGET=150_000,
                COMPACT_SUMMARY_MODEL="",
                LITE_MODEL="claude-lite-test",
            ),
        )

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
        assert "task_complete" in (result.error or "").lower()


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
                handoff.source_messages,
                handoff.context,
                cfg.role,
                max_message_chars=2000,
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
    async def test_handoff_preserves_timeout_seconds(self):
        """Handoff should preserve timeout_seconds in new config."""
        call_count = 0
        captured_configs: list[TaskAgentConfig] = []

        async def mock_execute(agent_id, config):
            nonlocal call_count
            call_count += 1
            captured_configs.append(config)
            if call_count == 1:
                return AgentResult(
                    agent_id=agent_id,
                    success=True,
                    summary="handing off",
                    handoff=HandoffRequest(
                        target_role="reviewer",
                        task_description="review",
                        context="ready",
                        source_messages=(),
                        remaining_handoffs=1,
                    ),
                )
            return AgentResult(agent_id=agent_id, success=True, summary="done")

        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )
        manager._execute_agent = mock_execute

        await manager._run_agent(
            "test-agent",
            TaskAgentConfig(
                task_description="code it",
                role="coder",
                max_handoffs=2,
                timeout_seconds=42.0,
            ),
        )

        assert call_count == 2
        assert captured_configs[0].timeout_seconds == 42.0
        assert captured_configs[1].timeout_seconds == 42.0

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
        result = _format_handoff_context(
            messages,
            "Needs security review",
            "coder",
            max_message_chars=2000,
        )
        assert "coder" in result
        assert "hello" in result
        assert "I found a bug" in result
        assert "security review" in result

    def test_empty_messages(self):
        result = _format_handoff_context((), "", "coder", max_message_chars=2000)
        assert "coder" in result

    def test_no_handoff_context(self):
        messages = ({"role": "user", "content": "test"},)
        result = _format_handoff_context(messages, "", "coder", max_message_chars=2000)
        assert "test" in result


class TestSubAgentSpawnLimits:
    def test_settings_expose_task_agent_runtime_limits(self) -> None:
        settings = Settings(
            ANTHROPIC_API_KEY="key",
            TAVILY_API_KEY="key",
            MAX_CONCURRENT_AGENTS=7,
            MAX_TOTAL_AGENTS=30,
            MAX_AGENT_ITERATIONS=60,
            AGENT_TIMEOUT_SECONDS=120,
            COMPACT_TOKEN_COUNTER="weighted",
            COMPACT_FALLBACK_PREVIEW_CHARS=600,
            COMPACT_FALLBACK_RESULT_CHARS=1200,
            SKILL_SELECTOR_MODEL="claude-haiku-test",
        )

        assert settings.MAX_CONCURRENT_AGENTS == 7
        assert settings.MAX_TOTAL_AGENTS == 30
        assert settings.MAX_AGENT_ITERATIONS == 60
        assert settings.AGENT_TIMEOUT_SECONDS == 120
        assert settings.COMPACT_TOKEN_COUNTER == "weighted"
        assert settings.COMPACT_FALLBACK_PREVIEW_CHARS == 600
        assert settings.COMPACT_FALLBACK_RESULT_CHARS == 1200
        assert settings.SKILL_SELECTOR_MODEL == "claude-haiku-test"

    def test_planner_builder_uses_runtime_limits_from_settings(
        self, monkeypatch
    ) -> None:
        captured_manager_kwargs: dict[str, object] = {}

        monkeypatch.setattr(
            "api.builders.get_settings",
            lambda: SimpleNamespace(
                MAX_CONCURRENT_AGENTS=7,
                MAX_TOTAL_AGENTS=30,
                MAX_AGENT_ITERATIONS=60,
                MAX_ITERATIONS=50,
                SKILLS_ENABLED=True,
            ),
        )
        monkeypatch.setattr(
            "api.builders._build_sub_agent_registry_factory",
            lambda *args: "registry-factory",
        )
        monkeypatch.setattr(
            "api.builders._build_base_registry",
            lambda *args, **kwargs: ToolRegistry(),
        )
        monkeypatch.setattr(
            "api.builders.ArtifactManager",
            lambda storage_backend=None: MagicMock(),
        )

        class FakeSubAgentManager:
            def __init__(self, **kwargs):
                captured_manager_kwargs.update(kwargs)

        class FakePlannerOrchestrator:
            def __init__(self, **kwargs):
                self.on_task_complete = lambda summary: None
                self._executor = kwargs["tool_executor"]

        monkeypatch.setattr("api.builders.SubAgentManager", FakeSubAgentManager)
        monkeypatch.setattr("api.builders.PlannerOrchestrator", FakePlannerOrchestrator)

        _build_planner_orchestrator(
            claude_client=MagicMock(),
            event_emitter=EventEmitter(),
            sandbox_provider=MagicMock(),
        )

        assert captured_manager_kwargs.get("max_concurrent") == 7
        assert captured_manager_kwargs.get("max_total") == 30
        assert captured_manager_kwargs.get("max_iterations") == 60

    def test_planner_builder_preserves_base_prompt_when_memory_present(
        self, monkeypatch
    ) -> None:
        captured_planner_kwargs: dict[str, object] = {}

        monkeypatch.setattr(
            "api.builders.get_settings",
            lambda: SimpleNamespace(
                MAX_CONCURRENT_AGENTS=7,
                MAX_TOTAL_AGENTS=30,
                MAX_AGENT_ITERATIONS=60,
                MAX_ITERATIONS=50,
                SKILLS_ENABLED=False,
            ),
        )
        monkeypatch.setattr(
            "api.builders._build_sub_agent_registry_factory",
            lambda *args: "registry-factory",
        )
        monkeypatch.setattr(
            "api.builders._build_base_registry",
            lambda *args, **kwargs: ToolRegistry(),
        )
        monkeypatch.setattr(
            "api.builders.ArtifactManager",
            lambda storage_backend=None: MagicMock(),
        )

        class FakeSubAgentManager:
            def __init__(self, **kwargs):
                pass

        class FakePlannerOrchestrator:
            def __init__(self, **kwargs):
                captured_planner_kwargs.update(kwargs)
                self.on_task_complete = lambda summary: None
                self._executor = kwargs["tool_executor"]

        monkeypatch.setattr("api.builders.SubAgentManager", FakeSubAgentManager)
        monkeypatch.setattr("api.builders.PlannerOrchestrator", FakePlannerOrchestrator)

        _build_planner_orchestrator(
            claude_client=MagicMock(),
            event_emitter=EventEmitter(),
            sandbox_provider=MagicMock(),
            memory_entries=[{"key": "timezone", "value": "UTC"}],
        )

        system_prompt = str(captured_planner_kwargs["system_prompt"])
        assert PLANNER_SYSTEM_PROMPT in system_prompt
        assert "timezone: UTC" in system_prompt

    @pytest.mark.asyncio
    async def test_manager_passes_max_iterations_to_task_runner(
        self, monkeypatch
    ) -> None:
        captured_runner_kwargs: dict[str, object] = {}

        class FakeTaskAgentRunner:
            def __init__(self, **kwargs):
                captured_runner_kwargs.update(kwargs)

            async def run(self) -> AgentResult:
                return AgentResult(agent_id="agent-1", success=True, summary="done")

            async def on_task_complete(self, summary: str) -> None:
                return None

            async def on_handoff(self, request: HandoffRequest) -> None:
                return None

        monkeypatch.setattr(
            "agent.runtime.sub_agent_manager.TaskAgentRunner",
            FakeTaskAgentRunner,
        )

        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
            max_iterations=17,
        )

        result = await manager._execute_agent(
            "agent-1", TaskAgentConfig(task_description="build")
        )

        assert result.summary == "done"
        assert captured_runner_kwargs["max_iterations"] == 17

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


class TestDependencyFailurePolicy:
    """Tests for dependency_failure_mode handling in SubAgentManager."""

    @pytest.mark.asyncio
    async def test_cancel_downstream_skips_child_on_dep_failure(self):
        """When dep fails with cancel_downstream, child should be skipped."""
        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )

        call_count = 0

        async def mock_execute(agent_id, config):
            nonlocal call_count
            call_count += 1
            if agent_id == dep_id:
                return AgentResult(
                    agent_id=dep_id,
                    success=False,
                    summary="",
                    error="dep failed",
                    failure_mode="cancel_downstream",
                )
            # Should never be reached for the child
            return AgentResult(agent_id=agent_id, success=True, summary="done")

        manager._execute_agent = mock_execute

        dep_id = await manager.spawn(TaskAgentConfig(task_description="dep task"))
        child_id = await manager.spawn(
            TaskAgentConfig(
                task_description="child task",
                depends_on=(dep_id,),
                dependency_failure_mode="cancel_downstream",
            )
        )

        results = await manager.wait()

        # The child should have been skipped (not executed)
        assert results[child_id].success is False
        assert results[child_id].skip_execution is True
        assert results[child_id].failure_mode == "cancel_downstream"
        assert "skipped" in (results[child_id].error or "").lower()

        await manager.cleanup()

    @pytest.mark.asyncio
    async def test_degrade_continues_with_failure_context(self):
        """When dep fails with degrade mode, child runs with failure note in context."""
        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )

        captured_configs: dict[str, TaskAgentConfig] = {}

        async def mock_execute(agent_id, config):
            captured_configs[agent_id] = config
            if agent_id == dep_id:
                return AgentResult(
                    agent_id=dep_id,
                    success=False,
                    summary="",
                    error="dep had an issue",
                    failure_mode="degrade",
                )
            return AgentResult(agent_id=agent_id, success=True, summary="done anyway")

        manager._execute_agent = mock_execute

        dep_id = await manager.spawn(TaskAgentConfig(task_description="dep task"))
        child_id = await manager.spawn(
            TaskAgentConfig(
                task_description="child task",
                depends_on=(dep_id,),
                dependency_failure_mode="degrade",
            )
        )

        results = await manager.wait()

        # The child should have been executed with failure note in context
        assert results[child_id].success is True
        assert child_id in captured_configs
        assert "dep had an issue" in captured_configs[child_id].context
        assert "degraded" in captured_configs[child_id].context.lower()

        await manager.cleanup()

    @pytest.mark.asyncio
    async def test_dependency_context_merge_preserves_timeout_seconds(self):
        """Dependency context merge should keep timeout_seconds on child config."""
        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )

        captured_configs: dict[str, TaskAgentConfig] = {}

        async def mock_execute(agent_id, config):
            captured_configs[agent_id] = config
            if agent_id == dep_id:
                return AgentResult(
                    agent_id=dep_id, success=True, summary="dep finished"
                )
            return AgentResult(agent_id=agent_id, success=True, summary="done")

        manager._execute_agent = mock_execute

        dep_id = await manager.spawn(TaskAgentConfig(task_description="dep task"))
        child_id = await manager.spawn(
            TaskAgentConfig(
                task_description="child task",
                depends_on=(dep_id,),
                timeout_seconds=21.0,
            )
        )

        results = await manager.wait()

        assert results[child_id].success is True
        assert child_id in captured_configs
        assert "dep finished" in captured_configs[child_id].context
        assert captured_configs[child_id].timeout_seconds == 21.0

        await manager.cleanup()

    @pytest.mark.asyncio
    async def test_replan_marks_replan_required(self):
        """When dep fails with replan mode, child is marked replan_required."""
        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )

        async def mock_execute(agent_id, config):
            if agent_id == dep_id:
                return AgentResult(
                    agent_id=dep_id,
                    success=False,
                    summary="",
                    error="need to rethink",
                    failure_mode="replan",
                )
            return AgentResult(agent_id=agent_id, success=True, summary="done")

        manager._execute_agent = mock_execute

        dep_id = await manager.spawn(TaskAgentConfig(task_description="dep task"))
        child_id = await manager.spawn(
            TaskAgentConfig(
                task_description="child task",
                depends_on=(dep_id,),
                dependency_failure_mode="replan",
            )
        )

        results = await manager.wait()

        # The child should be marked as needing replan, not executed
        assert results[child_id].success is False
        assert results[child_id].replan_required is True
        assert results[child_id].failure_mode == "replan"
        assert "replan" in (results[child_id].error or "").lower()

        await manager.cleanup()

    @pytest.mark.asyncio
    async def test_default_mode_inherits_dependency_failure_mode(self):
        """Default child mode should inherit failed dependency failure_mode."""
        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )

        async def mock_execute(agent_id, config):
            if agent_id == dep_id:
                return AgentResult(
                    agent_id=dep_id,
                    success=False,
                    summary="",
                    error="upstream requested replan",
                    failure_mode="replan",
                )
            return AgentResult(agent_id=agent_id, success=True, summary="done")

        manager._execute_agent = mock_execute

        dep_id = await manager.spawn(TaskAgentConfig(task_description="dep task"))
        child_id = await manager.spawn(
            TaskAgentConfig(
                task_description="child task",
                depends_on=(dep_id,),
            )
        )

        results = await manager.wait()

        assert results[child_id].success is False
        assert results[child_id].replan_required is True
        assert results[child_id].failure_mode == "replan"

        await manager.cleanup()

    @pytest.mark.asyncio
    async def test_default_mode_uses_highest_priority_failed_dependency_mode(self):
        """With default child mode, failure mode priority picks replan."""
        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )

        async def mock_execute(agent_id, config):
            if agent_id == dep_degrade_id:
                return AgentResult(
                    agent_id=dep_degrade_id,
                    success=False,
                    summary="",
                    error="degraded upstream",
                    failure_mode="degrade",
                )
            if agent_id == dep_replan_id:
                return AgentResult(
                    agent_id=dep_replan_id,
                    success=False,
                    summary="",
                    error="replan upstream",
                    failure_mode="replan",
                )
            return AgentResult(agent_id=agent_id, success=True, summary="done")

        manager._execute_agent = mock_execute

        dep_degrade_id = await manager.spawn(TaskAgentConfig(task_description="dep 1"))
        dep_replan_id = await manager.spawn(TaskAgentConfig(task_description="dep 2"))
        child_id = await manager.spawn(
            TaskAgentConfig(
                task_description="child task",
                depends_on=(dep_degrade_id, dep_replan_id),
            )
        )

        results = await manager.wait()

        assert results[child_id].success is False
        assert results[child_id].replan_required is True
        assert results[child_id].failure_mode == "replan"

        await manager.cleanup()

    @pytest.mark.asyncio
    async def test_child_override_uses_explicit_mode_over_inherited_failure_mode(self):
        """Explicit child mode should override inherited failed dependency mode."""
        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )

        captured_configs: dict[str, TaskAgentConfig] = {}

        async def mock_execute(agent_id, config):
            captured_configs[agent_id] = config
            if agent_id == dep_id:
                return AgentResult(
                    agent_id=dep_id,
                    success=False,
                    summary="",
                    error="upstream requested replan",
                    failure_mode="replan",
                )
            return AgentResult(agent_id=agent_id, success=True, summary="done anyway")

        manager._execute_agent = mock_execute

        dep_id = await manager.spawn(TaskAgentConfig(task_description="dep task"))
        child_id = await manager.spawn(
            TaskAgentConfig(
                task_description="child task",
                depends_on=(dep_id,),
                dependency_failure_mode="degrade",
            )
        )

        results = await manager.wait()

        assert results[child_id].success is True
        assert results[child_id].replan_required is False
        assert child_id in captured_configs
        assert "upstream requested replan" in captured_configs[child_id].context
        assert "degraded" in captured_configs[child_id].context.lower()

        await manager.cleanup()

    @pytest.mark.asyncio
    async def test_explicit_cancel_downstream_overrides_inherited_replan(self):
        """Explicit cancel_downstream should skip child despite inherited replan."""
        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )

        call_count = 0

        async def mock_execute(agent_id, config):
            nonlocal call_count
            call_count += 1
            if agent_id == dep_id:
                return AgentResult(
                    agent_id=dep_id,
                    success=False,
                    summary="",
                    error="upstream requested replan",
                    failure_mode="replan",
                )
            return AgentResult(agent_id=agent_id, success=True, summary="done")

        manager._execute_agent = mock_execute

        dep_id = await manager.spawn(TaskAgentConfig(task_description="dep task"))
        child_id = await manager.spawn(
            TaskAgentConfig(
                task_description="child task",
                depends_on=(dep_id,),
                dependency_failure_mode="cancel_downstream",
            )
        )

        results = await manager.wait()

        assert call_count == 1
        assert results[child_id].success is False
        assert results[child_id].skip_execution is True
        assert results[child_id].replan_required is False
        assert results[child_id].failure_mode == "cancel_downstream"

        await manager.cleanup()

    @pytest.mark.asyncio
    async def test_default_mode_prioritizes_cancel_downstream_over_degrade(self):
        """With default child mode, priority picks cancel_downstream over degrade."""
        manager = SubAgentManager(
            claude_client=MagicMock(),
            tool_registry_factory=lambda: ToolRegistry(),
            tool_executor_factory=lambda reg: MagicMock(),
            event_emitter=EventEmitter(),
        )

        async def mock_execute(agent_id, config):
            if agent_id == dep_degrade_id:
                return AgentResult(
                    agent_id=dep_degrade_id,
                    success=False,
                    summary="",
                    error="degraded upstream",
                    failure_mode="degrade",
                )
            if agent_id == dep_cancel_id:
                return AgentResult(
                    agent_id=dep_cancel_id,
                    success=False,
                    summary="",
                    error="cancel downstream upstream",
                    failure_mode="cancel_downstream",
                )
            return AgentResult(agent_id=agent_id, success=True, summary="done")

        manager._execute_agent = mock_execute

        dep_degrade_id = await manager.spawn(TaskAgentConfig(task_description="dep 1"))
        dep_cancel_id = await manager.spawn(TaskAgentConfig(task_description="dep 2"))
        child_id = await manager.spawn(
            TaskAgentConfig(
                task_description="child task",
                depends_on=(dep_degrade_id, dep_cancel_id),
            )
        )

        results = await manager.wait()

        assert results[child_id].success is False
        assert results[child_id].skip_execution is True
        assert results[child_id].failure_mode == "cancel_downstream"

        await manager.cleanup()

    def test_task_agent_config_has_dependency_failure_mode(self):
        """TaskAgentConfig should accept dependency_failure_mode field."""
        cfg = TaskAgentConfig(
            task_description="test",
            dependency_failure_mode="degrade",
        )
        assert cfg.dependency_failure_mode == "degrade"

    def test_task_agent_config_dependency_failure_mode_default(self):
        """TaskAgentConfig default dependency_failure_mode is inherit."""
        cfg = TaskAgentConfig(task_description="test")
        assert cfg.dependency_failure_mode == "inherit"

    def test_agent_result_skip_execution_field(self):
        """AgentResult should have skip_execution field defaulting to False."""
        result = AgentResult(agent_id="x", success=True, summary="ok")
        assert result.skip_execution is False

    def test_agent_result_replan_required_field(self):
        """AgentResult should have replan_required field defaulting to False."""
        result = AgentResult(agent_id="x", success=True, summary="ok")
        assert result.replan_required is False


@pytest.mark.asyncio
async def test_dependency_without_result_is_synthesized_as_failure():
    """A completed dependency without stored result is treated as failure."""
    manager = SubAgentManager(
        claude_client=MagicMock(),
        tool_registry_factory=lambda: ToolRegistry(),
        tool_executor_factory=lambda reg: MagicMock(),
        event_emitter=EventEmitter(),
    )

    async def _finished_without_storage() -> AgentResult:
        return AgentResult(
            agent_id="dep-missing-result",
            success=True,
            summary="done",
        )

    dep_id = "dep-missing-result"
    dep_task = asyncio.create_task(
        _finished_without_storage(),
        name="dep-missing-result",
    )
    await dep_task
    manager._agents[dep_id] = dep_task

    outcome = await manager._wait_for_dependencies(
        "child",
        TaskAgentConfig(task_description="child", depends_on=(dep_id,)),
    )

    assert isinstance(outcome, AgentResult)
    assert outcome.success is False
    assert outcome.skip_execution is True
    assert outcome.failure_mode == "cancel_downstream"
    assert "dependency terminated unexpectedly" in (outcome.error or "")

    synthesized_dep_result = manager._results[dep_id]
    assert synthesized_dep_result.success is False
    assert synthesized_dep_result.error == "dependency terminated unexpectedly"
    assert synthesized_dep_result.failure_mode == "cancel_downstream"


class TestSpawnTaskAgentDependencyFailureMode:
    """Tests for dependency_failure_mode parameter in SpawnTaskAgent."""

    @pytest.mark.asyncio
    async def test_spawn_forwards_dependency_failure_mode(self):
        """SpawnTaskAgent should forward dependency_failure_mode to config."""
        captured_configs: list[TaskAgentConfig] = []

        class FakeManager:
            async def spawn(self, config):
                captured_configs.append(config)
                return "fake-agent-id"

        from agent.tools.meta.spawn_task_agent import SpawnTaskAgent

        tool = SpawnTaskAgent(sub_agent_manager=FakeManager())
        result = await tool.execute(
            task_description="my task",
            name="test task",
            dependency_failure_mode="degrade",
        )
        assert result.success
        assert len(captured_configs) == 1
        assert captured_configs[0].dependency_failure_mode == "degrade"

    @pytest.mark.asyncio
    async def test_spawn_default_dependency_failure_mode(self):
        """SpawnTaskAgent should default dependency_failure_mode to inherit."""
        captured_configs: list[TaskAgentConfig] = []

        class FakeManager:
            async def spawn(self, config):
                captured_configs.append(config)
                return "fake-agent-id"

        from agent.tools.meta.spawn_task_agent import SpawnTaskAgent

        tool = SpawnTaskAgent(sub_agent_manager=FakeManager())
        result = await tool.execute(
            task_description="my task",
            name="test task",
        )
        assert result.success
        assert len(captured_configs) == 1
        assert captured_configs[0].dependency_failure_mode == "inherit"

    @pytest.mark.asyncio
    async def test_spawn_forwards_timeout_seconds(self):
        """SpawnTaskAgent should forward timeout_seconds to config."""
        captured_configs: list[TaskAgentConfig] = []

        class FakeManager:
            async def spawn(self, config):
                captured_configs.append(config)
                return "fake-agent-id"

        from agent.tools.meta.spawn_task_agent import SpawnTaskAgent

        tool = SpawnTaskAgent(sub_agent_manager=FakeManager())
        result = await tool.execute(
            task_description="my task",
            name="test task",
            timeout_seconds=12.5,
        )
        assert result.success
        assert len(captured_configs) == 1
        assert captured_configs[0].timeout_seconds == 12.5


class TestWaitForAgentsOutputEnhanced:
    """Tests for enhanced output in WaitForAgents (failure_mode, metrics)."""

    @pytest.mark.asyncio
    async def test_wait_output_includes_failure_mode(self):
        """WaitForAgents output should include failure_mode per agent."""
        from agent.tools.meta.wait_for_agents import WaitForAgents

        class FakeManager:
            async def wait(self, agent_ids=None):
                return {
                    "agent-1": AgentResult(
                        agent_id="agent-1",
                        success=False,
                        summary="",
                        error="failed",
                        failure_mode="degrade",
                    ),
                }

        tool = WaitForAgents(sub_agent_manager=FakeManager())
        result = await tool.execute(agent_ids=["agent-1"])
        assert result.success

        import json

        data = json.loads(result.output)
        assert data["agent-1"]["failure_mode"] == "degrade"

    @pytest.mark.asyncio
    async def test_wait_output_includes_metrics(self):
        """WaitForAgents output should include metrics when available."""
        from agent.tools.meta.wait_for_agents import WaitForAgents

        class FakeManager:
            async def wait(self, agent_ids=None):
                return {
                    "agent-1": AgentResult(
                        agent_id="agent-1",
                        success=True,
                        summary="done",
                        metrics=AgentRunMetrics(
                            duration_seconds=1.5,
                            iterations=3,
                            tool_call_count=5,
                            context_compaction_count=0,
                            input_tokens=100,
                            output_tokens=50,
                        ),
                    ),
                }

        tool = WaitForAgents(sub_agent_manager=FakeManager())
        result = await tool.execute(agent_ids=["agent-1"])
        assert result.success

        import json

        data = json.loads(result.output)
        assert data["agent-1"]["metrics"]["duration_seconds"] == 1.5
        assert data["agent-1"]["metrics"]["iterations"] == 3
        assert data["agent-1"]["metrics"]["tool_call_count"] == 5

    @pytest.mark.asyncio
    async def test_wait_output_metrics_none(self):
        """WaitForAgents output should handle None metrics gracefully."""
        from agent.tools.meta.wait_for_agents import WaitForAgents

        class FakeManager:
            async def wait(self, agent_ids=None):
                return {
                    "agent-1": AgentResult(
                        agent_id="agent-1",
                        success=True,
                        summary="done",
                    ),
                }

        tool = WaitForAgents(sub_agent_manager=FakeManager())
        result = await tool.execute(agent_ids=["agent-1"])

        import json

        data = json.loads(result.output)
        assert data["agent-1"]["metrics"] is None

    @pytest.mark.asyncio
    async def test_wait_output_includes_skip_execution_and_replan_required(self):
        """WaitForAgents output should include execution-state flags."""
        from agent.tools.meta.wait_for_agents import WaitForAgents

        class FakeManager:
            async def wait(self, agent_ids=None):
                return {
                    "agent-1": AgentResult(
                        agent_id="agent-1",
                        success=False,
                        summary="",
                        error="dependency failed",
                        failure_mode="replan",
                        skip_execution=True,
                        replan_required=True,
                    ),
                }

        tool = WaitForAgents(sub_agent_manager=FakeManager())
        result = await tool.execute(agent_ids=["agent-1"])
        assert result.success

        import json

        data = json.loads(result.output)
        assert data["agent-1"]["skip_execution"] is True
        assert data["agent-1"]["replan_required"] is True
