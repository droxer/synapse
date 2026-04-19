# Evals

Detailed notes for the agent evaluation harness under `backend/evals/`.

For the short operator-facing command reference, see
[`reference/agent-evals.md`](reference/agent-evals.md).

## Purpose

The eval harness runs scripted or live agent scenarios and grades them with:

- programmatic criteria
- an LLM judge
- or both together

It is meant to answer two questions:

1. Did the agent perform the expected actions?
2. Did the final output satisfy the task?

## Layout

| Path | Purpose |
| --- | --- |
| `cases/` | YAML eval case definitions |
| `loader.py` | Parses and validates YAML cases |
| `runner.py` | Runs cases through the orchestrator and grades results |
| `collector.py` | Subscribes to runtime events and builds `EvalMetrics` |
| `grader.py` | Programmatic grading logic |
| `llm_judge.py` | LLM-as-judge prompt and response parsing |
| `mock_client.py` | Scripted mock LLM client and mock tool executor |
| `models.py` | Eval dataclasses and result types |
| `reporter.py` | Console and JSON report formatting |
| `__main__.py` | CLI entrypoint for `python -m evals` |

## Running

From the repository root:

```bash
make evals
make evals EVAL_ARGS="--case web_search_basic"
make evals EVAL_ARGS="--tags agent"
make evals EVAL_ARGS="--backend live"
make evals EVAL_ARGS="--output report.json"
```

Direct module usage from `backend/`:

```bash
uv run --project . --group dev python -m evals --backend mock
```

## Eval Case Shape

Each YAML case defines:

- `id`: stable case id
- `name`: human-readable label
- `description`: what the case is testing
- `user_message`: prompt passed into the orchestrator
- `grading_mode`: `programmatic`, `llm_judge`, or `both`
- `criteria`: one or more grading criteria

Optional fields:

- `tags`: filterable labels
- `max_iterations`: per-case loop limit
- `token_budget`: custom compaction threshold for the observer
- `expected_output_hint`: hint supplied to the LLM judge
- `llm_judge_prompt`: extra judge instructions
- `mock_responses`: scripted responses for deterministic mock runs

## Grading Modes

### `programmatic`

Only criteria from `grader.py` are used.

### `llm_judge`

Only the LLM judge result is used.

### `both`

Both grading branches run.

- The reported score is the average of the programmatic score and the judge score.
- A case passes only if:
  - the programmatic branch meets the normal threshold, and
  - the judge returns `passed=true`

If no live judge client is available, the judge criterion is recorded as skipped/failing and the case cannot pass.

## Programmatic Criteria

Supported criterion types:

- `tool_used`
- `tool_not_used`
- `output_regex`
- `output_contains`
- `max_iterations`
- `no_errors`
- `skill_activated`
- `agent_spawned`
- `agent_handoff`
- `tool_call_count`
- `context_compacted`
- `tool_not_repeated`
- `execution_shape`

Use the richer event-driven criteria when available. For example:

- prefer `skill_activated` over checking `activate_skill` as a raw tool call
- prefer `agent_spawned` over checking `agent_spawn`
- prefer `agent_handoff` over checking `agent_handoff` as a tool call

## Mock Responses

`mock_responses` are strict on purpose. Invalid shapes should fail during load, not later at runtime.

Each entry may include:

- `text: str`
- `tool_calls: list`
- `stop_reason: str`
- `thinking: str`
- `usage: {input_tokens, output_tokens}`

Each tool call may include:

- `name: str` (required)
- `id: str`
- `input: dict`

## Mock Event Behavior

The mock path is not just a canned text transcript. It also emits synthetic runtime events so event-based criteria can be graded in mock mode.

Special mock tool behavior:

- `activate_skill` emits `SKILL_ACTIVATED`
- `agent_spawn` emits `AGENT_SPAWN`
- `agent_handoff` emits `AGENT_HANDOFF`

This keeps mock evals deterministic while still testing the collector and event-based grading paths.

## Adding a Case

Recommended workflow:

1. Pick the smallest scenario that proves the behavior.
2. Prefer programmatic criteria for deterministic checks.
3. Use `both` only when judge quality actually matters.
4. Keep mock transcripts short and intentional.
5. Use event-based criteria instead of raw tool-call checks when the harness already captures the richer signal.
6. Add or update tests if you extend the schema or grading behavior.

## Testing Changes

Useful targeted commands:

```bash
uv run --project backend --group dev python -m pytest backend/tests/test_eval_loader.py -q
uv run --project backend --group dev python -m pytest backend/tests/test_eval_runner.py -q
uv run --project backend --group dev python -m pytest backend/tests/test_eval_grader.py -q
uv run --project backend --group dev ruff check backend/evals backend/tests/test_eval_loader.py backend/tests/test_eval_runner.py
```

When changing the harness, run both:

- focused unit tests
- a mock end-to-end `python -m evals --backend mock` run

## Notes

- `collector.py` is the source of truth for what runtime signals the eval system can grade.
- `mock_client.py` should stay deterministic and side-effect free.
- If you add a new criterion type, update both `loader.py` validation and `grader.py`.
