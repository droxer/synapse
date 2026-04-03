"""Heuristic extraction of memory facts from free text (no LLM)."""

from __future__ import annotations

from agent.memory.facts import FactCandidate


def extract_fact_candidates(text: str) -> tuple[FactCandidate, ...]:
    """Extract strict memory fact candidates from user-style text."""
    normalized = text.strip()
    if not normalized:
        return ()

    lower = normalized.lower()
    candidates: list[FactCandidate] = []

    if "timezone" in lower and " is " in lower:
        value = normalized.split(" is ", 1)[-1].strip()
        if value:
            candidates.append(
                FactCandidate(
                    namespace="profile",
                    key="profile.timezone",
                    value=value,
                    confidence=0.9,
                    evidence_snippet=normalized[:500],
                )
            )

    if "i prefer" in lower:
        value = normalized[lower.find("i prefer") + len("i prefer") :].strip()
        if value:
            candidates.append(
                FactCandidate(
                    namespace="preferences",
                    key="preferences.general",
                    value=value,
                    confidence=0.88,
                    evidence_snippet=normalized[:500],
                )
            )

    if "my language is" in lower:
        value = normalized[
            lower.find("my language is") + len("my language is") :
        ].strip()
        if value:
            candidates.append(
                FactCandidate(
                    namespace="preferences",
                    key="preferences.language",
                    value=value,
                    confidence=0.92,
                    evidence_snippet=normalized[:500],
                )
            )

    return tuple(candidates)
