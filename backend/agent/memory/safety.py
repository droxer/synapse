"""Safety checks for user-controlled long-term memory text."""

from __future__ import annotations

import re
from dataclasses import dataclass

_INVISIBLE_PATTERN = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]")
_XML_LIKE_TAG_PATTERN = re.compile(r"<[^>\n]{1,120}>")
_PROMPT_INJECTION_PATTERNS = (
    re.compile(
        r"\b(ignore|disregard|override|forget)\s+"
        r"(all\s+)?(previous|prior|above|earlier)\s+"
        r"(instructions?|messages?|prompts?)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(reveal|show|print|dump|leak|exfiltrate)\s+"
        r"(the\s+)?(system|developer)\s+"
        r"(prompt|message|instructions?)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(system|developer)\s+(prompt|message|instructions?)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bdo\s+not\s+(follow|obey)\s+"
        r"(the\s+)?(system|developer|previous)\s+"
        r"(instructions?|messages?)\b",
        re.IGNORECASE,
    ),
)
_SECRET_PATTERNS = (
    re.compile(r"\bapi[_-]?key\b", re.IGNORECASE),
    re.compile(r"\bpassword\b", re.IGNORECASE),
    re.compile(r"\bsecret\b", re.IGNORECASE),
    re.compile(r"\btoken\b", re.IGNORECASE),
    re.compile(r"\bbearer\s+[A-Za-z0-9._~+/=-]{12,}\b", re.IGNORECASE),
    re.compile(r"\bsk-[A-Za-z0-9]{16,}\b"),
    re.compile(r"\bghp_[A-Za-z0-9_]{16,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{16,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
)


@dataclass(frozen=True)
class MemorySafetyResult:
    accepted: bool
    reason: str


def validate_memory_text(value: str, *, field: str = "value") -> MemorySafetyResult:
    """Reject text that is unsafe to persist or inject into prompts."""
    text = value.strip()
    if not text:
        return MemorySafetyResult(accepted=False, reason=f"empty_{field}")
    if _INVISIBLE_PATTERN.search(text):
        return MemorySafetyResult(accepted=False, reason="invisible_unicode")
    if _XML_LIKE_TAG_PATTERN.search(text):
        return MemorySafetyResult(accepted=False, reason="xml_like_tag")
    if any(pattern.search(text) for pattern in _SECRET_PATTERNS):
        return MemorySafetyResult(accepted=False, reason="sensitive")
    if any(pattern.search(text) for pattern in _PROMPT_INJECTION_PATTERNS):
        return MemorySafetyResult(accepted=False, reason="prompt_injection")
    return MemorySafetyResult(accepted=True, reason="accepted")


def ensure_memory_text_safe(value: str, *, field: str = "value") -> str:
    """Return stripped text or raise a ValueError with the rejection reason."""
    text = value.strip()
    verdict = validate_memory_text(text, field=field)
    if not verdict.accepted:
        raise ValueError(f"Unsafe memory {field}: {verdict.reason}")
    return text
