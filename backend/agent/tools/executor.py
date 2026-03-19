"""Tool executor that routes calls based on execution context."""

from __future__ import annotations

from typing import Any

from loguru import logger

from agent.artifacts.manager import ArtifactManager
from agent.tools.base import LocalTool, SandboxTool, ToolResult
from agent.tools.registry import ToolRegistry
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
    ) -> None:
        self._registry = registry
        self._sandbox_provider = sandbox_provider
        self._sandbox_config = sandbox_config
        self._sandbox_sessions: dict[str, Any] = {}
        self._event_emitter = event_emitter
        self._artifact_manager = artifact_manager or ArtifactManager()

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

    async def _get_sandbox_session(
        self, tool_tags: tuple[str, ...] = ()
    ) -> Any:
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

    async def get_sandbox_session(
        self, tool_tags: tuple[str, ...] = ()
    ) -> Any:
        """Public accessor for obtaining a sandbox session.

        Delegates to the internal ``_get_sandbox_session`` so that callers
        (e.g. the file-upload route) don't need to reach into private API.
        """
        return await self._get_sandbox_session(tool_tags)

    @property
    def artifact_manager(self) -> ArtifactManager:
        """Expose the artifact manager for API endpoint access."""
        return self._artifact_manager

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
        tool = self._registry.get(tool_name)

        if tool is None:
            return ToolResult.fail(f"Unknown tool: {tool_name}")

        try:
            if isinstance(tool, LocalTool):
                return await tool.execute(**tool_input)

            if isinstance(tool, SandboxTool):
                session = await self._get_sandbox_session(tool.definition().tags)
                logger.debug(
                    "sandbox_tool_input name={} keys={}",
                    tool_name,
                    list(tool_input.keys()),
                )
                result = await tool.execute(
                    session=session,
                    event_emitter=self._event_emitter,
                    **tool_input,
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
        if not result.success or result.metadata is None:
            return result

        artifact_paths = result.metadata.get("artifact_paths")
        screenshot_path = result.metadata.get("screenshot")

        # Collect all paths to extract
        paths_to_extract: list[str] = []
        if artifact_paths:
            paths_to_extract.extend(artifact_paths)
        if screenshot_path and screenshot_path not in paths_to_extract:
            paths_to_extract.append(screenshot_path)

        if not paths_to_extract:
            return result

        path_list = paths_to_extract
        artifacts = await self._artifact_manager.extract_from_sandbox(
            session=session,
            remote_paths=path_list,
        )

        if len(artifacts) < len(path_list):
            logger.warning(
                "Only {} of {} artifact paths were extracted",
                len(artifacts),
                len(path_list),
            )

        artifact_ids: list[str] = []
        if self._event_emitter is not None:
            for artifact in artifacts:
                artifact_ids.append(artifact.id)
                await self._event_emitter.emit(
                    EventType.ARTIFACT_CREATED,
                    {
                        "artifact_id": artifact.id,
                        "storage_key": artifact.path,
                        "name": artifact.original_name,
                        "content_type": artifact.content_type,
                        "size": artifact.size,
                    },
                )

        # Return a new result with artifact_ids in metadata
        if artifact_ids:
            updated_meta = dict(result.metadata)
            updated_meta["artifact_ids"] = artifact_ids
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
