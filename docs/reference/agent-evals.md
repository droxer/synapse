# Agent evaluations

Run from the **project root** via `make evals`. The harness lives under `backend/evals/` (YAML cases, `llm_judge.py`, `grader.py`).

```bash
make evals                                              # Mock backend
make evals EVAL_ARGS="--backend live"                   # Real Claude API
make evals EVAL_ARGS="--case web_search_basic"          # Single case by id
make evals EVAL_ARGS="--tags agent"                     # Filter by tags
make evals EVAL_ARGS="--output report.json"             # JSON report
```

Combine flags as needed inside `EVAL_ARGS`.

## Related

- [Detailed eval guide](../evals.md)
- [Backend layout](backend-layout.md) (`evals/` package)
- [Architecture overview](architecture-overview.md)
