# Backend testing and linting

Run from the **`backend/`** directory. Dependencies are managed with **uv**.

```bash
cd backend

uv run pytest                              # All tests
uv run pytest path/to/test.py::test_fn     # Single test function (preferred for iteration)
uv run pytest --cov                        # With coverage

uv run ruff check .                        # Lint
uv run ruff format .                       # Format (88-char lines)
uv run ruff check . --fix                  # Lint with auto-fix (import order, etc.)
```

## Related

- [Makefile commands](commands.md)
- [Python style](style-python.md)
