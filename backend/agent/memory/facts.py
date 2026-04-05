"""Fact extraction candidate validation for long-term memory."""

from __future__ import annotations

import re
from dataclasses import dataclass

_ALLOWED_NAMESPACES = {"profile", "preferences", "constraints", "decisions"}
_SENSITIVE_PATTERNS = (
    re.compile(r"api[_-]?key", re.IGNORECASE),
    re.compile(r"password", re.IGNORECASE),
    re.compile(r"secret", re.IGNORECASE),
    re.compile(r"token", re.IGNORECASE),
)
_EPHEMERAL_PATTERNS = (
    re.compile(r"\btoday\b", re.IGNORECASE),
    re.compile(r"\bright now\b", re.IGNORECASE),
    re.compile(r"\bcurrently\b", re.IGNORECASE),
    re.compile(r"\blol\b", re.IGNORECASE),
)


@dataclass(frozen=True)
class FactCandidate:
    namespace: str
    key: str
    value: str
    confidence: float
    evidence_snippet: str | None = None


@dataclass(frozen=True)
class ValidationResult:
    accepted: bool
    reason: str


def normalize_fact_key(namespace: str, key: str) -> str:
    normalized = key.strip().lower().replace(" ", "_")
    if normalized.startswith(f"{namespace}."):
        return normalized
    return f"{namespace}.{normalized}"


def validate_fact_candidate(
    candidate: FactCandidate,
    threshold: float = 0.85,
) -> ValidationResult:
    namespace = candidate.namespace.strip().lower()
    key = candidate.key.strip()
    value = candidate.value.strip()

    if namespace not in _ALLOWED_NAMESPACES:
        return ValidationResult(accepted=False, reason="invalid_namespace")
    if not key or not value:
        return ValidationResult(accepted=False, reason="empty_key_or_value")
    if candidate.confidence < threshold:
        return ValidationResult(accepted=False, reason="low_confidence")
    if any(pattern.search(key) for pattern in _SENSITIVE_PATTERNS):
        return ValidationResult(accepted=False, reason="sensitive")
    if any(pattern.search(value) for pattern in _SENSITIVE_PATTERNS):
        return ValidationResult(accepted=False, reason="sensitive")
    if any(pattern.search(value) for pattern in _EPHEMERAL_PATTERNS):
        return ValidationResult(accepted=False, reason="ephemeral")

    return ValidationResult(accepted=True, reason="accepted")
