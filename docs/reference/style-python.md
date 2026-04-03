# Python (backend) style

## Imports

Standard library first, third-party second, local last. Verify with `ruff check . --fix`.

## Formatting

`ruff format` — 88-character line limit.

## Types

Python **3.12+** with strict typing. Use **Pydantic** for API models and DTOs; use **`dataclasses(frozen=True)`** for internal agent state where immutability matters.

## Naming

- Files, functions, variables: `snake_case`
- Classes: `PascalCase`

## Errors and logging

- Use `try` / `except` where appropriate.
- In FastAPI routes, raise `HTTPException` for HTTP errors.
- Log with **loguru**: `from loguru import logger`.

## Related

- [Backend testing](backend-testing.md)
- [Patterns](patterns.md)
