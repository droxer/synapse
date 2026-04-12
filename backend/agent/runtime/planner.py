"""Planner orchestrator that decomposes tasks into sub-agent work."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from typing import Any, Protocol

from loguru import logger

from agent.llm.client import (
    AnthropicClient,
    LLMResponse,
    format_llm_failure,
    is_content_policy_error,
)
from agent.runtime.helpers import (
    apply_response_to_state,
    extract_final_text,
    process_tool_calls,
)
from agent.runtime.observer import Observer, compaction_summary_for_persistence
from agent.runtime.skill_install import install_skill_dependencies_for_turn
from agent.runtime.orchestrator import AgentState
from agent.runtime.skill_runtime import split_allowed_tools
from agent.runtime.skill_setup import (
    build_skill_prompt_content,
    emit_redundant_skill_activation,
    prepare_skill_for_turn,
)
from agent.runtime.skill_selector import select_skill_for_message
from agent.runtime.task_runner import TaskAgentConfig
from agent.runtime.turn_attachments import (
    build_user_message_content,
    upload_attachments_to_sandbox,
)
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
2. Call plan_create with the list of steps you intend to execute and classify each as planner-owned, sequential-worker, or parallel-worker
3. Use agent_spawn to create task agents for each step (use the same name from the plan)
4. Use agent_wait to wait for results
5. Synthesize the results and communicate to the user via user_message
6. Call task_complete when done

Guidelines:
- Always call plan_create FIRST before spawning any agents
- Do not spawn agents when one agent can complete the task with existing tools
- Spawn multiple agents only for truly independent sub-tasks
- Prefer one worker plus planner-side synthesis over many weakly-separated workers
- Prefer fixed sequential execution only when the task is a predictable pipeline
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
        initial_messages: tuple[dict[str, Any], ...] = (),
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
            max_full_dialogue_turns=settings.COMPACT_FULL_DIALOGUE_TURNS,
            token_budget=settings.COMPACT_TOKEN_BUDGET,
            claude_client=claude_client,
            summary_model=settings.COMPACT_SUMMARY_MODEL or settings.LITE_MODEL,
        )
        self._task_complete_summary: str | None = None
        self._system_prompt = system_prompt or PLANNER_SYSTEM_PROMPT
        self._skill_registry = skill_registry
        self._auto_injected_skill: str | None = None
        self._turn_base_prompt = self._system_prompt

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
        self._executor = tool_executor.with_registry(registry_with_meta)

        # Persistent conversation state — appended to on each run() call
        self._state = AgentState(messages=initial_messages)
        self._run_lock = asyncio.Lock()
        self._turn_artifact_ids: list[str] = []

    async def on_task_complete(self, summary: str) -> None:
        """Callback for the task_complete tool."""
        self._task_complete_summary = summary

    async def run(
        self,
        user_message: str,
        attachments: tuple[Any, ...] = (),
        selected_skills: tuple[str, ...] = (),
        runtime_prompt_sections: tuple[str, ...] = (),
        turn_metadata: dict[str, Any] | None = None,
    ) -> str:
        async with self._run_lock:
            return await self._run_locked(
                user_message=user_message,
                attachments=attachments,
                selected_skills=selected_skills,
                runtime_prompt_sections=runtime_prompt_sections,
                turn_metadata=turn_metadata,
            )

    async def _run_locked(
        self,
        *,
        user_message: str,
        attachments: tuple[Any, ...],
        selected_skills: tuple[str, ...],
        runtime_prompt_sections: tuple[str, ...],
        turn_metadata: dict[str, Any] | None,
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
            {
                "message": user_message,
                "orchestrator_mode": "planner",
                **(turn_metadata or {}),
            },
        )
        self._executor.reset_turn_quotas()
        self._executor.reset_sandbox_template()
        reset_active_skill_directory = getattr(
            self._executor, "reset_active_skill_directory", None
        )
        if callable(reset_active_skill_directory):
            reset_active_skill_directory()
        self._task_complete_summary = None
        self._auto_injected_skill = None

        base_prompt = self._system_prompt
        if runtime_prompt_sections:
            dynamic = [s for s in runtime_prompt_sections if s]
            if dynamic:
                base_prompt = "\n".join([base_prompt, *dynamic])
        self._turn_base_prompt = base_prompt

        # Skill matching via shared selector (before user message / uploads)
        effective_prompt = base_prompt
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
            self._auto_injected_skill = matched.metadata.name
            explicit_skill_name = next((s for s in selected_skills if s.strip()), None)
            source = "explicit" if explicit_skill_name is not None else "auto"

            # Replace ActivateSkill tool with active skill name
            from agent.tools.local.activate_skill import ActivateSkill

            effective_registry = effective_registry.replace_tool(
                ActivateSkill(
                    skill_registry=self._skill_registry,
                    active_skill_name=matched.metadata.name,
                )
            )
            try:
                await prepare_skill_for_turn(
                    executor=self._executor,
                    skill=matched,
                    emitter=self._emitter,
                    source=source,
                    install_dependencies=lambda: install_skill_dependencies_for_turn(
                        self._executor,
                        matched.metadata.dependencies,
                        self._emitter,
                        context="planner",
                        skill_name=matched.metadata.name,
                        source=source,
                        raise_on_error=True,
                    ),
                )
            except Exception as exc:
                await self._emitter.emit(
                    EventType.TASK_ERROR,
                    {
                        "error": str(exc),
                        "code": "skill_setup",
                        "retryable": False,
                    },
                )
                return f"Error: {exc}"
            effective_prompt = (
                base_prompt + "\n\n" + build_skill_prompt_content(matched)
            )

            # Filter tools by allowed_tools
            if matched.metadata.allowed_tools:
                allowed_names, allowed_tags = split_allowed_tools(
                    matched.metadata.allowed_tools
                )
                effective_registry = effective_registry.filter_by_names_or_tags(
                    allowed_names, allowed_tags
                )

        uploaded_paths: tuple[str, ...] = ()
        if attachments:
            try:
                uploaded_paths = await upload_attachments_to_sandbox(
                    self._executor,
                    attachments,
                )
            except Exception as exc:
                err = f"Failed to upload attached files to the sandbox: {exc}"
                await self._emitter.emit(
                    EventType.TASK_ERROR,
                    {
                        "error": err,
                        "code": "attachment_upload",
                        "retryable": False,
                    },
                )
                return f"Error: {err}"

        content: str | list[dict[str, Any]] = build_user_message_content(
            user_message,
            attachments,
            uploaded_paths=uploaded_paths,
        )
        self._state = self._state.add_message({"role": "user", "content": content})
        self._state = replace(self._state, completed=False, error=None, iteration=0)
        self._turn_artifact_ids = []

        tools = effective_registry.to_anthropic_tools()
        model = get_settings().PLANNING_MODEL

        try:
            while not self._state.completed and self._state.error is None:
                self._state = self._state.increment_iteration()
                self._state = await self._run_iteration(
                    self._state,
                    tools,
                    model,
                    effective_prompt,
                )

                updated = await self._check_mid_turn_skill_activation(
                    effective_prompt,
                    effective_registry,
                )
                if updated is not None:
                    effective_prompt, effective_registry, tools = updated
        finally:
            await self._cleanup_sub_agents()

        return await self._finalize(self._state)

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
                    "summary_text": compaction_summary_for_persistence(compacted),
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

        response, llm_error = await self._call_llm(
            state, tools, model, effective_prompt
        )
        if llm_error is not None:
            return state.mark_error(llm_error)

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
        self._turn_artifact_ids.extend(tool_result.artifact_ids)

        if self._task_complete_summary is not None:
            return state.mark_completed(self._task_complete_summary)

        return state

    async def _check_mid_turn_skill_activation(
        self,
        current_prompt: str,
        current_registry: ToolRegistry,
    ) -> tuple[str, ToolRegistry, list[dict[str, Any]]] | None:
        """Detect a successful mid-turn skill activation and enforce constraints."""
        if self._skill_registry is None:
            return None

        last_assistant = None
        for msg in reversed(self._state.messages):
            if msg.get("role") == "assistant":
                last_assistant = msg
                break

        if last_assistant is None:
            return None

        content = last_assistant.get("content")
        if not isinstance(content, list):
            return None

        activated_name: str | None = None
        tool_id: str | None = None
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            block_name = block.get("name")
            if block_name == "activate_skill":
                skill_input = block.get("input", {})
                activated_name = skill_input.get("name")
                tool_id = block.get("id")
                break
            if (
                isinstance(block_name, str)
                and self._skill_registry.find_by_name(block_name) is not None
            ):
                activated_name = block_name
                tool_id = block.get("id")
                break

        if not activated_name:
            return None

        if activated_name == self._auto_injected_skill:
            await emit_redundant_skill_activation(
                self._emitter,
                skill_name=activated_name,
                tool_id=tool_id,
                messages=list(self._state.messages),
            )
            return None

        if tool_id is not None:
            for msg in self._state.messages:
                if msg.get("role") != "user":
                    continue
                msg_content = msg.get("content")
                if not isinstance(msg_content, list):
                    continue
                for block in msg_content:
                    if (
                        isinstance(block, dict)
                        and block.get("type") == "tool_result"
                        and block.get("tool_use_id") == tool_id
                        and block.get("is_error") is True
                    ):
                        return None

        skill = self._skill_registry.find_by_name(activated_name)
        if skill is None:
            return None

        self._auto_injected_skill = skill.metadata.name
        effective_prompt = (
            self._turn_base_prompt + "\n\n" + build_skill_prompt_content(skill)
        )

        from agent.tools.local.activate_skill import ActivateSkill

        updated_registry = current_registry.replace_tool(
            ActivateSkill(
                skill_registry=self._skill_registry,
                active_skill_name=skill.metadata.name,
            )
        )

        await prepare_skill_for_turn(
            executor=self._executor,
            skill=skill,
            emitter=self._emitter,
            source="mid_turn",
            install_dependencies=lambda: install_skill_dependencies_for_turn(
                self._executor,
                skill.metadata.dependencies,
                self._emitter,
                context="planner_mid_turn",
                skill_name=skill.metadata.name,
                source="mid_turn",
                raise_on_error=True,
            ),
        )

        if skill.metadata.allowed_tools:
            allowed_names, allowed_tags = split_allowed_tools(
                skill.metadata.allowed_tools
            )
            updated_registry = updated_registry.filter_by_names_or_tags(
                allowed_names, allowed_tags
            )

        tools = updated_registry.to_anthropic_tools()
        logger.info("planner_mid_turn_skill_activated name={}", skill.metadata.name)
        return effective_prompt, updated_registry, tools

    async def _call_llm(
        self,
        state: AgentState,
        tools: list[dict[str, Any]],
        model: str,
        system_prompt: str | None = None,
    ) -> tuple[LLMResponse | None, str | None]:
        """Call the LLM with streaming and return the response or an error."""
        try:

            async def _on_text_delta(delta: str) -> None:
                await self._emitter.emit(
                    EventType.TEXT_DELTA,
                    {"delta": delta},
                    iteration=state.iteration,
                )

            response = await self._client.create_message_stream(
                system=system_prompt or self._system_prompt,
                messages=list(state.messages),
                tools=tools if tools else None,
                model=model,
                on_text_delta=_on_text_delta,
            )
            return response, None
        except Exception as exc:
            logger.exception("llm_call_failed_planning model={} error={}", model, exc)
            return None, format_llm_failure(exc)

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
            err_msg = state.error
            retryable = "LLM call failed" in err_msg
            code = "llm_error" if retryable else "agent_error"
            if is_content_policy_error(err_msg):
                code = "content_policy"
                retryable = False
            if "maximum iterations" in err_msg.lower():
                code = "max_iterations"
                retryable = False
            await self._emitter.emit(
                EventType.TASK_ERROR,
                {"error": err_msg, "code": code, "retryable": retryable},
            )
            return f"Error: {state.error}"

        final_text = extract_final_text(state)
        await self._emitter.emit(
            EventType.TURN_COMPLETE,
            {"result": final_text, "artifact_ids": self._turn_artifact_ids},
        )
        return final_text

    async def _cleanup_sub_agents(self) -> None:
        """Safely clean up all spawned sub-agents."""
        try:
            await self._sub_agent_manager.cleanup()
        except Exception as exc:
            logger.exception("failed_to_cleanup_sub_agents error={}", exc)
