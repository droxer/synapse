"""Shared prompt assembly helpers for agent runtimes."""

from __future__ import annotations

from dataclasses import replace
from dataclasses import dataclass

from agent.llm.client import (
    PromptCacheControl,
    PromptTextBlock,
    SystemPrompt,
    build_system_prompt_blocks,
    render_system_prompt,
)


def normalize_system_prompt(system: SystemPrompt) -> tuple[PromptTextBlock, ...]:
    """Normalize a system prompt into explicit text blocks."""
    if isinstance(system, str):
        return build_system_prompt_blocks(system)
    return tuple(block for block in system if block.text)


@dataclass(frozen=True)
class PromptAssembly:
    """Structured prompt with explicit stable and volatile sections."""

    stable_sections: tuple[PromptTextBlock, ...]
    volatile_sections: tuple[PromptTextBlock, ...] = ()

    @property
    def system(self) -> tuple[PromptTextBlock, ...]:
        """Return the provider-ready system prompt blocks."""
        return (*self.stable_sections, *self.volatile_sections)

    @property
    def rendered(self) -> str:
        """Return the flattened system prompt for logs and compaction."""
        return render_system_prompt(self.system)

    def system_with_cache_control(self, enabled: bool) -> tuple[PromptTextBlock, ...]:
        """Return system blocks with a cache breakpoint on the stable prefix."""
        if not enabled or not self.stable_sections:
            return self.system
        stable = list(self.stable_sections)
        stable[-1] = replace(
            stable[-1],
            cache_control=PromptCacheControl(type="ephemeral"),
        )
        return (*stable, *self.volatile_sections)

    @classmethod
    def from_system(cls, system: SystemPrompt) -> PromptAssembly:
        """Create an assembly using *system* as the stable prompt prefix."""
        return cls(stable_sections=normalize_system_prompt(system))

    def with_volatile_sections(
        self,
        *sections: str | PromptTextBlock,
    ) -> PromptAssembly:
        """Return a copy with additional volatile sections appended."""
        return PromptAssembly(
            stable_sections=self.stable_sections,
            volatile_sections=(
                *self.volatile_sections,
                *build_system_prompt_blocks(*sections),
            ),
        )
