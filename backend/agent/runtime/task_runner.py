"""Task agent runner for executing focused sub-tasks."""

from __future__ import annotations

import asyncio
import time
from dataclasses import asdict, dataclass, replace
from typing import Any, Literal

from agent.llm.client import AnthropicClient
from agent.runtime.helpers import (
    apply_response_to_state,
    extract_final_text,
    process_tool_calls,
)
from agent.runtime.observer import Observer
from agent.runtime.orchestrator import AgentState
from agent.tools.executor import ToolExecutor
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType
from config.settings import Settings, get_settings
from loguru import logger


FailureMode = Literal["cancel_downstream", "degrade", "replan"]
DependencyFailureMode = Literal["inherit", "cancel_downstream", "degrade", "replan"]


@dataclass(frozen=True)
class TaskAgentConfig:
    """Immutable configuration for a task agent."""

    task_description: str
    name: str = ""
    context: str = ""
    sandbox_template: str = "default"
    priority: int = 0
    depends_on: tuple[str, ...] = ()
    model: str | None = None
    timeout_seconds: float | None = None
    role: str = ""
    max_handoffs: int = 3
    dependency_failure_mode: DependencyFailureMode = "inherit"


@dataclass(frozen=True)
class HandoffRequest:
    """Immutable request to hand off to a new agent."""

    target_role: str
    task_description: str
    context: str
    source_messages: tuple[dict, ...]
    remaining_handoffs: int


@dataclass(frozen=True)
class AgentRunMetrics:
    """Immutable metrics captured for a task agent run."""

    duration_seconds: float
    iterations: int
    tool_call_count: int
    context_compaction_count: int
    input_tokens: int
    output_tokens: int


@dataclass(frozen=True)
class AgentResult:
    """Immutable result of a task agent execution."""

    agent_id: str
    success: bool
    summary: str
    artifacts: tuple[str, ...] = ()
    error: str | None = None
    handoff: HandoffRequest | None = None
    failure_mode: FailureMode = "cancel_downstream"
    metrics: AgentRunMetrics | None = None
    skip_execution: bool = False
    replan_required: bool = False


TASK_AGENT_SYSTEM_PROMPT = """You are a task agent focused on completing a specific objective.
{role_section}
Your task: {task_description}
{context_section}

Guidelines:
- Focus exclusively on the assigned task
- Use available tools to accomplish the objective
- Use agent_send and agent_receive to coordinate with other agents if needed
- Be thorough but efficient
- When done, call task_complete with a detailed summary of what was accomplished
- Include any relevant file paths or outputs in your summary
"""


def _build_system_prompt(config: TaskAgentConfig) -> str:
    """Build the system prompt from a TaskAgentConfig."""
    role_section = f"\nYour role: {config.role}\n" if config.role else ""
    context_section = (
        f"\nAdditional context:\n{config.context}" if config.context else ""
    )
    return TASK_AGENT_SYSTEM_PROMPT.format(
        task_description=config.task_description,
        role_section=role_section,
        context_section=context_section,
    )


class TaskAgentRunner:
    """Runs a focused sub-task using a ReAct loop."""

    def __init__(
        self,
        agent_id: str,
        config: TaskAgentConfig,
        claude_client: AnthropicClient,
        tool_registry: ToolRegistry,
        tool_executor: ToolExecutor,
        event_emitter: EventEmitter,
        max_iterations: int = 50,
        observer: Observer | None = None,
    ) -> None:
        if not agent_id:
            raise ValueError("agent_id must not be empty")
        if not config.task_description.strip():
            raise ValueError("task_description must not be empty")
        settings = get_settings()

        self._agent_id = agent_id
        self._config = config
        self._client = claude_client
        self._registry = tool_registry
        self._executor = tool_executor
        self._emitter = event_emitter
        self._max_iterations = max_iterations
        self._observer = observer or Observer(
            max_full_interactions=settings.COMPACT_FULL_INTERACTIONS,
            token_budget=settings.COMPACT_TOKEN_BUDGET,
            claude_client=claude_client,
            summary_model=settings.COMPACT_SUMMARY_MODEL or settings.LITE_MODEL,
        )
        self._system_prompt = _build_system_prompt(config)
        self._task_complete_summary: str | None = None
        self._handoff_request: HandoffRequest | None = None
        self._artifact_ids: list[str] = []
        self._iterations = 0
        self._tool_call_count = 0
        self._context_compaction_count = 0
        self._input_tokens = 0
        self._output_tokens = 0

    async def on_task_complete(self, summary: str) -> None:
        """Callback for the task_complete tool."""
        self._task_complete_summary = summary

    async def on_handoff(self, request: HandoffRequest) -> None:
        """Callback for the agent_handoff tool."""
        self._handoff_request = request

    async def run(self) -> AgentResult:
        """Execute the task agent loop and return an AgentResult."""
        # AGENT_SPAWN is emitted earlier by SpawnTaskAgent.execute() so the
        # frontend plan checklist updates immediately without waiting for
        # semaphore acquisition.

        self._reset_run_state()
        started_at = time.perf_counter()
        settings = get_settings()
        timeout_seconds = (
            self._config.timeout_seconds
            if self._config.timeout_seconds is not None
            else settings.AGENT_TIMEOUT_SECONDS
        )

        try:
            final_text = await asyncio.wait_for(
                self._execute_loop(),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError:
            error = f"Task agent timed out after {timeout_seconds}s"
            metrics = self._build_metrics(started_at)
            await self._emit_complete(
                success=False,
                error=error,
                failure_mode="cancel_downstream",
                timed_out=True,
                timeout_seconds=timeout_seconds,
                metrics=metrics,
            )
            return AgentResult(
                agent_id=self._agent_id,
                success=False,
                summary="",
                artifacts=tuple(self._artifact_ids),
                error=error,
                failure_mode="cancel_downstream",
                metrics=metrics,
            )
        except Exception as exc:
            logger.exception("Task agent {} failed: {}", self._agent_id, exc)
            metrics = self._build_metrics(started_at)
            await self._emit_complete(
                success=False,
                error=str(exc),
                failure_mode="cancel_downstream",
                timed_out=False,
                timeout_seconds=timeout_seconds,
                metrics=metrics,
            )
            return AgentResult(
                agent_id=self._agent_id,
                success=False,
                summary="",
                artifacts=tuple(self._artifact_ids),
                error=str(exc),
                metrics=metrics,
            )

        metrics = self._build_metrics(started_at)
        await self._emit_complete(
            success=True,
            failure_mode="cancel_downstream",
            timed_out=False,
            timeout_seconds=timeout_seconds,
            metrics=metrics,
        )
        return AgentResult(
            agent_id=self._agent_id,
            success=True,
            summary=final_text,
            artifacts=tuple(self._artifact_ids),
            handoff=self._handoff_request,
            metrics=metrics,
        )

    def _reset_run_state(self) -> None:
        """Reset per-run counters before starting execution."""
        self._artifact_ids = []
        self._iterations = 0
        self._tool_call_count = 0
        self._context_compaction_count = 0
        self._input_tokens = 0
        self._output_tokens = 0

    def _build_metrics(self, started_at: float) -> AgentRunMetrics:
        """Build a metrics snapshot for the current run."""
        return AgentRunMetrics(
            duration_seconds=time.perf_counter() - started_at,
            iterations=self._iterations,
            tool_call_count=self._tool_call_count,
            context_compaction_count=self._context_compaction_count,
            input_tokens=self._input_tokens,
            output_tokens=self._output_tokens,
        )

    async def _emit_complete(
        self,
        *,
        success: bool,
        error: str | None = None,
        failure_mode: FailureMode = "cancel_downstream",
        timed_out: bool,
        timeout_seconds: float | None,
        metrics: AgentRunMetrics | None = None,
    ) -> None:
        """Emit the AGENT_COMPLETE event."""
        await self._emitter.emit(
            EventType.AGENT_COMPLETE,
            {
                "agent_id": self._agent_id,
                "success": success,
                "error": error,
                "failure_mode": failure_mode,
                "timed_out": timed_out,
                "timeout_seconds": timeout_seconds,
                "metrics": asdict(metrics) if metrics is not None else None,
            },
        )

    async def _execute_loop(self) -> str:
        """Run the ReAct loop until completion or error."""
        settings = get_settings()
        state = AgentState().add_message(
            {"role": "user", "content": self._config.task_description},
        )
        tools = self._registry.to_anthropic_tools()

        while not state.completed and state.error is None:
            state = state.increment_iteration()
            self._iterations = state.iteration
            state = await self._run_iteration(state, tools, settings)

        if state.error:
            raise RuntimeError(state.error)

        return extract_final_text(state)

    async def _run_iteration(
        self,
        state: AgentState,
        tools: list[dict[str, Any]],
        settings: Settings,
    ) -> AgentState:
        """Run a single iteration of the task agent loop."""
        # Compact history before the LLM call if needed
        if self._observer.should_compact(state.messages):
            compacted = await self._observer.compact(state.messages)
            self._context_compaction_count += 1
            await self._emitter.emit(
                EventType.CONTEXT_COMPACTED,
                {
                    "original_messages": len(state.messages),
                    "compacted_messages": len(compacted),
                },
            )
            state = replace(state, messages=compacted)

        if state.iteration > self._max_iterations:
            return state.mark_error(
                f"Exceeded maximum iterations ({self._max_iterations})",
            )

        try:

            async def _on_text_delta(delta: str) -> None:
                await self._emitter.emit(
                    EventType.TEXT_DELTA,
                    {"delta": delta},
                )

            response = await self._client.create_message_stream(
                system=self._system_prompt,
                messages=list(state.messages),
                tools=tools if tools else None,
                model=self._config.model or settings.TASK_MODEL,
                on_text_delta=_on_text_delta,
            )
        except Exception as exc:
            return state.mark_error(f"LLM call failed: {exc}")

        state = apply_response_to_state(state, response)
        self._input_tokens += response.usage.input_tokens
        self._output_tokens += response.usage.output_tokens

        if not response.tool_calls:
            return state.mark_completed(response.text)

        tool_result = await process_tool_calls(
            state=state,
            tool_calls=response.tool_calls,
            executor=self._executor,
            emitter=self._emitter,
            agent_id=self._agent_id,
            stop_check=lambda: (
                self._task_complete_summary is not None
                or self._handoff_request is not None
            ),
        )
        state = tool_result.state
        self._tool_call_count += tool_result.processed_count
        for artifact_id in tool_result.artifact_ids:
            if artifact_id not in self._artifact_ids:
                self._artifact_ids.append(artifact_id)

        if self._task_complete_summary is not None:
            return state.mark_completed(self._task_complete_summary)

        if self._handoff_request is not None:
            handoff_with_messages = HandoffRequest(
                target_role=self._handoff_request.target_role,
                task_description=self._handoff_request.task_description,
                context=self._handoff_request.context,
                source_messages=state.messages,
                remaining_handoffs=self._handoff_request.remaining_handoffs,
            )
            self._handoff_request = handoff_with_messages
            return state.mark_completed("Handing off to specialist agent.")

        return state
