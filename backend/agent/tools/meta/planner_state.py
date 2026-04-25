"""Shared planner state for enforcing plan-before-spawn behavior."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


def _normalize_step_name(value: str) -> str:
    compact = re.sub(r"\s+", " ", value.strip().lower())
    return compact


@dataclass(frozen=True)
class PlannedStep:
    """Normalized planner step metadata used for runtime validation."""

    name: str
    execution_type: str


class PlannerState:
    """Track the active planner declaration for the current turn."""

    def __init__(self) -> None:
        self._steps_by_name: dict[str, PlannedStep] = {}
        self._plan_created = False
        self._agent_ids_by_spawned_step_name: dict[str, str] = {}
        self._waited_agent_ids: set[str] = set()
        self._execution_shape: str | None = None
        self._max_worker_spawns: int | None = None

    def reset(self) -> None:
        """Clear any prior plan state at the start of a new turn."""
        self._steps_by_name.clear()
        self._plan_created = False
        self._agent_ids_by_spawned_step_name.clear()
        self._waited_agent_ids.clear()
        self._execution_shape = None
        self._max_worker_spawns = None

    def configure_spawn_policy(
        self,
        *,
        execution_shape: str | None,
        max_worker_spawns: int | None,
    ) -> None:
        """Configure route-aware worker-spawn limits for the active turn."""
        self._execution_shape = execution_shape
        self._max_worker_spawns = max_worker_spawns

    def register_steps(self, steps: list[dict[str, Any]]) -> None:
        """Persist the current plan and validate duplicate step names."""
        normalized: dict[str, PlannedStep] = {}
        for raw in steps:
            name = str(raw.get("name", "")).strip()
            if not name:
                raise ValueError("plan steps must include a non-empty name")
            key = _normalize_step_name(name)
            if key in normalized:
                raise ValueError(f"Duplicate plan step name: {name}")
            normalized[key] = PlannedStep(
                name=name,
                execution_type=str(raw.get("execution_type", "parallel_worker")).strip()
                or "parallel_worker",
            )
        self._steps_by_name = normalized
        self._plan_created = True
        self._agent_ids_by_spawned_step_name.clear()
        self._waited_agent_ids.clear()

    @property
    def has_plan(self) -> bool:
        """Return whether the planner declared a plan for the active turn."""
        return self._plan_created

    @property
    def spawned_agent_count(self) -> int:
        """Return the number of worker spawns recorded for the active turn."""
        return len(self._agent_ids_by_spawned_step_name)

    @property
    def waited_agent_count(self) -> int:
        """Return the number of worker results observed via agent_wait."""
        return len(self._waited_agent_ids)

    def validate_spawn(self, step_name: str) -> str | None:
        """Return an error message when a spawn violates the active plan."""
        if not self._plan_created:
            return "Call plan_create before agent_spawn."

        normalized_name = _normalize_step_name(step_name)
        if not normalized_name:
            return "agent_spawn name must not be empty."

        planned = self._steps_by_name.get(normalized_name)
        if planned is None:
            return "agent_spawn name must match a declared plan step from plan_create."

        if planned.execution_type == "planner_owned":
            return (
                f"Plan step '{planned.name}' is planner_owned and cannot be spawned as "
                "a worker agent."
            )

        return None

    def validate_new_spawn(self) -> str | None:
        """Return an error message when creating another worker is disallowed."""
        if self._execution_shape in {"single_agent", "prompt_chain"}:
            return (
                "agent_spawn is not allowed for this execution_shape; keep the work "
                "inside the current agent."
            )
        if (
            self._max_worker_spawns is not None
            and self.spawned_agent_count >= self._max_worker_spawns
        ):
            return (
                "agent_spawn worker limit reached for this execution_shape "
                f"({self._max_worker_spawns})."
            )
        return None

    def spawned_agent_id(self, step_name: str) -> str | None:
        """Return the worker agent_id already spawned for a plan step."""
        return self._agent_ids_by_spawned_step_name.get(_normalize_step_name(step_name))

    def record_spawn(self, step_name: str, agent_id: str) -> None:
        """Record a successful worker spawn for the current plan."""
        normalized_name = _normalize_step_name(step_name)
        if normalized_name and agent_id:
            self._agent_ids_by_spawned_step_name[normalized_name] = agent_id

    def record_wait(self, agent_ids: list[str]) -> None:
        """Record worker results observed via a successful agent_wait call."""
        self._waited_agent_ids.update(agent_id for agent_id in agent_ids if agent_id)
