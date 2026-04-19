"""Tests for eval YAML loader."""

from __future__ import annotations

from pathlib import Path
from textwrap import dedent

import pytest

from evals.loader import LoadError, load_case, load_cases
from evals.models import EvalCase


@pytest.fixture()
def tmp_cases_dir(tmp_path: Path) -> Path:
    """Create a temporary cases directory with a valid YAML file."""
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir()
    return cases_dir


def _write_yaml(directory: Path, filename: str, content: str) -> Path:
    path = directory / filename
    path.write_text(dedent(content), encoding="utf-8")
    return path


class TestLoadCase:
    def test_load_valid_case(self, tmp_cases_dir: Path) -> None:
        path = _write_yaml(
            tmp_cases_dir,
            "basic.yaml",
            """\
            id: test_basic
            name: Basic Test
            description: A basic test case
            user_message: Hello world
            grading_mode: programmatic
            tags:
              - basic
            criteria:
              - name: has_output
                type: output_contains
                value: hello
                weight: 1.0
            """,
        )
        case = load_case(path)
        assert isinstance(case, EvalCase)
        assert case.id == "test_basic"
        assert case.name == "Basic Test"
        assert case.grading_mode == "programmatic"
        assert len(case.criteria) == 1
        assert case.criteria[0].name == "has_output"
        assert case.criteria[0].type == "output_contains"
        assert case.tags == ("basic",)
        assert case.max_iterations == 50

    def test_load_with_mock_responses(self, tmp_cases_dir: Path) -> None:
        path = _write_yaml(
            tmp_cases_dir,
            "mocked.yaml",
            """\
            id: mocked
            name: Mocked Test
            description: Test with mock responses
            user_message: Do something
            grading_mode: programmatic
            criteria:
              - name: check
                type: no_errors
            mock_responses:
              - text: "Done"
                tool_calls: []
                stop_reason: end_turn
            """,
        )
        case = load_case(path)
        assert case.mock_responses is not None
        assert len(case.mock_responses) == 1
        assert case.mock_responses[0]["text"] == "Done"

    def test_invalid_mock_responses_not_list(self, tmp_cases_dir: Path) -> None:
        path = _write_yaml(
            tmp_cases_dir,
            "bad_mock_type.yaml",
            """\
            id: mocked
            name: Mocked Test
            description: Test with invalid mock responses
            user_message: Do something
            grading_mode: programmatic
            criteria:
              - name: check
                type: no_errors
            mock_responses:
              text: "Done"
            """,
        )
        with pytest.raises(LoadError, match="'mock_responses' must be a list"):
            load_case(path)

    def test_invalid_mock_response_entry(self, tmp_cases_dir: Path) -> None:
        path = _write_yaml(
            tmp_cases_dir,
            "bad_mock_entry.yaml",
            """\
            id: mocked
            name: Mocked Test
            description: Test with invalid mock response entry
            user_message: Do something
            grading_mode: programmatic
            criteria:
              - name: check
                type: no_errors
            mock_responses:
              - "Done"
            """,
        )
        with pytest.raises(LoadError, match="mock_responses\\[0\\].*mapping"):
            load_case(path)

    def test_invalid_mock_tool_call_missing_name(self, tmp_cases_dir: Path) -> None:
        path = _write_yaml(
            tmp_cases_dir,
            "bad_tool_name.yaml",
            """\
            id: mocked
            name: Mocked Test
            description: Test with invalid tool call
            user_message: Do something
            grading_mode: programmatic
            criteria:
              - name: check
                type: no_errors
            mock_responses:
              - tool_calls:
                  - input:
                      query: "hello"
            """,
        )
        with pytest.raises(LoadError, match="tool_calls\\[0\\]\\.name"):
            load_case(path)

    def test_invalid_mock_tool_input_shape(self, tmp_cases_dir: Path) -> None:
        path = _write_yaml(
            tmp_cases_dir,
            "bad_tool_input.yaml",
            """\
            id: mocked
            name: Mocked Test
            description: Test with invalid tool input
            user_message: Do something
            grading_mode: programmatic
            criteria:
              - name: check
                type: no_errors
            mock_responses:
              - tool_calls:
                  - name: web_search
                    input: "query=test"
            """,
        )
        with pytest.raises(LoadError, match="tool_calls\\[0\\]\\.input"):
            load_case(path)

    def test_invalid_mock_usage_token_type(self, tmp_cases_dir: Path) -> None:
        path = _write_yaml(
            tmp_cases_dir,
            "bad_usage.yaml",
            """\
            id: mocked
            name: Mocked Test
            description: Test with invalid usage
            user_message: Do something
            grading_mode: programmatic
            criteria:
              - name: check
                type: no_errors
            mock_responses:
              - usage:
                  input_tokens: "100"
            """,
        )
        with pytest.raises(LoadError, match="usage\\.input_tokens"):
            load_case(path)

    def test_missing_required_field(self, tmp_cases_dir: Path) -> None:
        path = _write_yaml(
            tmp_cases_dir,
            "bad.yaml",
            """\
            id: bad
            name: Bad Case
            """,
        )
        with pytest.raises(LoadError, match="Missing required field"):
            load_case(path)

    def test_invalid_grading_mode(self, tmp_cases_dir: Path) -> None:
        path = _write_yaml(
            tmp_cases_dir,
            "bad_mode.yaml",
            """\
            id: bad_mode
            name: Bad Mode
            description: desc
            user_message: msg
            grading_mode: invalid
            criteria:
              - name: c
                type: no_errors
            """,
        )
        with pytest.raises(LoadError, match="Invalid grading_mode"):
            load_case(path)

    def test_invalid_criteria_type(self, tmp_cases_dir: Path) -> None:
        path = _write_yaml(
            tmp_cases_dir,
            "bad_criteria.yaml",
            """\
            id: bad_criteria
            name: Bad Criteria
            description: desc
            user_message: msg
            grading_mode: programmatic
            criteria:
              - name: c
                type: nonexistent_type
            """,
        )
        with pytest.raises(LoadError, match="Invalid criterion type"):
            load_case(path)

    def test_empty_criteria_list(self, tmp_cases_dir: Path) -> None:
        path = _write_yaml(
            tmp_cases_dir,
            "empty_criteria.yaml",
            """\
            id: empty
            name: Empty
            description: desc
            user_message: msg
            grading_mode: programmatic
            criteria: []
            """,
        )
        with pytest.raises(LoadError, match="non-empty list"):
            load_case(path)


class TestLoadCases:
    def test_load_all_cases(self, tmp_cases_dir: Path) -> None:
        for i in range(3):
            _write_yaml(
                tmp_cases_dir,
                f"case_{i}.yaml",
                f"""\
                id: case_{i}
                name: Case {i}
                description: desc
                user_message: msg
                grading_mode: programmatic
                criteria:
                  - name: c
                    type: no_errors
                """,
            )
        cases = load_cases(tmp_cases_dir)
        assert len(cases) == 3

    def test_filter_by_case_id(self, tmp_cases_dir: Path) -> None:
        for i in range(3):
            _write_yaml(
                tmp_cases_dir,
                f"case_{i}.yaml",
                f"""\
                id: case_{i}
                name: Case {i}
                description: desc
                user_message: msg
                grading_mode: programmatic
                criteria:
                  - name: c
                    type: no_errors
                """,
            )
        cases = load_cases(tmp_cases_dir, case_id="case_1")
        assert len(cases) == 1
        assert cases[0].id == "case_1"

    def test_filter_by_tags(self, tmp_cases_dir: Path) -> None:
        _write_yaml(
            tmp_cases_dir,
            "tagged.yaml",
            """\
            id: tagged
            name: Tagged
            description: desc
            user_message: msg
            grading_mode: programmatic
            tags:
              - search
            criteria:
              - name: c
                type: no_errors
            """,
        )
        _write_yaml(
            tmp_cases_dir,
            "untagged.yaml",
            """\
            id: untagged
            name: Untagged
            description: desc
            user_message: msg
            grading_mode: programmatic
            criteria:
              - name: c
                type: no_errors
            """,
        )
        cases = load_cases(tmp_cases_dir, tags=("search",))
        assert len(cases) == 1
        assert cases[0].id == "tagged"

    def test_missing_directory(self) -> None:
        with pytest.raises(FileNotFoundError):
            load_cases(Path("/nonexistent/dir"))

    def test_empty_directory(self, tmp_cases_dir: Path) -> None:
        with pytest.raises(LoadError, match="No YAML files"):
            load_cases(tmp_cases_dir)
