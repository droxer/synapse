"""Single-agent ReAct loop orchestrator."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from typing import Any

from loguru import logger

from agent.llm.client import AnthropicClient
from agent.memory.compaction_flush import flush_heuristic_facts_from_messages
from agent.memory.store import PersistentMemoryStore
from agent.runtime.helpers import (
    apply_response_to_state,
    extract_final_text,
    process_tool_calls,
)
from agent.runtime.message_chain import (
    collect_message_chain_warnings,
    tool_calls_fingerprint,
)
from agent.runtime.observer import Observer, compaction_summary_for_persistence
from agent.runtime.skill_install import install_skill_dependencies_for_turn
from agent.runtime.skill_selector import select_skill_for_message
from agent.runtime.turn_attachments import (
    build_user_message_content,
    upload_attachments_to_sandbox,
)
from agent.skills.loader import SkillRegistry
from agent.tools.executor import ToolExecutor
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType
from config.settings import get_settings


@dataclass(frozen=True)
class AgentState:
    """Immutable state of an agent execution loop.

    All mutation methods return a new AgentState instance,
    leaving the original unchanged.
    """

    messages: tuple[dict[str, Any], ...] = ()
    iteration: int = 0
    completed: bool = False
    error: str | None = None

    def add_message(self, message: dict[str, Any]) -> AgentState:
        """Return new state with message appended."""
        return replace(self, messages=(*self.messages, message))

    def increment_iteration(self) -> AgentState:
        """Return new state with iteration incremented by one."""
        return replace(self, iteration=self.iteration + 1)

    def mark_completed(self, summary: str) -> AgentState:
        """Return new state marked as completed with a summary message."""
        final_msg: dict[str, Any] = {"role": "assistant", "content": summary}
        return replace(
            self,
            messages=(*self.messages, final_msg),
            completed=True,
        )

    def mark_error(self, error: str) -> AgentState:
        """Return new state marked as failed with an error message."""
        return replace(self, error=error)


class AgentOrchestrator:
    """Runs a single-agent ReAct loop until completion or max iterations."""

    def __init__(
        self,
        claude_client: AnthropicClient,
        tool_registry: ToolRegistry,
        tool_executor: ToolExecutor,
        event_emitter: EventEmitter,
        system_prompt: str,
        max_iterations: int = 50,
        observer: Observer | None = None,
        initial_messages: tuple[dict[str, Any], ...] = (),
        thinking_budget: int = 0,
        skill_registry: SkillRegistry | None = None,
        persistent_store: PersistentMemoryStore | None = None,
    ) -> None:
        if not system_prompt:
            raise ValueError("system_prompt must not be empty")
        settings = get_settings()
        self._client = claude_client
        self._base_registry = tool_registry
        self._executor = tool_executor
        self._emitter = event_emitter
        self._system_prompt = system_prompt
        self._max_iterations = max_iterations
        self._observer = observer or Observer(
            max_full_interactions=settings.COMPACT_FULL_INTERACTIONS,
            max_full_dialogue_turns=settings.COMPACT_FULL_DIALOGUE_TURNS,
            token_budget=settings.COMPACT_TOKEN_BUDGET,
            claude_client=claude_client,
            summary_model=settings.COMPACT_SUMMARY_MODEL or settings.LITE_MODEL,
        )
        self._persistent_store = persistent_store
        self._thinking_budget = thinking_budget
        self._task_complete_summary: str | None = None
        self._cancel_event = asyncio.Event()
        self._state = AgentState(messages=initial_messages)
        self._skill_registry = skill_registry
        self._auto_injected_skill: str | None = None
        self._run_lock = asyncio.Lock()
        self._last_tool_batch_signature: str | None = None
        self._identical_tool_batch_count: int = 0

    async def on_task_complete(self, summary: str) -> None:
        """Callback for the task_complete tool."""
        self._task_complete_summary = summary

    def cancel(self) -> None:
        """Signal the current turn to stop."""
        self._cancel_event.set()

    def reset_cancel(self) -> None:
        """Clear the cancellation signal."""
        self._cancel_event.clear()

    def get_last_user_message(self) -> str | None:
        """Return the content of the most recent user message, or None."""
        for msg in reversed(self._state.messages):
            if msg.get("role") == "user":
                content = msg.get("content")
                if isinstance(content, str):
                    return content
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            return block.get("text", "")
        return None

    def rollback_to_before_last_user_message(self) -> None:
        """Remove the last user message and everything after it."""
        messages = list(self._state.messages)
        for i in range(len(messages) - 1, -1, -1):
            if messages[i].get("role") == "user":
                self._state = replace(
                    self._state,
                    messages=tuple(messages[:i]),
                    completed=False,
                    error=None,
                )
                return

    @staticmethod
    def _append_text_guard_to_last_user_message(
        state: AgentState,
        extra_text: str,
    ) -> AgentState:
        """Append a text guard/nudge to the last user message when possible."""
        if not state.messages:
            return state.add_message({"role": "user", "content": extra_text})
        msgs = list(state.messages)
        last = msgs[-1]
        if last.get("role") != "user":
            return state.add_message({"role": "user", "content": extra_text})
        content = last.get("content")
        if isinstance(content, str):
            msgs[-1] = {**last, "content": f"{content}\n\n{extra_text}"}
        elif isinstance(content, list):
            msgs[-1] = {
                **last,
                "content": [
                    *content,
                    {"type": "text", "text": extra_text},
                ],
            }
        else:
            return state.add_message({"role": "user", "content": extra_text})
        return replace(state, messages=tuple(msgs))

    async def _emit_task_error(
        self,
        message: str,
        *,
        code: str = "agent_error",
        retryable: bool = False,
    ) -> None:
        await self._emitter.emit(
            EventType.TASK_ERROR,
            {"error": message, "code": code, "retryable": retryable},
        )

    # NOTE: concurrent run() calls are serialized via ``_run_lock``.
    async def run(
        self,
        user_message: str,
        attachments: tuple[Any, ...] = (),
        selected_skills: tuple[str, ...] = (),
        runtime_prompt_sections: tuple[str, ...] = (),
    ) -> str:
        """Execute the agent loop and return the final text response."""
        if not user_message.strip():
            raise ValueError("user_message must not be empty")

        async with self._run_lock:
            return await self._run_locked(
                user_message=user_message,
                attachments=attachments,
                selected_skills=selected_skills,
                runtime_prompt_sections=runtime_prompt_sections,
            )

    async def _run_locked(
        self,
        *,
        user_message: str,
        attachments: tuple[Any, ...],
        selected_skills: tuple[str, ...],
        runtime_prompt_sections: tuple[str, ...],
    ) -> str:
        logger.info("turn_start user_message_length={}", len(user_message))

        await self._emitter.emit(
            EventType.TURN_START,
            {"message": user_message},
        )

        self._executor.reset_turn_quotas()
        self._executor.reset_sandbox_template()
        self._registry = self._base_registry
        self._last_tool_batch_signature = None
        self._identical_tool_batch_count = 0

        # Append user message to existing state (preserves conversation history)
        self._task_complete_summary = None

        # Auto-match skill for this turn via shared selector
        effective_prompt = self._system_prompt
        if runtime_prompt_sections:
            dynamic_sections = [
                section for section in runtime_prompt_sections if section
            ]
            if dynamic_sections:
                effective_prompt = "\n".join([effective_prompt, *dynamic_sections])
        self._auto_injected_skill = None
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
            effective_prompt = (
                self._system_prompt
                + f'\n\n<skill_content name="{matched.metadata.name}">\n'
                + matched.instructions
                + "\n</skill_content>"
            )
            explicit_skill_name = next((s for s in selected_skills if s.strip()), None)
            source = "explicit" if explicit_skill_name is not None else "auto"
            logger.info(
                "skill_activated name={} source={}",
                matched.metadata.name,
                source,
            )
            await self._emitter.emit(
                EventType.SKILL_ACTIVATED,
                {"name": matched.metadata.name, "source": source},
            )
            # Replace ActivateSkill tool with active skill name (copy-on-write)
            from agent.tools.local.activate_skill import ActivateSkill

            self._registry = self._registry.replace_tool(
                ActivateSkill(
                    skill_registry=self._skill_registry,
                    active_skill_name=matched.metadata.name,
                )
            )

        # Apply skill's sandbox template (e.g. data_science) so that
        # both file uploads and tool execution target the correct image.
        if (
            self._auto_injected_skill is not None
            and matched is not None
            and matched.metadata.sandbox_template
        ):
            self._executor.set_sandbox_template(matched.metadata.sandbox_template)
            logger.info(
                "skill_sandbox_template name={} template={}",
                matched.metadata.name,
                matched.metadata.sandbox_template,
            )

        # Auto-install skill dependencies before any sandbox interaction
        if (
            self._auto_injected_skill is not None
            and matched is not None
            and matched.metadata.dependencies
        ):
            await install_skill_dependencies_for_turn(
                self._executor,
                matched.metadata.dependencies,
                self._emitter,
                context="orchestrator",
            )

        uploaded_paths: tuple[str, ...] = ()
        if attachments:
            try:
                uploaded_paths = await upload_attachments_to_sandbox(
                    self._executor,
                    attachments,
                )
            except Exception as exc:
                error = f"Failed to upload attached files to the sandbox: {exc}"
                await self._emit_task_error(
                    error,
                    code="attachment_upload",
                    retryable=False,
                )
                return f"Error: {error}"

        # Build message content only after uploads are verified.
        content = build_user_message_content(
            user_message,
            attachments,
            uploaded_paths=uploaded_paths,
        )

        self._state = self._state.add_message(
            {"role": "user", "content": content},
        )
        self._state = replace(self._state, completed=False, error=None, iteration=0)

        # Filter tools to skill's allowed set (if specified)
        effective_registry = self._registry
        if (
            self._auto_injected_skill is not None
            and matched is not None
            and matched.metadata.allowed_tools
        ):
            allowed = set(matched.metadata.allowed_tools) | {"activate_skill"}
            effective_registry = self._registry.filter_by_names(allowed)

        tools = effective_registry.to_anthropic_tools()

        while not self._state.completed and self._state.error is None:
            if self._cancel_event.is_set():
                break
            self._state = self._state.increment_iteration()
            self._state = await self._run_iteration(
                self._state, tools, effective_prompt
            )

            # Check if activate_skill was invoked mid-turn and enforce constraints
            updated = await self._check_mid_turn_skill_activation(
                effective_prompt, effective_registry
            )
            if updated is not None:
                effective_prompt, effective_registry, tools = updated

        logger.info("turn_complete iterations={}", self._state.iteration)

        if self._cancel_event.is_set():
            self._cancel_event.clear()
            final_text = extract_final_text(self._state)
            await self._emitter.emit(
                EventType.TURN_CANCELLED,
                {"result": final_text},
            )
            # Reset so the orchestrator can accept new turns
            self._state = replace(self._state, completed=False, error=None)
            return final_text

        if self._state.error:
            err_msg = self._state.error
            retryable = "LLM call failed" in err_msg
            code = "llm_error" if retryable else "agent_error"
            if "maximum iterations" in err_msg.lower():
                code = "max_iterations"
                retryable = False
            await self._emit_task_error(err_msg, code=code, retryable=retryable)
            return f"Error: {self._state.error}"

        final_text = extract_final_text(self._state)
        await self._emitter.emit(
            EventType.TURN_COMPLETE,
            {"result": final_text},
        )
        return final_text

    async def _check_mid_turn_skill_activation(
        self,
        current_prompt: str,
        current_registry: ToolRegistry,
    ) -> tuple[str, ToolRegistry, list[dict[str, Any]]] | None:
        """Detect a successful mid-turn activate_skill call and enforce constraints.

        Returns (effective_prompt, effective_registry, tools) if a new skill was
        activated, or None if no change occurred.
        """
        if self._skill_registry is None:
            return None

        # Look at the last assistant message for activate_skill tool_use blocks
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

        # Find activate_skill tool_use block (single pass)
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

        # Skip if this skill is already the active one
        if activated_name == self._auto_injected_skill:
            return None

        if tool_id is not None:
            # Find the tool result message
            for msg in self._state.messages:
                if msg.get("role") == "user":
                    msg_content = msg.get("content")
                    if isinstance(msg_content, list):
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

        # Update active skill tracking
        self._auto_injected_skill = skill.metadata.name

        # Inject skill instructions into prompt
        effective_prompt = (
            self._system_prompt
            + f'\n\n<skill_content name="{skill.metadata.name}">\n'
            + skill.instructions
            + "\n</skill_content>"
        )

        # Replace ActivateSkill tool with updated active skill name
        from agent.tools.local.activate_skill import ActivateSkill

        updated_registry = current_registry.replace_tool(
            ActivateSkill(
                skill_registry=self._skill_registry,
                active_skill_name=skill.metadata.name,
            )
        )

        # Apply sandbox template if specified
        if skill.metadata.sandbox_template:
            self._executor.set_sandbox_template(skill.metadata.sandbox_template)
            logger.info(
                "mid_turn_skill_sandbox_template name={} template={}",
                skill.metadata.name,
                skill.metadata.sandbox_template,
            )

        # Auto-install dependencies if specified
        if skill.metadata.dependencies:
            await install_skill_dependencies_for_turn(
                self._executor,
                skill.metadata.dependencies,
                self._emitter,
                context="orchestrator_mid_turn",
            )

        # Filter tools by allowed_tools if specified
        if skill.metadata.allowed_tools:
            allowed = set(skill.metadata.allowed_tools) | {"activate_skill"}
            updated_registry = updated_registry.filter_by_names(allowed)

        tools = updated_registry.to_anthropic_tools()

        logger.info(
            "mid_turn_skill_activated name={}",
            skill.metadata.name,
        )

        await self._emitter.emit(
            EventType.SKILL_ACTIVATED,
            {"name": skill.metadata.name, "source": "mid_turn"},
        )

        return effective_prompt, updated_registry, tools

    async def _run_iteration(
        self,
        state: AgentState,
        tools: list[dict[str, Any]],
        system_prompt: str | None = None,
    ) -> AgentState:
        """Run a single iteration of the ReAct loop."""
        effective_prompt = system_prompt or self._system_prompt

        settings = get_settings()
        if settings.VALIDATE_AGENT_MESSAGE_CHAIN:
            chain_warnings = collect_message_chain_warnings(state.messages)
            for w in chain_warnings:
                logger.warning("message_chain_warning detail={}", w)

        # Compact message history before the LLM call if needed
        if self._observer.should_compact(state.messages, effective_prompt):
            logger.debug("compacting_message_history")
            if settings.COMPACT_MEMORY_FLUSH and self._persistent_store is not None:
                await flush_heuristic_facts_from_messages(
                    self._persistent_store,
                    state.messages,
                )
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

        logger.info("iteration={}/{}", state.iteration, self._max_iterations)

        await self._emitter.emit(
            EventType.ITERATION_START,
            {"iteration": state.iteration},
            iteration=state.iteration,
        )

        if state.iteration > self._max_iterations:
            logger.warning("max_iterations_exceeded limit={}", self._max_iterations)
            return state.mark_error(
                f"Exceeded maximum iterations ({self._max_iterations})",
            )

        llm_model = self._client.default_model
        try:

            async def _on_text_delta(delta: str) -> None:
                await self._emitter.emit(
                    EventType.TEXT_DELTA,
                    {"delta": delta},
                    iteration=state.iteration,
                )

            response = await self._client.create_message_stream(
                system=effective_prompt,
                messages=list(state.messages),
                tools=tools if tools else None,
                on_text_delta=_on_text_delta,
                thinking_budget=self._thinking_budget,
            )
        except Exception as exc:
            logger.error("llm_call_failed model={} error={}", llm_model, exc)
            return state.mark_error(f"LLM call failed: {exc}")

        logger.info(
            "llm_response model={} stop_reason={} tool_calls={} input_tokens={} output_tokens={}",
            llm_model,
            response.stop_reason,
            len(response.tool_calls),
            response.usage.input_tokens,
            response.usage.output_tokens,
        )

        if response.thinking:
            await self._emitter.emit(
                EventType.THINKING,
                {"thinking": response.thinking},
                iteration=state.iteration,
            )

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

        state = apply_response_to_state(state, response)

        if not response.tool_calls:
            return state.mark_completed(response.text)

        tool_result = await process_tool_calls(
            state=state,
            tool_calls=response.tool_calls,
            executor=self._executor,
            emitter=self._emitter,
            stop_check=lambda: self._task_complete_summary is not None,
            cancel_check=lambda: self._cancel_event.is_set(),
        )
        state = tool_result.state

        threshold = settings.STUCK_LOOP_TOOL_REPEAT_THRESHOLD
        if threshold > 0 and response.tool_calls:
            sig = tool_calls_fingerprint(response.tool_calls)
            if sig == self._last_tool_batch_signature:
                self._identical_tool_batch_count += 1
            else:
                self._last_tool_batch_signature = sig
                self._identical_tool_batch_count = 1
            if self._identical_tool_batch_count >= threshold:
                nudge = (
                    "System notice: The same tool calls were repeated several times. "
                    "Change approach: verify assumptions, try different tools, "
                    "or explain what is blocking progress."
                )
                await self._emitter.emit(
                    EventType.LOOP_GUARD_NUDGE,
                    {
                        "iteration": state.iteration,
                        "repeated_signature": sig[:500],
                    },
                    iteration=state.iteration,
                )
                state = self._append_text_guard_to_last_user_message(state, nudge)
                self._identical_tool_batch_count = 0
                self._last_tool_batch_signature = None

        # Check if task_complete tool was invoked during tool processing
        if self._task_complete_summary is not None:
            return state.mark_completed(self._task_complete_summary)

        return state
