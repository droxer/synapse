"""Planner orchestrator that decomposes tasks into sub-agent work."""

from __future__ import annotations

from dataclasses import replace
from typing import Any, Protocol

from loguru import logger

from agent.llm.client import AnthropicClient, LLMResponse
from agent.runtime.helpers import (
    apply_response_to_state,
    extract_final_text,
    process_tool_calls,
)
from agent.runtime.observer import Observer
from agent.runtime.orchestrator import AgentState
from agent.runtime.skill_dependencies import (
    build_install_command,
    group_safe_dependencies,
)
from agent.runtime.skill_selector import select_skill_for_message
from agent.runtime.task_runner import TaskAgentConfig
from agent.skills.loader import SkillRegistry
from agent.tools.executor import ToolExecutor
from agent.tools.meta.plan_create import PlanCreate
from agent.tools.meta.spawn_task_agent import SpawnTaskAgent
from agent.tools.meta.wait_for_agents import WaitForAgents
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType
from config.settings import get_settings

PLANNER_SYSTEM_PROMPT = """You are a planning agent that decomposes complex tasks into sub-tasks.

Your workflow:
1. Analyze the user's request
2. Call plan_create with the list of steps you intend to execute
3. Use agent_spawn to create task agents for each step (use the same name from the plan)
4. Use agent_wait to wait for results
5. Synthesize the results and communicate to the user via user_message
6. Call task_complete when done

Guidelines:
- Always call plan_create FIRST before spawning any agents
- Spawn agents for tasks that can run in parallel
- Each agent gets its own sandbox if needed
- Keep sub-tasks focused and specific
- You do NOT have sandbox access — delegate execution to task agents
"""


class SubAgentManagerProtocol(Protocol):
    """Protocol for managing spawned task agents."""

    async def spawn(self, config: TaskAgentConfig) -> str:
        """Spawn a task agent and return its ID."""
        ...

    async def wait(self, agent_ids: list[str] | None = None) -> dict[str, Any]:
        """Wait for agents to complete and return their results."""
        ...

    async def cleanup(self) -> None:
        """Clean up all managed sub-agents."""
        ...


class PlannerOrchestrator:
    """Top-level orchestrator that decomposes requests into sub-agent tasks.

    Uses a planning model to reason about task decomposition and coordinates
    sub-agents via a SubAgentManager. Follows the same ReAct loop pattern
    as AgentOrchestrator but with planner-specific system prompt and tools.

    Conversation history is preserved across ``run()`` calls.
    """

    def __init__(
        self,
        claude_client: AnthropicClient,
        tool_registry: ToolRegistry,
        tool_executor: ToolExecutor,
        event_emitter: EventEmitter,
        sub_agent_manager: SubAgentManagerProtocol,
        max_iterations: int = 30,
        observer: Observer | None = None,
        system_prompt: str = "",
        skill_registry: SkillRegistry | None = None,
    ) -> None:
        if max_iterations < 1:
            raise ValueError("max_iterations must be at least 1")
        settings = get_settings()

        self._client = claude_client
        self._sub_agent_manager = sub_agent_manager
        self._emitter = event_emitter
        self._max_iterations = max_iterations
        self._observer = observer or Observer(
            max_full_interactions=settings.COMPACT_FULL_INTERACTIONS,
            token_budget=settings.COMPACT_TOKEN_BUDGET,
            claude_client=claude_client,
            summary_model=settings.COMPACT_SUMMARY_MODEL or settings.LITE_MODEL,
        )
        self._task_complete_summary: str | None = None
        self._system_prompt = system_prompt or PLANNER_SYSTEM_PROMPT
        self._skill_registry = skill_registry

        # Register meta-tools into the provided registry
        registry_with_meta = tool_registry.register(
            PlanCreate(event_emitter=event_emitter),
        )
        registry_with_meta = registry_with_meta.register(
            SpawnTaskAgent(
                sub_agent_manager=sub_agent_manager,
                event_emitter=event_emitter,
            ),
        )
        registry_with_meta = registry_with_meta.register(
            WaitForAgents(sub_agent_manager=sub_agent_manager),
        )

        self._registry = registry_with_meta
        # Preserve sandbox provider/config from the passed executor
        self._executor = ToolExecutor(
            registry=registry_with_meta,
            sandbox_provider=tool_executor._sandbox_provider,
            sandbox_config=tool_executor._sandbox_config,
        )

        # Persistent conversation state — appended to on each run() call
        self._state = AgentState()

    async def on_task_complete(self, summary: str) -> None:
        """Callback for the task_complete tool."""
        self._task_complete_summary = summary

    async def run(
        self,
        user_message: str,
        attachments: tuple = (),
        selected_skills: tuple[str, ...] = (),
    ) -> str:
        """Execute the planner loop and return the final synthesized response.

        Emits lifecycle events throughout execution and cleans up
        sub-agents on completion (success or failure).
        Conversation history is preserved across calls.
        """
        if not user_message.strip():
            raise ValueError("user_message must not be empty")

        await self._emitter.emit(
            EventType.TURN_START,
            {"message": user_message},
        )

        # Append to persistent state rather than creating a fresh one
        self._state = self._state.add_message(
            {"role": "user", "content": user_message},
        )
        self._task_complete_summary = None
        self._state = replace(self._state, completed=False, error=None, iteration=0)

        # Skill matching via shared selector
        effective_prompt = self._system_prompt
        effective_registry = self._registry
        settings = get_settings()
        matched = await select_skill_for_message(
            user_message=user_message,
            selected_skills=selected_skills,
            skill_registry=self._skill_registry,
            client=self._client,
            model=settings.SKILL_SELECTOR_MODEL or settings.LITE_MODEL,
        )
        if matched is not None:
            effective_prompt = (
                self._system_prompt
                + f'\n\n<skill_content name="{matched.metadata.name}">\n'
                + matched.instructions
                + "\n</skill_content>"
            )
            explicit_skill_name = next((s for s in selected_skills if s.strip()), None)
            source = "explicit" if explicit_skill_name is not None else "auto"
            logger.info(
                "planner_skill_activated name={} source={}",
                matched.metadata.name,
                source,
            )
            await self._emitter.emit(
                EventType.SKILL_ACTIVATED,
                {"name": matched.metadata.name, "source": source},
            )

            # Replace ActivateSkill tool with active skill name
            from agent.tools.local.activate_skill import ActivateSkill

            effective_registry = effective_registry.replace_tool(
                ActivateSkill(
                    skill_registry=self._skill_registry,
                    active_skill_name=matched.metadata.name,
                )
            )

            # Apply sandbox template
            if matched.metadata.sandbox_template:
                self._executor.set_sandbox_template(matched.metadata.sandbox_template)
                logger.info(
                    "planner_skill_sandbox_template name={} template={}",
                    matched.metadata.name,
                    matched.metadata.sandbox_template,
                )

            # Auto-install dependencies
            if matched.metadata.dependencies:
                await self._install_skill_dependencies(matched.metadata.dependencies)

            # Filter tools by allowed_tools
            if matched.metadata.allowed_tools:
                allowed = set(matched.metadata.allowed_tools) | {"activate_skill"}
                effective_registry = effective_registry.filter_by_names_or_tags(
                    allowed,
                    {"mcp"},
                )

        tools = effective_registry.to_anthropic_tools()
        model = get_settings().PLANNING_MODEL

        try:
            self._state = await self._execute_loop(
                self._state, tools, model, effective_prompt
            )
        finally:
            await self._cleanup_sub_agents()

        return await self._finalize(self._state)

    async def _execute_loop(
        self,
        state: AgentState,
        tools: list[dict[str, Any]],
        model: str,
        system_prompt: str | None = None,
    ) -> AgentState:
        """Run the ReAct loop until completion, error, or max iterations."""
        while not state.completed and state.error is None:
            state = state.increment_iteration()
            state = await self._run_iteration(state, tools, model, system_prompt)
        return state

    async def _run_iteration(
        self,
        state: AgentState,
        tools: list[dict[str, Any]],
        model: str,
        system_prompt: str | None = None,
    ) -> AgentState:
        """Run a single iteration of the planner ReAct loop."""
        effective_prompt = system_prompt or self._system_prompt

        # Compact history before the LLM call if needed
        if self._observer.should_compact(state.messages, effective_prompt):
            compacted = await self._observer.compact(state.messages, effective_prompt)
            await self._emitter.emit(
                EventType.CONTEXT_COMPACTED,
                {
                    "original_messages": len(state.messages),
                    "compacted_messages": len(compacted),
                },
                iteration=state.iteration,
            )
            state = replace(state, messages=compacted)

        await self._emitter.emit(
            EventType.ITERATION_START,
            {"iteration": state.iteration},
            iteration=state.iteration,
        )

        if state.iteration > self._max_iterations:
            return state.mark_error(
                f"Exceeded maximum iterations ({self._max_iterations})",
            )

        response = await self._call_llm(state, tools, model, effective_prompt)
        if response is None:
            return state.mark_error("LLM call failed")

        await self._emit_llm_response(state, response)

        state = apply_response_to_state(state, response)

        if not response.tool_calls:
            return state.mark_completed(response.text)

        tool_result = await process_tool_calls(
            state=state,
            tool_calls=response.tool_calls,
            executor=self._executor,
            emitter=self._emitter,
            stop_check=lambda: self._task_complete_summary is not None,
        )
        state = tool_result.state

        if self._task_complete_summary is not None:
            return state.mark_completed(self._task_complete_summary)

        return state

    async def _install_skill_dependencies(
        self,
        dependencies: tuple[str, ...],
    ) -> None:
        """Auto-install skill dependencies in the sandbox.

        Format: ``manager:package`` (e.g. ``npm:pptxgenjs``).
        Defaults to ``pip`` if no manager prefix.
        """
        by_manager = group_safe_dependencies(dependencies)

        for manager, packages in by_manager.items():
            packages_str = " ".join(packages)
            logger.info(
                "planner_auto_installing_dependencies manager={} packages={}",
                manager,
                packages_str,
            )
            try:
                session = await self._executor.get_sandbox_session()
                result = await session.exec(
                    build_install_command(manager, packages), timeout=120
                )

                if not result.success:
                    logger.error(
                        "planner_dependency_install_failed manager={} packages={} error={}",
                        manager,
                        packages_str,
                        result.stderr or result.stdout,
                    )
                else:
                    logger.info(
                        "planner_dependencies_installed manager={} packages={}",
                        manager,
                        packages_str,
                    )
            except Exception as exc:
                logger.error(
                    "planner_dependency_install_error manager={} packages={} error={}",
                    manager,
                    packages_str,
                    exc,
                )

    async def _call_llm(
        self,
        state: AgentState,
        tools: list[dict[str, Any]],
        model: str,
        system_prompt: str | None = None,
    ) -> LLMResponse | None:
        """Call the LLM with streaming and return the response, or None on failure."""
        try:

            async def _on_text_delta(delta: str) -> None:
                await self._emitter.emit(
                    EventType.TEXT_DELTA,
                    {"delta": delta},
                    iteration=state.iteration,
                )

            return await self._client.create_message_stream(
                system=system_prompt or self._system_prompt,
                messages=list(state.messages),
                tools=tools if tools else None,
                model=model,
                on_text_delta=_on_text_delta,
            )
        except Exception as exc:
            logger.exception("llm_call_failed_planning error={}", exc)
            return None

    async def _emit_llm_response(
        self,
        state: AgentState,
        response: LLMResponse,
    ) -> None:
        """Emit an LLM_RESPONSE event."""
        await self._emitter.emit(
            EventType.LLM_RESPONSE,
            {
                "text": response.text,
                "tool_call_count": len(response.tool_calls),
                "stop_reason": response.stop_reason,
                "usage": response.usage,
            },
            iteration=state.iteration,
        )

    async def _finalize(self, state: AgentState) -> str:
        """Emit final event and return the result text."""
        if state.error:
            await self._emitter.emit(
                EventType.TASK_ERROR,
                {"error": state.error},
            )
            return f"Error: {state.error}"

        final_text = extract_final_text(state)
        await self._emitter.emit(
            EventType.TURN_COMPLETE,
            {"result": final_text},
        )
        return final_text

    async def _cleanup_sub_agents(self) -> None:
        """Safely clean up all spawned sub-agents."""
        try:
            await self._sub_agent_manager.cleanup()
        except Exception as exc:
            logger.exception("failed_to_cleanup_sub_agents error={}", exc)
