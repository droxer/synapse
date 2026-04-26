"""Exa-powered web search tool.

Exa offers neural, keyword-free semantic search with content retrieval
(text, highlights, summaries) and rich filtering (category, domains,
date ranges, text inclusion/exclusion, user location).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from loguru import logger

from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)

_INTEGRATION_HEADER = "synapse"

_ALLOWED_SEARCH_TYPES = (
    "auto",
    "neural",
    "fast",
    "deep-lite",
    "deep",
    "deep-reasoning",
    "instant",
)

_ALLOWED_CATEGORIES = (
    "company",
    "research paper",
    "news",
    "personal site",
    "financial report",
    "people",
)

_ALLOWED_CONTENT_MODES = ("highlights", "text", "summary")


@dataclass(frozen=True)
class ExaSearchResult:
    """Typed view of a single Exa search result."""

    title: str
    url: str
    content: str
    score: float | None = None
    published_date: str | None = None
    author: str | None = None
    highlights: tuple[str, ...] = ()
    summary: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "title": self.title,
            "url": self.url,
            "content": self.content,
        }
        if self.score is not None:
            payload["score"] = self.score
        if self.published_date:
            payload["published_date"] = self.published_date
        if self.author:
            payload["author"] = self.author
        if self.highlights:
            payload["highlights"] = list(self.highlights)
        if self.summary:
            payload["summary"] = self.summary
        return payload


def _build_contents(content_mode: str) -> dict[str, Any]:
    """Build the Exa contents payload for the requested content mode."""
    if content_mode == "highlights":
        return {"highlights": {"num_sentences": 3, "highlights_per_url": 3}}
    if content_mode == "text":
        return {"text": {"max_characters": 2000}}
    if content_mode == "summary":
        return {"summary": True}
    raise ValueError(
        f"Unsupported content_mode={content_mode!r}. "
        f"Expected one of {_ALLOWED_CONTENT_MODES}."
    )


def _extract_content(
    item: Any, highlights: tuple[str, ...], summary: str | None
) -> str:
    """Pick the best available snippet from an Exa result, with graceful fallback."""
    if highlights:
        return " ... ".join(h for h in highlights if h).strip()
    if summary:
        return summary.strip()
    text = getattr(item, "text", None)
    if text:
        return str(text).strip()
    return ""


def _parse_result(item: Any) -> ExaSearchResult:
    """Convert an SDK result object into a typed ExaSearchResult."""
    raw_highlights = getattr(item, "highlights", None) or ()
    highlights = tuple(str(h) for h in raw_highlights if h)
    summary = getattr(item, "summary", None)
    summary_str = str(summary).strip() if summary else None
    return ExaSearchResult(
        title=str(getattr(item, "title", "") or ""),
        url=str(getattr(item, "url", "") or ""),
        content=_extract_content(item, highlights, summary_str),
        score=getattr(item, "score", None),
        published_date=getattr(item, "published_date", None),
        author=getattr(item, "author", None),
        highlights=highlights,
        summary=summary_str,
    )


class ExaWebSearch(LocalTool):
    """Search the web using the Exa AI-powered search API."""

    def __init__(self, api_key: str, *, tool_name: str = "exa_search") -> None:
        if not api_key:
            raise ValueError("Exa API key must not be empty")
        # Import locally so the dependency is only required when the tool is enabled.
        from exa_py import Exa

        client = Exa(api_key=api_key)
        # Track API usage attributable to this integration.
        try:
            client.headers["x-exa-integration"] = _INTEGRATION_HEADER
        except Exception:  # pragma: no cover - defensive, older SDKs
            logger.debug("exa_integration_header_not_set")
        self._client = client
        self._tool_name = tool_name

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name=self._tool_name,
            description=(
                "Search the web with Exa, an AI-powered neural search engine. "
                "Supports semantic search, category filtering (company, research paper, "
                "news, etc.), domain and text filters, date ranges, and content retrieval "
                "modes (highlights, text, summary)."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query.",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results to return.",
                        "default": 5,
                    },
                    "search_type": {
                        "type": "string",
                        "description": (
                            "Exa search strategy. 'auto' (default) blends neural and "
                            "keyword matching; 'neural' forces embeddings-based search; "
                            "'fast' uses streamlined models."
                        ),
                        "enum": list(_ALLOWED_SEARCH_TYPES),
                        "default": "auto",
                    },
                    "content_mode": {
                        "type": "string",
                        "description": (
                            "What page content to retrieve: 'highlights' (most relevant "
                            "snippets), 'text' (truncated page text), or 'summary' "
                            "(LLM-generated summary)."
                        ),
                        "enum": list(_ALLOWED_CONTENT_MODES),
                        "default": "highlights",
                    },
                    "category": {
                        "type": "string",
                        "description": "Focus search on a specific category of sources.",
                        "enum": list(_ALLOWED_CATEGORIES),
                    },
                    "include_domains": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Only return results from these domains.",
                    },
                    "exclude_domains": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Skip results from these domains.",
                    },
                    "include_text": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Require each result page to contain these phrases "
                            "(Exa accepts a single phrase up to 5 words)."
                        ),
                    },
                    "exclude_text": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Exclude result pages that contain these phrases "
                            "(Exa accepts a single phrase up to 5 words)."
                        ),
                    },
                    "start_published_date": {
                        "type": "string",
                        "description": "Only include results published on or after this ISO 8601 date.",
                    },
                    "end_published_date": {
                        "type": "string",
                        "description": "Only include results published on or before this ISO 8601 date.",
                    },
                    "user_location": {
                        "type": "string",
                        "description": "Two-letter ISO country code to bias results (e.g. 'US').",
                    },
                },
                "required": ["query"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("search", "web", "exa"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        query: str = kwargs.get("query", "")
        if not query.strip():
            return ToolResult.fail("Query must not be empty")

        max_results: int = int(kwargs.get("max_results", 5))
        search_type: str = kwargs.get("search_type") or "auto"
        content_mode: str = kwargs.get("content_mode") or "highlights"

        if search_type not in _ALLOWED_SEARCH_TYPES:
            return ToolResult.fail(
                f"Invalid search_type={search_type!r}. "
                f"Expected one of {_ALLOWED_SEARCH_TYPES}."
            )
        if content_mode not in _ALLOWED_CONTENT_MODES:
            return ToolResult.fail(
                f"Invalid content_mode={content_mode!r}. "
                f"Expected one of {_ALLOWED_CONTENT_MODES}."
            )

        params: dict[str, Any] = {
            "query": query,
            "num_results": max_results,
            "type": search_type,
            **_build_contents(content_mode),
        }

        category = kwargs.get("category")
        if category:
            if category not in _ALLOWED_CATEGORIES:
                return ToolResult.fail(
                    f"Invalid category={category!r}. "
                    f"Expected one of {_ALLOWED_CATEGORIES}."
                )
            params["category"] = category

        for key in (
            "include_domains",
            "exclude_domains",
            "include_text",
            "exclude_text",
        ):
            value = kwargs.get(key)
            if value:
                params[key] = list(value)

        for key in ("start_published_date", "end_published_date", "user_location"):
            value = kwargs.get(key)
            if value:
                params[key] = value

        try:
            import asyncio

            response = await asyncio.to_thread(
                self._client.search_and_contents, **params
            )
        except Exception as exc:
            logger.warning("exa_search_failed error={}", exc)
            return ToolResult.fail(f"Exa search failed: {exc}")

        items = [_parse_result(item) for item in getattr(response, "results", [])]
        payload = json.dumps(
            {"query": query, "results": [item.to_dict() for item in items]},
            ensure_ascii=False,
        )
        return ToolResult.ok(payload, metadata={"result_count": len(items)})
