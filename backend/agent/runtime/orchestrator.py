"""Single-agent ReAct loop orchestrator."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from typing import Any

from loguru import logger

from agent.llm.client import AnthropicClient
from agent.runtime.helpers import (
    apply_response_to_state,
    extract_final_text,
    process_tool_calls,
)
from agent.runtime.observer import Observer
from agent.runtime.skill_dependencies import (
    build_install_command,
    group_safe_dependencies,
)
from agent.runtime.skill_selector import select_skill_for_message
from agent.sandbox.base import SANDBOX_HOME_DIR
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
            token_budget=settings.COMPACT_TOKEN_BUDGET,
            claude_client=claude_client,
            summary_model=settings.COMPACT_SUMMARY_MODEL or settings.LITE_MODEL,
        )
        self._thinking_budget = thinking_budget
        self._task_complete_summary: str | None = None
        self._cancel_event = asyncio.Event()
        self._state = AgentState(messages=initial_messages)
        self._skill_registry = skill_registry
        self._auto_injected_skill: str | None = None

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

    async def _upload_attachments(
        self, attachments: tuple[Any, ...]
    ) -> tuple[str, ...]:
        """Upload file attachments to the sandbox.

        Called after skill matching so the correct sandbox template is
        already configured on the executor.
        """
        import os
        import shlex
        import tempfile

        upload_dir = f"{SANDBOX_HOME_DIR}/uploads"
        session = await self._executor.get_sandbox_session()
        sandbox_id = getattr(session, "sandbox_id", None)
        logger.info(
            "upload_session_ready sandbox_id={} upload_dir={}",
            sandbox_id or "unknown",
            upload_dir,
        )
        mkdir_result = await session.exec(f"mkdir -p {shlex.quote(upload_dir)}")
        if not mkdir_result.success:
            raise RuntimeError(
                f"Failed to prepare upload directory '{upload_dir}': "
                f"{mkdir_result.stderr or mkdir_result.stdout}"
            )

        uploaded_paths: list[str] = []

        for att in attachments:
            safe_name = self._safe_display_name(att.filename)
            remote_path = f"{upload_dir}/{safe_name}"
            try:
                with tempfile.NamedTemporaryFile(
                    delete=False, suffix=f"_{safe_name}"
                ) as tmp:
                    tmp.write(att.data)
                    tmp_path = tmp.name
                try:
                    await session.upload_file(tmp_path, remote_path)
                finally:
                    os.unlink(tmp_path)
                verify_result = await session.exec(
                    f"test -f {shlex.quote(remote_path)}"
                )
                if not verify_result.success:
                    raise RuntimeError(
                        f"Uploaded file was not found at '{remote_path}'"
                    )
                uploaded_paths.append(remote_path)
                logger.info(
                    "uploaded_file sandbox_id={} remote_path={} filename={} size={}",
                    sandbox_id or "unknown",
                    remote_path,
                    safe_name,
                    att.size,
                )
            except Exception as exc:
                logger.error(
                    "file_upload_failed sandbox_id={} remote_path={} filename={} error={}",
                    sandbox_id or "unknown",
                    remote_path,
                    att.filename,
                    exc,
                )
                raise RuntimeError(
                    f"Failed to upload '{safe_name}' to the sandbox"
                ) from exc

        return tuple(uploaded_paths)

    @staticmethod
    def _safe_display_name(filename: str) -> str:
        """Return a display-safe filename stripped of path separators."""
        import os
        import re

        name = os.path.basename(filename)
        name = re.sub(r"[^\w.\- ]", "_", name)
        return name.strip() or "unnamed"

    def _build_message_content(
        self,
        user_message: str,
        attachments: tuple[Any, ...],
        uploaded_paths: tuple[str, ...] = (),
    ) -> str | list[dict[str, Any]]:
        """Build user message content, adding multimodal blocks for attachments."""
        if not attachments:
            return user_message

        import base64

        from api.models import VISION_MIME_TYPES

        blocks: list[dict[str, Any]] = []
        sandbox_files = list(uploaded_paths)

        for att in attachments:
            if att.content_type in VISION_MIME_TYPES:
                encoded = base64.standard_b64encode(att.data).decode("ascii")
                if att.content_type == "application/pdf":
                    blocks.append(
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": att.content_type,
                                "data": encoded,
                            },
                        }
                    )
                else:
                    blocks.append(
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": att.content_type,
                                "data": encoded,
                            },
                        }
                    )

        # Add user text + file listing
        text = user_message
        if sandbox_files:
            listing = "\n".join(f"  - {path}" for path in sandbox_files)
            text += f"\n\n[Uploaded files in sandbox:\n{listing}]"

        blocks.append({"type": "text", "text": text})
        return blocks

    # NOTE: orchestrator is not re-entrant — do not call run() concurrently
    async def run(
        self,
        user_message: str,
        attachments: tuple[Any, ...] = (),
        selected_skills: tuple[str, ...] = (),
    ) -> str:
        """Execute the agent loop and return the final text response."""
        if not user_message.strip():
            raise ValueError("user_message must not be empty")

        logger.info("turn_start user_message_length={}", len(user_message))

        await self._emitter.emit(
            EventType.TURN_START,
            {"message": user_message},
        )

        self._executor.reset_sandbox_template()
        self._registry = self._base_registry

        # Append user message to existing state (preserves conversation history)
        self._task_complete_summary = None

        # Auto-match skill for this turn via shared selector
        effective_prompt = self._system_prompt
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
            await self._install_skill_dependencies(matched.metadata.dependencies)

        uploaded_paths: tuple[str, ...] = ()
        if attachments:
            try:
                # Upload files to the sandbox AFTER skill matching so they land
                # in the correct sandbox template (e.g. data_science, not default).
                uploaded_paths = await self._upload_attachments(attachments)
            except Exception as exc:
                error = f"Failed to upload attached files to the sandbox: {exc}"
                await self._emitter.emit(
                    EventType.TASK_ERROR,
                    {"error": error},
                )
                return f"Error: {error}"

        # Build message content only after uploads are verified.
        content = self._build_message_content(
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
            effective_registry = self._registry.filter_by_names_or_tags(
                allowed,
                {"mcp"},
            )

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
            await self._emitter.emit(
                EventType.TASK_ERROR,
                {"error": self._state.error},
            )
            return f"Error: {self._state.error}"

        final_text = extract_final_text(self._state)
        await self._emitter.emit(
            EventType.TURN_COMPLETE,
            {"result": final_text},
        )
        return final_text

    async def _install_skill_dependencies(
        self,
        dependencies: tuple[str, ...],
    ) -> None:
        """Auto-install skill dependencies in the sandbox.

        Each dependency uses the format ``manager:package`` (e.g.
        ``npm:pptxgenjs``, ``pip:pandas``).  If no manager prefix is
        given, ``pip`` is assumed.
        """
        by_manager = group_safe_dependencies(dependencies)

        for manager, packages in by_manager.items():
            packages_str = " ".join(packages)
            logger.info(
                "auto_installing_skill_dependencies manager={} packages={}",
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
                        "skill_dependency_install_failed manager={} packages={} error={}",
                        manager,
                        packages_str,
                        result.stderr or result.stdout,
                    )
                else:
                    logger.info(
                        "skill_dependencies_installed manager={} packages={}",
                        manager,
                        packages_str,
                    )
            except Exception as exc:
                logger.error(
                    "skill_dependency_install_error manager={} packages={} error={}",
                    manager,
                    packages_str,
                    exc,
                )

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
            if (
                isinstance(block, dict)
                and block.get("type") == "tool_use"
                and block.get("name") == "activate_skill"
            ):
                skill_input = block.get("input", {})
                activated_name = skill_input.get("name")
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
            await self._install_skill_dependencies(skill.metadata.dependencies)

        # Filter tools by allowed_tools if specified
        if skill.metadata.allowed_tools:
            allowed = set(skill.metadata.allowed_tools) | {"activate_skill"}
            updated_registry = updated_registry.filter_by_names_or_tags(
                allowed,
                {"mcp"},
            )

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

        # Compact message history before the LLM call if needed
        if self._observer.should_compact(state.messages, effective_prompt):
            logger.debug("compacting_message_history")
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
            logger.error("llm_call_failed error={}", exc)
            return state.mark_error(f"LLM call failed: {exc}")

        logger.info(
            "llm_response stop_reason={} tool_calls={} input_tokens={} output_tokens={}",
            response.stop_reason,
            len(response.tool_calls),
            response.usage.input_tokens,
            response.usage.output_tokens,
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

        if response.thinking:
            await self._emitter.emit(
                EventType.THINKING,
                {"thinking": response.thinking},
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

        # Check if task_complete tool was invoked during tool processing
        if self._task_complete_summary is not None:
            return state.mark_completed(self._task_complete_summary)

        return state
