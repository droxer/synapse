"""Tavily-powered web search tool."""

from __future__ import annotations

import json
from typing import Any

from loguru import logger
from tavily import TavilyClient

from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)


class TavilyWebSearch(LocalTool):
    """Search the web using the Tavily API."""

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError("Tavily API key must not be empty")
        self._client = TavilyClient(api_key=api_key)

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="web_search",
            description="Search the web for information using a text query.",
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
                },
                "required": ["query"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("search", "web"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        query: str = kwargs.get("query", "")
        max_results: int = kwargs.get("max_results", 5)

        if not query.strip():
            return ToolResult.fail("Query must not be empty")

        try:
            response = self._client.search(query, max_results=max_results)
        except Exception as exc:
            logger.warning("web_search_failed error={}", exc)
            return ToolResult.fail(f"Web search failed: {exc}")

        results = [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("content", ""),
            }
            for r in response.get("results", [])
        ]
        payload = json.dumps({"query": query, "results": results}, ensure_ascii=False)
        return ToolResult.ok(payload, metadata={"result_count": len(results)})
