"""Tests for eval event collector."""

from __future__ import annotations

import pytest

from agent.llm.client import TokenUsage
from api.events import AgentEvent, EventType

from evals.collector import EvalCollector


def _event(
    event_type: EventType,
    data: dict,
    iteration: int | None = None,
) -> AgentEvent:
    return AgentEvent(type=event_type, data=data, iteration=iteration)


class TestEvalCollector:
    @pytest.fixture()
    def collector(self) -> EvalCollector:
        return EvalCollector()

    async def test_tracks_iterations(self, collector: EvalCollector) -> None:
        await collector.on_event(_event(EventType.ITERATION_START, {"iteration": 1}))
        await collector.on_event(_event(EventType.ITERATION_START, {"iteration": 2}))
        await collector.on_event(_event(EventType.ITERATION_START, {"iteration": 3}))
        metrics = collector.to_metrics()
        assert metrics.total_iterations == 3

    async def test_tracks_tokens(self, collector: EvalCollector) -> None:
        usage = TokenUsage(input_tokens=100, output_tokens=50)
        await collector.on_event(_event(EventType.LLM_RESPONSE, {"usage": usage}))
        await collector.on_event(_event(EventType.LLM_RESPONSE, {"usage": usage}))
        metrics = collector.to_metrics()
        assert metrics.total_input_tokens == 200
        assert metrics.total_output_tokens == 100

    async def test_tracks_execution_shape(self, collector: EvalCollector) -> None:
        await collector.on_event(
            _event(
                EventType.TURN_START,
                {
                    "orchestrator_mode": "planner",
                    "execution_shape": "parallel",
                    "execution_rationale": "independent tasks",
                },
            )
        )
        metrics = collector.to_metrics()
        assert metrics.orchestrator_mode == "planner"
        assert metrics.execution_shape == "parallel"
        assert metrics.execution_rationale == "independent tasks"

    async def test_tracks_planner_only_events(self, collector: EvalCollector) -> None:
        await collector.on_event(_event(EventType.PLAN_CREATED, {"steps": []}))
        await collector.on_event(_event(EventType.LOOP_GUARD_NUDGE, {"iteration": 1}))
        await collector.on_event(_event(EventType.LOOP_GUARD_NUDGE, {"iteration": 2}))
        await collector.on_event(_event(EventType.PLANNER_AUTO_SELECTED, {}))

        metrics = collector.to_metrics()

        assert metrics.plan_created_count == 1
        assert metrics.loop_guard_nudge_count == 2
        assert metrics.planner_auto_selected_count == 1

    async def test_tracks_tool_calls(self, collector: EvalCollector) -> None:
        await collector.on_event(
            _event(
                EventType.TOOL_CALL,
                {
                    "tool_id": "t1",
                    "tool_name": "web_search",
                    "tool_input": {"q": "test"},
                },
                iteration=1,
            )
        )
        await collector.on_event(
            _event(
                EventType.TOOL_RESULT,
                {"tool_id": "t1", "success": True, "output": "found it"},
            )
        )
        metrics = collector.to_metrics()
        assert len(metrics.tool_calls) == 1
        assert metrics.tool_calls[0].name == "web_search"
        assert metrics.tool_calls[0].success is True
        assert metrics.tool_calls[0].output == "found it"

    async def test_tracks_errors(self, collector: EvalCollector) -> None:
        await collector.on_event(
            _event(EventType.TASK_ERROR, {"error": "something broke"})
        )
        metrics = collector.to_metrics()
        assert metrics.errors == ("something broke",)

    async def test_tracks_final_output(self, collector: EvalCollector) -> None:
        await collector.on_event(
            _event(EventType.TURN_COMPLETE, {"result": "Final answer here"})
        )
        metrics = collector.to_metrics()
        assert metrics.final_output == "Final answer here"

    async def test_unmatched_tool_result_ignored(
        self, collector: EvalCollector
    ) -> None:
        await collector.on_event(
            _event(
                EventType.TOOL_RESULT,
                {"tool_id": "orphan", "success": True, "output": "stale"},
            )
        )
        metrics = collector.to_metrics()
        assert len(metrics.tool_calls) == 0

    async def test_latency_is_positive(self, collector: EvalCollector) -> None:
        metrics = collector.to_metrics()
        assert metrics.latency_seconds >= 0.0

    async def test_tracks_skill_activations(self, collector: EvalCollector) -> None:
        await collector.on_event(
            _event(
                EventType.SKILL_ACTIVATED,
                {"name": "data_science", "source": "explicit"},
            )
        )
        await collector.on_event(
            _event(
                EventType.SKILL_ACTIVATED,
                {"name": "web_dev", "source": "auto"},
            )
        )
        metrics = collector.to_metrics()
        assert len(metrics.skill_activations) == 2
        assert metrics.skill_activations[0].name == "data_science"
        assert metrics.skill_activations[0].source == "explicit"
        assert metrics.skill_activations[1].name == "web_dev"
        assert metrics.skill_activations[1].source == "auto"

    async def test_tracks_agent_spawns(self, collector: EvalCollector) -> None:
        await collector.on_event(
            _event(
                EventType.AGENT_SPAWN,
                {"agent_id": "abc-123", "task": "Research AI trends"},
            )
        )
        metrics = collector.to_metrics()
        assert len(metrics.agent_spawns) == 1
        assert metrics.agent_spawns[0].agent_id == "abc-123"
        assert metrics.agent_spawns[0].task == "Research AI trends"

    async def test_tracks_agent_handoffs(self, collector: EvalCollector) -> None:
        await collector.on_event(
            _event(
                EventType.AGENT_HANDOFF,
                {
                    "source_agent_id": "a1",
                    "target_role": "reviewer",
                    "reason": "needs security review",
                    "handoff_depth": 1,
                },
            )
        )
        metrics = collector.to_metrics()
        assert len(metrics.agent_handoffs) == 1
        assert metrics.agent_handoffs[0].source_agent_id == "a1"
        assert metrics.agent_handoffs[0].target_role == "reviewer"
        assert metrics.agent_handoffs[0].reason == "needs security review"
        assert metrics.agent_handoffs[0].handoff_depth == 1

    async def test_empty_skill_agent_handoff_defaults(
        self, collector: EvalCollector
    ) -> None:
        metrics = collector.to_metrics()
        assert metrics.skill_activations == ()
        assert metrics.agent_spawns == ()
        assert metrics.agent_handoffs == ()

    async def test_tracks_context_compaction(self, collector: EvalCollector) -> None:
        await collector.on_event(
            _event(
                EventType.CONTEXT_COMPACTED,
                {"original_messages": 20, "compacted_messages": 8},
                iteration=3,
            )
        )
        await collector.on_event(
            _event(
                EventType.CONTEXT_COMPACTED,
                {"original_messages": 15, "compacted_messages": 6},
                iteration=6,
            )
        )
        metrics = collector.to_metrics()
        assert metrics.context_compaction_count == 2

    async def test_tracks_per_agent_metrics(self, collector: EvalCollector) -> None:
        await collector.on_event(
            _event(
                EventType.AGENT_COMPLETE,
                {
                    "agent_id": "task-agent-1",
                    "metrics": {"iterations": 4, "tokens": 1200},
                },
            )
        )
        await collector.on_event(
            _event(
                EventType.AGENT_COMPLETE,
                {
                    "agent_id": "task-agent-2",
                    "metrics": {"iterations": 7},
                },
            )
        )
        metrics = collector.to_metrics()
        assert "task-agent-1" in metrics.per_agent_metrics
        assert metrics.per_agent_metrics["task-agent-1"] == {
            "iterations": 4,
            "tokens": 1200,
        }
        assert "task-agent-2" in metrics.per_agent_metrics
        assert metrics.per_agent_metrics["task-agent-2"] == {"iterations": 7}

    async def test_agent_complete_without_metrics(
        self, collector: EvalCollector
    ) -> None:
        await collector.on_event(
            _event(
                EventType.AGENT_COMPLETE,
                {"agent_id": "agent-x"},
            )
        )
        metrics = collector.to_metrics()
        assert "agent-x" in metrics.per_agent_metrics
        assert metrics.per_agent_metrics["agent-x"] == {}

    async def test_agent_complete_without_id_ignored(
        self, collector: EvalCollector
    ) -> None:
        await collector.on_event(
            _event(
                EventType.AGENT_COMPLETE,
                {"metrics": {"iterations": 1}},
            )
        )
        metrics = collector.to_metrics()
        assert metrics.per_agent_metrics == {}

    async def test_empty_compaction_and_agent_defaults(
        self, collector: EvalCollector
    ) -> None:
        metrics = collector.to_metrics()
        assert metrics.context_compaction_count == 0
        assert metrics.per_agent_metrics == {}
