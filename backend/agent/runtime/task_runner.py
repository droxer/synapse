"""Task agent runner for executing focused sub-tasks."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from agent.llm.client import ClaudeClient
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


@dataclass(frozen=True)
class TaskAgentConfig:
    """Immutable configuration for a task agent."""

    task_description: str
    context: str = ""
    sandbox_template: str = "default"
    priority: int = 0
    depends_on: tuple[str, ...] = ()
    model: str | None = None
    role: str = ""
    max_handoffs: int = 3


@dataclass(frozen=True)
class HandoffRequest:
    """Immutable request to hand off to a new agent."""

    target_role: str
    task_description: str
    context: str
    source_messages: tuple[dict, ...]
    remaining_handoffs: int


@dataclass(frozen=True)
class AgentResult:
    """Immutable result of a task agent execution."""

    agent_id: str
    success: bool
    summary: str
    artifacts: tuple[str, ...] = ()
    error: str | None = None
    handoff: HandoffRequest | None = None


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
        claude_client: ClaudeClient,
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

        self._agent_id = agent_id
        self._config = config
        self._client = claude_client
        self._registry = tool_registry
        self._executor = tool_executor
        self._emitter = event_emitter
        self._max_iterations = max_iterations
        self._observer = observer or Observer()
        self._system_prompt = _build_system_prompt(config)
        self._task_complete_summary: str | None = None
        self._handoff_request: HandoffRequest | None = None

    async def on_task_complete(self, summary: str) -> None:
        """Callback for the task_complete tool."""
        self._task_complete_summary = summary

    async def on_handoff(self, request: HandoffRequest) -> None:
        """Callback for the agent_handoff tool."""
        self._handoff_request = request

    async def run(self) -> AgentResult:
        """Execute the task agent loop and return an AgentResult."""
        await self._emitter.emit(
            EventType.AGENT_SPAWN,
            {
                "agent_id": self._agent_id,
                "task": self._config.task_description,
                "description": self._config.task_description,
            },
        )

        try:
            final_text = await self._execute_loop()
        except Exception as exc:
            logger.exception("Task agent {} failed: {}", self._agent_id, exc)
            await self._emit_complete(success=False, error=str(exc))
            return AgentResult(
                agent_id=self._agent_id,
                success=False,
                summary="",
                error=str(exc),
            )

        await self._emit_complete(success=True)
        return AgentResult(
            agent_id=self._agent_id,
            success=True,
            summary=final_text,
            handoff=self._handoff_request,
        )

    async def _emit_complete(
        self,
        *,
        success: bool,
        error: str | None = None,
    ) -> None:
        """Emit the AGENT_COMPLETE event."""
        await self._emitter.emit(
            EventType.AGENT_COMPLETE,
            {
                "agent_id": self._agent_id,
                "success": success,
                "error": error,
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
            compacted = self._observer.compact(state.messages)
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

        if not response.tool_calls:
            return state.mark_completed(response.text)

        state = await process_tool_calls(
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
