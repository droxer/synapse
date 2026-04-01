"""EventEmitter subscriber that captures execution data during eval runs."""

from __future__ import annotations

import time
from typing import Any

from api.events import AgentEvent, EventType

from evals.models import (
    AgentHandoffRecord,
    AgentSpawnRecord,
    EvalMetrics,
    SkillActivationRecord,
    ToolCallRecord,
)


class EvalCollector:
    """Subscribes to an EventEmitter and accumulates execution metrics.

    Designed as a single-use collector per eval case run.
    Call ``to_metrics()`` after the run completes to freeze the data.
    """

    def __init__(self) -> None:
        self._max_iteration: int = 0
        self._input_tokens: int = 0
        self._output_tokens: int = 0
        self._errors: list[str] = []
        self._final_output: str = ""
        self._start_time: float = time.monotonic()

        # Pending tool calls keyed by tool_id
        self._pending_tools: dict[str, dict] = {}
        self._completed_tools: list[ToolCallRecord] = []

        # Skill, agent, and handoff tracking
        self._skill_activations: list[SkillActivationRecord] = []
        self._agent_spawns: list[AgentSpawnRecord] = []
        self._agent_handoffs: list[AgentHandoffRecord] = []

        # Context compaction and per-agent metrics
        self._context_compaction_count: int = 0
        self._per_agent_metrics: dict[str, dict[str, Any]] = {}

    async def on_event(self, event: AgentEvent) -> None:
        """Async event handler — pass to ``EventEmitter.subscribe()``."""
        match event.type:
            case EventType.ITERATION_START:
                iteration = event.data.get("iteration", 0)
                if iteration > self._max_iteration:
                    self._max_iteration = iteration

            case EventType.LLM_RESPONSE:
                usage = event.data.get("usage")
                if usage is not None:
                    self._input_tokens += getattr(usage, "input_tokens", 0)
                    self._output_tokens += getattr(usage, "output_tokens", 0)

            case EventType.TOOL_CALL:
                tool_id = event.data.get("tool_id", "")
                self._pending_tools[tool_id] = {
                    "name": event.data.get("tool_name", ""),
                    "input": event.data.get("tool_input", {}),
                    "iteration": event.iteration or 0,
                }

            case EventType.TOOL_RESULT:
                tool_id = event.data.get("tool_id", "")
                pending = self._pending_tools.pop(tool_id, None)
                if pending is not None:
                    self._completed_tools.append(
                        ToolCallRecord(
                            name=pending["name"],
                            input=pending["input"],
                            output=str(event.data.get("output", "")),
                            success=bool(event.data.get("success", False)),
                            iteration=pending["iteration"],
                        )
                    )

            case EventType.TASK_ERROR:
                error = event.data.get("error", "Unknown error")
                self._errors.append(str(error))

            case EventType.TURN_COMPLETE:
                self._final_output = str(event.data.get("result", ""))

            case EventType.SKILL_ACTIVATED:
                self._skill_activations.append(
                    SkillActivationRecord(
                        name=str(event.data.get("name", "")),
                        source=str(event.data.get("source", "auto")),
                    )
                )

            case EventType.AGENT_SPAWN:
                self._agent_spawns.append(
                    AgentSpawnRecord(
                        agent_id=str(event.data.get("agent_id", "")),
                        task=str(event.data.get("task", "")),
                    )
                )

            case EventType.AGENT_HANDOFF:
                self._agent_handoffs.append(
                    AgentHandoffRecord(
                        source_agent_id=str(event.data.get("source_agent_id", "")),
                        target_role=str(event.data.get("target_role", "")),
                        reason=str(event.data.get("reason", "")),
                        handoff_depth=int(event.data.get("handoff_depth", 0)),
                    )
                )

            case EventType.CONTEXT_COMPACTED:
                self._context_compaction_count += 1

            case EventType.AGENT_COMPLETE:
                agent_id = str(event.data.get("agent_id", ""))
                if agent_id:
                    self._per_agent_metrics[agent_id] = event.data.get("metrics") or {}

    def to_metrics(self) -> EvalMetrics:
        """Freeze collected data into an immutable EvalMetrics."""
        elapsed = time.monotonic() - self._start_time
        return EvalMetrics(
            total_iterations=self._max_iteration,
            total_input_tokens=self._input_tokens,
            total_output_tokens=self._output_tokens,
            tool_calls=tuple(self._completed_tools),
            errors=tuple(self._errors),
            latency_seconds=round(elapsed, 2),
            final_output=self._final_output,
            skill_activations=tuple(self._skill_activations),
            agent_spawns=tuple(self._agent_spawns),
            agent_handoffs=tuple(self._agent_handoffs),
            context_compaction_count=self._context_compaction_count,
            per_agent_metrics=dict(self._per_agent_metrics),
        )
