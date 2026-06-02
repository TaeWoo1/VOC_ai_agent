"""Tests for `scripts/evaluate_phase2e_classification.py`.

Exercises:
  - JSONL row schema validation (every required field; enum values)
  - dataset loader (malformed JSON; comments; empty file)
  - per-class metrics on synthetic pair lists
  - confusion matrix shape + bucket coverage
  - guardrail catch rate counts caught / missed correctly
  - seller-surface risk classification matches the documented codes
  - end-to-end runner produces JSON + Markdown with the documented schema
  - the shipped seed dataset itself validates
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
EVALUATOR = REPO / "scripts" / "evaluate_phase2e_classification.py"
SHIPPED_SEED = REPO / "eval_data" / "phase2e" / "polarity_eval.jsonl"


@pytest.fixture(scope="module")
def evaluator():
    sys.path.insert(0, str(REPO))
    spec = importlib.util.spec_from_file_location(
        "evaluate_phase2e", EVALUATOR,
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------


def _row(**overrides):
    """Synthetic minimal-valid row; pass overrides to mutate fields."""
    base = {
        "id": "x_001",
        "source_run_id": "run-test",
        "goodsNo": "A000000123456",
        "product_name": "테스트",
        "review_id": "abcd1234",
        "attribute": "value_price",
        "text": "가성비 좋아요 만족합니다",
        "current_polarity": "positive",
        "gold_polarity": "positive",
        "error_type": "acceptable_current_label",
        "confidence": "high",
        "note": "synthetic test row",
    }
    base.update(overrides)
    return base


class TestSchemaValidation:
    def test_valid_row_passes(self, evaluator):
        evaluator.validate_dataset([_row()])  # no exception

    def test_empty_dataset_rejected(self, evaluator):
        with pytest.raises(evaluator.DatasetValidationError, match="empty"):
            evaluator.validate_dataset([])

    def test_missing_required_field(self, evaluator):
        bad = _row()
        del bad["text"]
        with pytest.raises(evaluator.DatasetValidationError, match="missing fields"):
            evaluator.validate_dataset([bad])

    def test_invalid_polarity_value(self, evaluator):
        bad = _row(current_polarity="weakly_positive")
        with pytest.raises(evaluator.DatasetValidationError, match="current_polarity"):
            evaluator.validate_dataset([bad])

    def test_invalid_error_type(self, evaluator):
        bad = _row(error_type="banana")
        with pytest.raises(evaluator.DatasetValidationError, match="error_type"):
            evaluator.validate_dataset([bad])

    def test_invalid_confidence(self, evaluator):
        bad = _row(confidence="very_high")
        with pytest.raises(evaluator.DatasetValidationError, match="confidence"):
            evaluator.validate_dataset([bad])

    def test_non_dict_row_rejected(self, evaluator):
        with pytest.raises(evaluator.DatasetValidationError, match="not a JSON object"):
            evaluator.validate_dataset(["not a row"])  # type: ignore[list-item]

    def test_shipped_seed_validates(self, evaluator):
        """The dataset shipped with the repo must pass its own
        schema check — protects against drift between the JSONL
        and the evaluator's contract."""
        rows = evaluator.load_dataset(SHIPPED_SEED)
        assert len(rows) >= 30  # we shipped 42; floor at 30


# ---------------------------------------------------------------------------
# Loader behavior
# ---------------------------------------------------------------------------


class TestLoader:
    def test_skips_blank_and_comment_lines(self, evaluator, tmp_path: Path):
        path = tmp_path / "x.jsonl"
        path.write_text(
            "\n"  # blank
            "# a comment\n"
            + json.dumps(_row()) + "\n"
            "   \n"  # whitespace
            + json.dumps(_row(id="x_002")) + "\n",
            encoding="utf-8",
        )
        rows = evaluator.load_dataset(path)
        assert len(rows) == 2

    def test_malformed_json_raises_with_line_number(
        self, evaluator, tmp_path: Path,
    ):
        path = tmp_path / "x.jsonl"
        path.write_text(
            json.dumps(_row()) + "\n"
            + "{not valid json\n",
            encoding="utf-8",
        )
        with pytest.raises(evaluator.DatasetValidationError, match="line 2"):
            evaluator.load_dataset(path)


# ---------------------------------------------------------------------------
# Per-class metrics on synthetic pairs.
# ---------------------------------------------------------------------------


class TestPerClassMetrics:
    def test_perfect_predictions(self, evaluator):
        pairs = [("positive", "positive"), ("negative", "negative")]
        out = evaluator.compute_per_class_metrics(
            pairs, labels=["positive", "negative"],
        )
        assert out["positive"]["precision"] == 1.0
        assert out["positive"]["recall"] == 1.0
        assert out["positive"]["f1"] == 1.0

    def test_partial_predictions(self, evaluator):
        # 2 gold positives, 1 predicted positive (1 TP, 1 FN). 0 FPs.
        pairs = [
            ("positive", "positive"),
            ("positive", "negative"),
            ("negative", "negative"),
        ]
        out = evaluator.compute_per_class_metrics(
            pairs, labels=["positive", "negative"],
        )
        assert out["positive"]["tp"] == 1
        assert out["positive"]["fn"] == 1
        assert out["positive"]["precision"] == 1.0
        assert out["positive"]["recall"] == 0.5
        # F1 = 2 * (1.0 * 0.5) / (1.0 + 0.5) = 0.6667
        assert out["positive"]["f1"] == pytest.approx(0.6667, rel=1e-3)

    def test_zero_division_guarded(self, evaluator):
        # No predictions at all for class 'mixed' → precision/recall 0,
        # not divide-by-zero.
        pairs = [("positive", "positive")]
        out = evaluator.compute_per_class_metrics(
            pairs, labels=["positive", "mixed"],
        )
        assert out["mixed"]["precision"] == 0.0
        assert out["mixed"]["recall"] == 0.0
        assert out["mixed"]["f1"] == 0.0


# ---------------------------------------------------------------------------
# Confusion matrix
# ---------------------------------------------------------------------------


class TestConfusionMatrix:
    def test_matrix_shape_carries_all_buckets(self, evaluator):
        pairs = [("positive", "negative_weak"), ("positive", "positive")]
        cm = evaluator.compute_confusion_matrix(
            pairs, labels=evaluator.FINE_BUCKETS,
        )
        # Every fine bucket must appear on both axes.
        for g in evaluator.FINE_BUCKETS:
            assert g in cm
            for p in evaluator.FINE_BUCKETS:
                assert p in cm[g]

    def test_matrix_counts_correct(self, evaluator):
        pairs = [
            ("positive", "negative_weak"),
            ("positive", "negative_weak"),
            ("positive", "positive"),
            ("negative_weak", "negative_weak"),
        ]
        cm = evaluator.compute_confusion_matrix(
            pairs, labels=evaluator.FINE_BUCKETS,
        )
        assert cm["positive"]["negative_weak"] == 2
        assert cm["positive"]["positive"] == 1
        assert cm["negative_weak"]["negative_weak"] == 1
        assert cm["negative_weak"]["positive"] == 0


# ---------------------------------------------------------------------------
# Guardrail catch rate
# ---------------------------------------------------------------------------


class TestGuardrailCatchRate:
    def test_no_polarity_errors_yields_none_rate(self, evaluator):
        rows = [_row(error_type="acceptable_current_label")]
        out = evaluator.compute_guardrail_catch_rate(rows)
        assert out["n_polarity_errors"] == 0
        assert out["catch_rate"] is None

    def test_known_run010_false_negatives_caught(self, evaluator):
        """The 4 run-010 false negatives we built the guardrail for
        must all be flagged. This is a regression gate on the
        guardrail's catch-rate."""
        rows = [
            _row(
                id="r1",
                text=":) 좀 써보니까 패드가 부드럽게 밀착되면서 피부 컨디션을 쫀쫀하게 잡아주",
                current_polarity="negative_weak",
                gold_polarity="positive",
                error_type="positive_as_negative",
            ),
            _row(
                id="r2",
                text="엄청 잘 떼져요 ㅎㅎ 얇고 쫀쫀해서 밀착도 잘되고 촉촉하네요 탄력도 조금 좋",
                current_polarity="negative_weak",
                gold_polarity="positive",
                error_type="positive_as_negative",
            ),
            _row(
                id="r3",
                text="마데카소사이드 성분 때문인지 사용하고 나면 피부가 촉촉하면서도 붉은기가 살짝 진정되는 느낌이 있습니다",
                current_polarity="negative_weak",
                gold_polarity="positive",
                error_type="positive_as_negative",
            ),
            _row(
                id="r4",
                text="이 만족스러웠어요. 꾸준히 사용하니 모공 주변 피부가 조금 더 탄탄해진 느낌",
                current_polarity="negative_weak",
                gold_polarity="positive",
                error_type="positive_as_negative",
            ),
        ]
        out = evaluator.compute_guardrail_catch_rate(rows)
        assert out["n_polarity_errors"] == 4
        assert out["n_caught"] == 4
        assert out["catch_rate"] == 1.0

    def test_acceptable_label_rows_excluded_from_catch_rate(self, evaluator):
        """Rows where current=gold are not polarity errors; the
        guardrail's catch rate is computed only over the flip
        categories."""
        rows = [
            _row(error_type="acceptable_current_label"),
            _row(error_type="acceptable_current_label"),
            _row(
                id="x_err",
                text="좋아요 만족합니다",
                current_polarity="negative_weak",
                gold_polarity="positive",
                error_type="positive_as_negative",
            ),
        ]
        out = evaluator.compute_guardrail_catch_rate(rows)
        assert out["n_polarity_errors"] == 1
        # The flip case (positive cues, claimed negative) is caught.
        assert out["n_caught"] == 1


# ---------------------------------------------------------------------------
# Seller-surface risk classification
# ---------------------------------------------------------------------------


class TestSellerSurfaceRisk:
    def test_risk_codes_counted(self, evaluator):
        rows = [
            _row(error_type="positive_as_negative"),
            _row(error_type="positive_as_negative"),
            _row(error_type="negative_as_positive"),
            _row(error_type="attribute_mismatch"),
            _row(error_type="span_boundary_bad"),
            _row(error_type="acceptable_current_label"),
            _row(error_type="mixed_should_be_mixed"),
            _row(error_type="neutral_or_context_missing"),
        ]
        out = evaluator.compute_seller_surface_risk(rows)
        # 2 + 1 + 1 + 1 = 5; mixed/neutral/acceptable excluded.
        assert out["total_at_risk"] == 5
        assert out["by_error_type"]["positive_as_negative"] == 2
        assert out["by_error_type"]["negative_as_positive"] == 1
        assert "mixed_should_be_mixed" not in out["by_error_type"]
        assert "acceptable_current_label" not in out["by_error_type"]


# ---------------------------------------------------------------------------
# Top-level evaluate() output shape
# ---------------------------------------------------------------------------


class TestEvaluateOutput:
    def test_output_has_required_keys(self, evaluator):
        rows = [_row(), _row(id="x_002")]
        out = evaluator.evaluate(rows)
        for k in (
            "n_total", "n_excluded_from_polarity_metrics", "n_evaluated",
            "accuracy_coarse", "accuracy_fine",
            "per_class_coarse", "confusion_matrix_fine",
            "errors_by_attribute", "seller_surface_risk",
            "guardrail_catch_rate", "error_type_distribution",
        ):
            assert k in out, f"evaluate() output missing key: {k}"

    def test_attribute_mismatch_excluded_from_polarity_eligible(
        self, evaluator,
    ):
        rows = [
            _row(error_type="acceptable_current_label"),
            _row(id="x_mis", error_type="attribute_mismatch"),
            _row(id="x_span", error_type="span_boundary_bad"),
        ]
        out = evaluator.evaluate(rows)
        assert out["n_total"] == 3
        assert out["n_excluded_from_polarity_metrics"] == 2
        assert out["n_evaluated"] == 1


# ---------------------------------------------------------------------------
# Markdown rendering shape
# ---------------------------------------------------------------------------


class TestMarkdownRendering:
    def test_md_carries_seed_warning(self, evaluator):
        rows = [_row(), _row(id="x_002")]
        metrics = evaluator.evaluate(rows)
        md = evaluator.render_markdown(
            metrics, dataset_path=SHIPPED_SEED,
            ran_at_utc="2026-05-01T00:00:00Z",
        )
        assert "Seed eval" in md
        assert "NOT a production benchmark" in md
        assert "Headline accuracy" in md
        assert "Confusion matrix" in md
        assert "Guardrail catch rate" in md
        assert "Recommendations" in md


# ---------------------------------------------------------------------------
# End-to-end CLI run on the shipped seed.
# ---------------------------------------------------------------------------


class TestEndToEndCLI:
    def test_runs_against_shipped_seed_and_writes_both_artifacts(
        self, evaluator, tmp_path: Path,
    ):
        out_dir = tmp_path / "eval_out"
        rc = evaluator.main([
            "--dataset", str(SHIPPED_SEED),
            "--out-dir", str(out_dir),
        ])
        assert rc == 0
        # One JSON + one MD file written; deterministic prefix.
        json_files = list(out_dir.glob("phase2e_classification_eval_*.json"))
        md_files = list(out_dir.glob("phase2e_classification_eval_*.md"))
        assert len(json_files) == 1
        assert len(md_files) == 1
        # JSON parses and has the expected envelope.
        payload = json.loads(json_files[0].read_text(encoding="utf-8"))
        assert payload["schema_version"] == "1.0"
        assert payload["kind"] == "phase2e_seed_classification_eval"
        assert "metrics" in payload
        # MD has the seed-warning callout.
        md = md_files[0].read_text(encoding="utf-8")
        assert "NOT a production benchmark" in md

    def test_missing_dataset_returns_nonzero(self, evaluator, tmp_path: Path):
        rc = evaluator.main([
            "--dataset", str(tmp_path / "does_not_exist.jsonl"),
            "--out-dir", str(tmp_path / "out"),
        ])
        assert rc != 0
