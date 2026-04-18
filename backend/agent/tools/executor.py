"""Tool executor that routes calls based on execution context."""

from __future__ import annotations

from typing import Any

from loguru import logger

from agent.artifacts.manager import Artifact, ArtifactManager
from agent.tools.base import LocalTool, SandboxTool, ToolResult
from agent.tools.registry import ToolRegistry
from agent.tools.sandbox.artifact_detection import extract_artifact_paths_from_text
from api.events import EventType


class ToolExecutor:
    """Routes tool calls to the appropriate execution environment.

    Sandbox sessions are created lazily on first sandbox tool call.
    """

    def __init__(
        self,
        registry: ToolRegistry,
        sandbox_provider: Any | None = None,
        sandbox_config: Any | None = None,
        event_emitter: Any | None = None,
        artifact_manager: ArtifactManager | None = None,
        conversation_id: str | None = None,
    ) -> None:
        self._registry = registry
        self._sandbox_provider = sandbox_provider
        self._sandbox_config = sandbox_config
        self._sandbox_sessions: dict[str, Any] = {}
        self._event_emitter = event_emitter
        self._artifact_manager = artifact_manager or ArtifactManager()
        self._conversation_id = conversation_id
        self._shell_tools_this_turn = 0
        self._artifacts_by_remote_path_this_turn: dict[str, Artifact] = {}
        self._staged_skills_by_template: dict[str, set[str]] = {}
        self._active_skill_directory: str | None = None
        self._allowed_tool_names: set[str] | None = None
        self._allowed_tool_tags: set[str] | None = None

    @property
    def sandbox_provider(self) -> Any | None:
        """Sandbox provider used to create sessions (read-only)."""
        return self._sandbox_provider

    @property
    def sandbox_config(self) -> Any | None:
        """Optional explicit sandbox configuration override."""
        return self._sandbox_config

    @property
    def conversation_id(self) -> str | None:
        return self._conversation_id

    def with_registry(self, registry: ToolRegistry) -> ToolExecutor:
        """Return a new executor that shares sandbox configuration and side channels."""
        executor = ToolExecutor(
            registry=registry,
            sandbox_provider=self._sandbox_provider,
            sandbox_config=self._sandbox_config,
            event_emitter=self._event_emitter,
            artifact_manager=self._artifact_manager,
            conversation_id=self._conversation_id,
        )
        if self._allowed_tool_names is not None or self._allowed_tool_tags is not None:
            executor.set_allowed_tools(
                self._allowed_tool_names or set(),
                self._allowed_tool_tags or set(),
            )
        return executor

    def reset_turn_quotas(self) -> None:
        """Reset per-turn counters (call at the start of each user turn)."""
        self._shell_tools_this_turn = 0
        self._artifacts_by_remote_path_this_turn = {}

    def set_allowed_tools(self, names: set[str], tags: set[str]) -> None:
        """Apply a hard allowlist for the current turn."""
        self._allowed_tool_names = set(names)
        self._allowed_tool_tags = set(tags)

    def reset_allowed_tools(self) -> None:
        """Clear any hard tool allowlist for the current turn."""
        self._allowed_tool_names = None
        self._allowed_tool_tags = None

    def set_active_skill_directory(self, directory: str) -> None:
        """Set the default shell working directory for the active skill."""
        self._active_skill_directory = directory

    def reset_active_skill_directory(self) -> None:
        """Clear any active-skill working directory override."""
        self._active_skill_directory = None

    def set_sandbox_template(self, template: str) -> None:
        """Override the default sandbox template.

        Called by the orchestrator after skill matching so that tools
        and file uploads target the correct sandbox image (e.g.
        ``data_science`` instead of ``default``).
        """
        from agent.sandbox.base import SandboxConfig

        self._sandbox_config = SandboxConfig(template=template)

    def reset_sandbox_template(self) -> None:
        """Clear any per-turn sandbox template override."""
        self._sandbox_config = None

    def _resolve_template(self, tool_tags: tuple[str, ...] = ()) -> str:
        """Determine the sandbox template from config or tool tags."""
        if self._sandbox_config is not None:
            return self._sandbox_config.template
        if "browser" in tool_tags:
            return "browser"
        return "default"

    async def _get_sandbox_session(self, tool_tags: tuple[str, ...] = ()) -> Any:
        """Get or create a sandbox session for the required template.

        Sessions are keyed by template name so that browser tools get a
        Playwright-enabled sandbox even when a ``default`` sandbox was
        already created for earlier non-browser tool calls.
        """
        template = self._resolve_template(tool_tags)

        existing = self._sandbox_sessions.get(template)
        if existing is not None:
            return existing

        if self._sandbox_provider is None:
            raise RuntimeError(
                "No sandbox provider configured. "
                "Set a SandboxProvider to use sandbox tools."
            )

        from agent.sandbox.base import SandboxConfig

        if self._sandbox_config is not None:
            config = self._sandbox_config
        elif template == "browser":
            config = SandboxConfig(template="browser", memory_mb=4096, cpu_count=2)
        else:
            config = SandboxConfig(template=template)

        session = await self._sandbox_provider.create_session(config)
        self._sandbox_sessions[template] = session
        logger.info(
            "Sandbox session created (template={}, sandbox_id={})",
            template,
            getattr(session, "sandbox_id", None) or "unknown",
        )
        return session

    async def get_sandbox_session(self, tool_tags: tuple[str, ...] = ()) -> Any:
        """Public accessor for obtaining a sandbox session.

        Delegates to the internal ``_get_sandbox_session`` so that callers
        (e.g. the file-upload route) don't need to reach into private API.
        """
        return await self._get_sandbox_session(tool_tags)

    async def get_sandbox_session_for_template(self, template: str) -> Any:
        """Return a sandbox session for a specific template name."""
        from agent.sandbox.base import SandboxConfig

        if not template.strip():
            raise ValueError("template must not be empty")

        if template in self._sandbox_sessions:
            return self._sandbox_sessions[template]

        if self._sandbox_provider is None:
            raise RuntimeError(
                "No sandbox provider configured. "
                "Set a SandboxProvider to use sandbox tools."
            )

        if (
            self._sandbox_config is not None
            and self._sandbox_config.template == template
        ):
            config = self._sandbox_config
        elif template == "browser":
            config = SandboxConfig(template="browser", memory_mb=4096, cpu_count=2)
        else:
            config = SandboxConfig(template=template)

        session = await self._sandbox_provider.create_session(config)
        self._sandbox_sessions[template] = session
        logger.info(
            "Sandbox session created (template={}, sandbox_id={})",
            template,
            getattr(session, "sandbox_id", None) or "unknown",
        )
        return session

    def is_skill_staged(self, template: str, skill_name: str) -> bool:
        """Return True when *skill_name* is staged for *template*."""
        return skill_name in self._staged_skills_by_template.get(template, set())

    def mark_skill_staged(self, template: str, skill_name: str) -> None:
        """Record *skill_name* as staged for *template*."""
        self._staged_skills_by_template.setdefault(template, set()).add(skill_name)

    @property
    def artifact_manager(self) -> ArtifactManager:
        """Expose the artifact manager for API endpoint access."""
        return self._artifact_manager

    def _resolve_tool(
        self, tool_name: str
    ) -> tuple[str, LocalTool | SandboxTool | None]:
        """Resolve a tool name, falling back from skill-name misuse to activate_skill."""
        tool = self._registry.get(tool_name)
        if tool is not None:
            return tool_name, tool

        activate_skill_tool = self._registry.get("activate_skill")
        if activate_skill_tool is None:
            return tool_name, None

        from agent.tools.local.activate_skill import ActivateSkill

        if not isinstance(activate_skill_tool, ActivateSkill):
            return tool_name, None

        if activate_skill_tool._registry.find_by_name(tool_name) is None:
            return tool_name, None

        logger.info(
            "skill_name_called_as_tool requested_name={} fallback=activate_skill",
            tool_name,
        )
        return "activate_skill", activate_skill_tool

    def _is_tool_allowed(
        self,
        resolved_name: str,
        tool: LocalTool | SandboxTool,
    ) -> bool:
        if self._allowed_tool_names is None and self._allowed_tool_tags is None:
            return True
        if (
            self._allowed_tool_names is not None
            and resolved_name in self._allowed_tool_names
        ):
            return True
        tool_tags = set(tool.definition().tags or ())
        return bool(self._allowed_tool_tags and tool_tags & self._allowed_tool_tags)

    def canonical_tool_call_event_payload(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
    ) -> tuple[str, dict[str, Any]]:
        """Return canonical tool name/input for TOOL_CALL event emission."""
        resolved_name, _ = self._resolve_tool(tool_name)
        if resolved_name == "activate_skill" and tool_name != resolved_name:
            return resolved_name, {"name": tool_name}
        return resolved_name, tool_input

    async def execute(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
    ) -> ToolResult:
        """Execute a tool by name with the given input.

        Local tools are called directly.
        Sandbox tools are routed through a lazily-created sandbox session.
        After sandbox tool execution, any file artifacts referenced in
        the result metadata are extracted and ARTIFACT_CREATED events emitted.
        """
        resolved_name, tool = self._resolve_tool(tool_name)
        resolved_input = tool_input
        if resolved_name == "activate_skill" and tool_name != resolved_name:
            resolved_input = {"name": tool_name}
        elif (
            resolved_name == "shell_exec"
            and not resolved_input.get("workdir")
            and self._active_skill_directory is not None
        ):
            resolved_input = {
                **resolved_input,
                "workdir": self._active_skill_directory,
            }

        if tool is None:
            logger.warning("unknown_tool_requested name={}", tool_name)
            return ToolResult.fail(f"Unknown tool: {tool_name}")
        if not self._is_tool_allowed(resolved_name, tool):
            logger.warning(
                "tool_blocked_by_allowlist requested_name={} resolved_name={}",
                tool_name,
                resolved_name,
            )
            return ToolResult.fail(
                f"Tool '{tool_name}' is not allowed in the current skill/runtime context."
            )

        try:
            if isinstance(tool, LocalTool):
                return await tool.execute(**resolved_input)

            if isinstance(tool, SandboxTool):
                from config.settings import get_settings

                tags = tool.definition().tags
                if "shell" in tags:
                    self._shell_tools_this_turn += 1
                    cap = get_settings().MAX_SHELL_TOOLS_PER_TURN
                    if cap > 0 and self._shell_tools_this_turn > cap:
                        return ToolResult.fail(
                            "Shell tool call limit reached for this turn. "
                            "Stop invoking shell/shell_exec or batch work differently.",
                        )
                session = await self._get_sandbox_session(tags)
                logger.debug(
                    "sandbox_tool_input name={} keys={}",
                    resolved_name,
                    list(resolved_input.keys()),
                )
                result = await tool.execute(
                    session=session,
                    event_emitter=self._event_emitter,
                    conversation_id=self._conversation_id,
                    **resolved_input,
                )
                result = await self._extract_artifacts(result, session)
                return result

            return ToolResult.fail(
                f"Tool '{tool_name}' has an unrecognised type: {type(tool).__name__}",
            )
        except Exception as exc:
            logger.exception("tool_execution_failed name={}", tool_name)
            return ToolResult.fail(f"Tool '{tool_name}' failed: {exc}")

    async def _extract_artifacts(
        self,
        result: ToolResult,
        session: Any,
    ) -> ToolResult:
        """Extract file artifacts from a sandbox tool result.

        Looks for ``artifact_paths`` in the result metadata. If present,
        downloads the files via ArtifactManager and emits ARTIFACT_CREATED
        events for each. Returns a new ToolResult with ``artifact_ids``
        added to metadata so the frontend can associate files with tool calls.
        """
        if not result.success:
            return result

        metadata = dict(result.metadata or {})
        artifact_paths = metadata.get("artifact_paths")
        screenshot_path = metadata.get("screenshot")
        mentioned_paths = extract_artifact_paths_from_text(
            result.output,
            allow_prefixes=(
                (self._active_skill_directory,) if self._active_skill_directory else ()
            ),
        )

        # Collect all paths to extract
        paths_to_extract: list[str] = []
        if artifact_paths:
            paths_to_extract.extend(artifact_paths)
        for path in mentioned_paths:
            if path not in paths_to_extract:
                paths_to_extract.append(path)
        if screenshot_path and screenshot_path not in paths_to_extract:
            paths_to_extract.append(screenshot_path)

        if not paths_to_extract:
            return result

        path_list = paths_to_extract
        new_paths: list[str] = []
        for path in path_list:
            if path not in self._artifacts_by_remote_path_this_turn:
                new_paths.append(path)

        artifacts: tuple[Artifact, ...] = ()
        if new_paths:
            artifacts = await self._artifact_manager.extract_from_sandbox(
                session=session,
                remote_paths=new_paths,
            )

            if len(artifacts) < len(new_paths):
                logger.warning(
                    "Only {} of {} artifact paths were extracted",
                    len(artifacts),
                    len(new_paths),
                )

            for artifact in artifacts:
                if artifact.file_path:
                    self._artifacts_by_remote_path_this_turn.setdefault(
                        artifact.file_path,
                        artifact,
                    )

        artifact_ids: list[str] = []
        if self._event_emitter is not None:
            for artifact in artifacts:
                await self._event_emitter.emit(
                    EventType.ARTIFACT_CREATED,
                    {
                        "artifact_id": artifact.id,
                        "storage_key": artifact.path,
                        "name": artifact.original_name,
                        "content_type": artifact.content_type,
                        "size": artifact.size,
                        "file_path": artifact.file_path,
                    },
                )

        for path in path_list:
            artifact = self._artifacts_by_remote_path_this_turn.get(path)
            if artifact is None:
                continue
            if artifact.id not in artifact_ids:
                artifact_ids.append(artifact.id)

        # Return a new result with artifact_ids and content_type in metadata
        if artifact_ids:
            updated_meta = dict(metadata)
            updated_meta["artifact_ids"] = artifact_ids
            # Use the first artifact's content_type so the frontend knows
            # how to render the tool output (e.g. as an image).
            first_artifact = self._artifacts_by_remote_path_this_turn.get(path_list[0])
            if first_artifact is not None:
                updated_meta["content_type"] = first_artifact.content_type
            return ToolResult.ok(result.output, metadata=updated_meta)

        return result

    async def cleanup(self) -> None:
        """Clean up all sandbox sessions.

        Safe to call multiple times; a second call is a no-op.
        Handles the case where the session or provider is ``None``.
        """
        if not self._sandbox_sessions:
            return

        # Snapshot and clear to prevent double-cleanup.
        sessions = dict(self._sandbox_sessions)
        self._sandbox_sessions.clear()
        self._staged_skills_by_template.clear()

        if self._sandbox_provider is None:
            logger.warning("Sandbox sessions exist but no provider to destroy them")
            return

        for template, session in sessions.items():
            try:
                await self._sandbox_provider.destroy_session(session)
                logger.info("Sandbox session destroyed (template={})", template)
            except Exception as exc:
                logger.error(
                    "Failed to destroy sandbox session (template={}): {}",
                    template,
                    exc,
                )
