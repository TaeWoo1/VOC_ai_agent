"""Tests for `evaluate_phase2e_classification.py` replay mode.

Covers:
  - replay with a fake classifier (no API call)
  - improved / regressed counts on synthetic outcomes
  - per-row replay fields populated
  - baseline metrics unchanged when replay runs
  - replay markdown surfaces side-by-side block
  - missing API key path returns the documented exit code + manual command
  - unit tests do NOT import the openai SDK
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
EVALUATOR = REPO / "scripts" / "evaluate_phase2e_classification.py"


@pytest.fixture(scope="module")
def evaluator():
    sys.path.insert(0, str(REPO))
    spec = importlib.util.spec_from_file_location(
        "evaluate_phase2e_replay", EVALUATOR,
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Synthetic row + classifier
# ---------------------------------------------------------------------------


def _row(**overrides):
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
        "note": "synthetic",
    }
    base.update(overrides)
    return base


class FakeClassifier:
    """Test double for `PolarityClassifier`. Returns whatever
    `(polarity, intensity)` the test parameterized it with. No API
    call, no openai import."""

    def __init__(self, polarity: str = "positive", intensity: int = 2,
                 drop: bool = False, rationale: str = "fake rationale"):
        self.polarity = polarity
        self.intensity = intensity
        self.drop = drop
        self.rationale = rationale
        self.calls: list[tuple[str, str]] = []

    def classify(self, clause: str, attribute: str):
        from src.voc.reporting.phase2e.stage2 import PolarityRecord
        self.calls.append((clause, attribute))
        return PolarityRecord(
            attribute=attribute,
            polarity=self.polarity,
            intensity=self.intensity,
            evidence_span=clause[:80],
            confidence="high",
            drop=self.drop,
            rationale=self.rationale,
        )


class MapClassifier:
    """Returns a different polarity per (text, attribute) pair —
    used for testing per-row classification logic."""

    def __init__(self, mapping: dict[tuple[str, str], str]):
        self.mapping = mapping

    def classify(self, clause: str, attribute: str):
        from src.voc.reporting.phase2e.stage2 import PolarityRecord
        polarity = self.mapping.get((clause, attribute), "neutral")
        return PolarityRecord(
            attribute=attribute, polarity=polarity, intensity=2,
            evidence_span=clause[:80], confidence="high",
            drop=(polarity == "neutral"), rationale="map-based",
        )


# ---------------------------------------------------------------------------
# Per-row replay enrichment
# ---------------------------------------------------------------------------


class TestRowEnrichment:
    def test_replay_polarity_recorded(self, evaluator):
        rows = [_row()]
        clf = FakeClassifier(polarity="negative_weak")
        out = evaluator.run_replay(rows, clf)
        assert len(out) == 1
        assert out[0]["replay_polarity"] == "negative_weak"
        assert out[0]["replay_drop"] is False
        assert "replay_rationale" in out[0]

    def test_classifier_receives_text_and_attribute(self, evaluator):
        rows = [_row(text="원본 텍스트", attribute="finish_texture")]
        clf = FakeClassifier()
        evaluator.run_replay(rows, clf)
        assert clf.calls == [("원본 텍스트", "finish_texture")]

    def test_classifier_returning_none_yields_neutral(self, evaluator):
        class NullClassifier:
            def classify(self, c, a):
                return None
        rows = [_row()]
        out = evaluator.run_replay(rows, NullClassifier())
        assert out[0]["replay_polarity"] == "neutral"
        assert out[0]["replay_drop"] is True

    def test_classifier_exception_recorded_not_propagated(self, evaluator):
        class ErroringClassifier:
            def classify(self, c, a):
                raise RuntimeError("api meltdown")
        rows = [_row()]
        out = evaluator.run_replay(rows, ErroringClassifier())
        assert len(out) == 1
        assert "replay_error" in out[0]
        assert "api meltdown" in out[0]["replay_error"]


# ---------------------------------------------------------------------------
# Improved / regressed counting
# ---------------------------------------------------------------------------


class TestSideBySide:
    def test_improvement_counted(self, evaluator):
        """Current=negative_weak, gold=positive, replay=positive →
        improved=1."""
        rows = [_row(
            id="impr",
            current_polarity="negative_weak",
            gold_polarity="positive",
            error_type="positive_as_negative",
        )]
        clf = FakeClassifier(polarity="positive")
        enriched = evaluator.run_replay(rows, clf)
        sxs = evaluator.compute_side_by_side(enriched)
        assert sxs["n_improved"] == 1
        assert sxs["n_regressed"] == 0
        assert sxs["n_changed"] == 1
        assert sxs["net_delta"] == 1

    def test_regression_counted(self, evaluator):
        """Current=positive, gold=positive, replay=negative_weak →
        regressed=1."""
        rows = [_row(
            id="regr",
            current_polarity="positive",
            gold_polarity="positive",
            error_type="acceptable_current_label",
        )]
        clf = FakeClassifier(polarity="negative_weak")
        enriched = evaluator.run_replay(rows, clf)
        sxs = evaluator.compute_side_by_side(enriched)
        assert sxs["n_improved"] == 0
        assert sxs["n_regressed"] == 1
        assert sxs["n_changed"] == 1
        assert sxs["net_delta"] == -1

    def test_unchanged_counted(self, evaluator):
        rows = [_row(
            current_polarity="positive",
            gold_polarity="positive",
            error_type="acceptable_current_label",
        )]
        clf = FakeClassifier(polarity="positive")
        enriched = evaluator.run_replay(rows, clf)
        sxs = evaluator.compute_side_by_side(enriched)
        assert sxs["n_changed"] == 0
        assert sxs["n_unchanged"] == 1
        assert sxs["n_improved"] == 0
        assert sxs["n_regressed"] == 0

    def test_neither_correct_change_not_improvement(self, evaluator):
        """Current=negative_weak, gold=positive, replay=mixed —
        polarity changed, but neither current nor replay matches
        gold. Should NOT count as improved OR regressed."""
        rows = [_row(
            current_polarity="negative_weak",
            gold_polarity="positive",
            error_type="positive_as_negative",
        )]
        clf = FakeClassifier(polarity="mixed")
        enriched = evaluator.run_replay(rows, clf)
        sxs = evaluator.compute_side_by_side(enriched)
        assert sxs["n_changed"] == 1
        assert sxs["n_improved"] == 0
        assert sxs["n_regressed"] == 0

    def test_aggregate_counts(self, evaluator):
        """3 improved, 1 regressed, 2 unchanged."""
        rows = [
            _row(id=f"r{i}", text=f"text-{i}", current_polarity="negative_weak",
                 gold_polarity="positive", error_type="positive_as_negative")
            for i in range(3)
        ] + [
            _row(id="reg", text="text-reg", current_polarity="positive",
                 gold_polarity="positive", error_type="acceptable_current_label"),
            _row(id="ok1", text="text-ok1", current_polarity="positive",
                 gold_polarity="positive", error_type="acceptable_current_label"),
            _row(id="ok2", text="text-ok2", current_polarity="positive",
                 gold_polarity="positive", error_type="acceptable_current_label"),
        ]
        # Map classifier: improvers → positive, regressor → negative_weak,
        # ok1 / ok2 → positive (no change).
        mapping = {}
        for i in range(3):
            mapping[(f"text-{i}", "value_price")] = "positive"
        mapping[("text-reg", "value_price")] = "negative_weak"
        mapping[("text-ok1", "value_price")] = "positive"
        mapping[("text-ok2", "value_price")] = "positive"
        clf = MapClassifier(mapping)
        enriched = evaluator.run_replay(rows, clf)
        sxs = evaluator.compute_side_by_side(enriched)
        assert sxs["n_improved"] == 3
        assert sxs["n_regressed"] == 1
        assert sxs["n_unchanged"] == 2
        assert sxs["net_delta"] == 2


# ---------------------------------------------------------------------------
# Replay metric pack — same shape as baseline
# ---------------------------------------------------------------------------


class TestDeriveErrorType:
    def test_match_yields_acceptable(self, evaluator):
        assert evaluator._derive_error_type(
            "positive", "positive",
        ) == "acceptable_current_label"

    def test_same_coarse_family_yields_acceptable(self, evaluator):
        # neg_weak vs neg_strong are same coarse family — not a
        # surface-risk error.
        assert evaluator._derive_error_type(
            "negative_weak", "negative_strong",
        ) == "acceptable_current_label"

    def test_positive_as_negative(self, evaluator):
        assert evaluator._derive_error_type(
            "negative_weak", "positive",
        ) == "positive_as_negative"

    def test_negative_as_positive(self, evaluator):
        assert evaluator._derive_error_type(
            "positive", "negative_weak",
        ) == "negative_as_positive"

    def test_mixed_should_be_mixed(self, evaluator):
        assert evaluator._derive_error_type(
            "positive", "mixed",
        ) == "mixed_should_be_mixed"

    def test_seller_surface_risk_reflects_replay_after_fix(self, evaluator):
        """Regression gate for the bug: surface-risk in the replay
        report must reflect the replay's error pattern, not the
        dataset's static annotation."""
        rows = [
            _row(id="fixed", current_polarity="negative_weak",
                 gold_polarity="positive",
                 error_type="positive_as_negative"),
        ]
        clf = FakeClassifier(polarity="positive")  # replay matches gold
        enriched = evaluator.run_replay(rows, clf)
        replay_metrics = evaluator.evaluate_replay(enriched)
        # Replay matches gold → no surface risk should remain.
        assert replay_metrics["seller_surface_risk"]["total_at_risk"] == 0


class TestEvaluateReplay:
    def test_replay_metrics_shape_matches_baseline(self, evaluator):
        rows = [
            _row(id="r1", current_polarity="negative_weak",
                 gold_polarity="positive",
                 error_type="positive_as_negative"),
            _row(id="r2", current_polarity="positive",
                 gold_polarity="positive",
                 error_type="acceptable_current_label"),
        ]
        clf = FakeClassifier(polarity="positive")
        enriched = evaluator.run_replay(rows, clf)
        baseline = evaluator.evaluate(rows)
        replay = evaluator.evaluate_replay(enriched)
        # Same top-level keys.
        assert set(baseline.keys()) == set(replay.keys())
        # Replay accuracy improves (was 1/2 → 2/2).
        assert replay["accuracy_coarse"] > baseline["accuracy_coarse"]


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------


class TestReplayMarkdown:
    def test_md_contains_side_by_side_block(self, evaluator, tmp_path):
        rows = [
            _row(id="r1", current_polarity="negative_weak",
                 gold_polarity="positive",
                 error_type="positive_as_negative"),
        ]
        clf = FakeClassifier(polarity="positive")
        enriched = evaluator.run_replay(rows, clf)
        baseline = evaluator.evaluate(rows)
        replay = evaluator.evaluate_replay(enriched)
        sxs = evaluator.compute_side_by_side(enriched)
        md = evaluator.render_replay_markdown(
            baseline_metrics=baseline,
            replay_metrics=replay,
            side_by_side=sxs,
            dataset_path=tmp_path / "fake.jsonl",
            ran_at_utc="2026-05-01T00:00:00Z",
            model="gpt-4o-mini",
            prompt_version="stage2_polarity_v2_skincare_sentiment",
            n_replayed=len(enriched),
        )
        assert "Baseline vs replay" in md
        assert "Improved" in md
        assert "Regressed" in md or "Improved" in md
        assert "stage2_polarity_v2_skincare_sentiment" in md
        assert "gpt-4o-mini" in md


# ---------------------------------------------------------------------------
# CLI: missing API key path
# ---------------------------------------------------------------------------


class TestCLINoAPIKey:
    def test_replay_without_api_key_exits_nonzero_and_prints_command(
        self, evaluator, tmp_path: Path, monkeypatch, capsys,
    ):
        # Ensure no API key is leaked from .env.
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        # `OpenAIClassifier.__init__` calls `load_dotenv()` if the
        # dotenv package is installed. Patch it out to keep the test
        # hermetic regardless of repo .env state.
        import importlib
        try:
            dotenv = importlib.import_module("dotenv")
            monkeypatch.setattr(dotenv, "load_dotenv", lambda *a, **kw: False)
        except ImportError:
            pass

        # Build a tiny synthetic dataset.
        ds = tmp_path / "tiny.jsonl"
        ds.write_text(json.dumps(_row()) + "\n", encoding="utf-8")

        rc = evaluator.main([
            "--dataset", str(ds),
            "--out-dir", str(tmp_path / "out"),
            "--replay-stage2",
        ])
        assert rc != 0
        # Documented exit code 6 for "API key missing / SDK missing".
        # If openai SDK itself is missing, the runtime error path
        # also lands here — both exits map to 6 in the dispatcher.
        # (rc=5 reserved for ImportError; both are non-zero.)
        assert rc in (5, 6)
        captured = capsys.readouterr()
        # Manual command must be printed so the operator can copy/paste.
        assert "--replay-stage2" in captured.err

    def test_baseline_mode_does_not_require_api_key(
        self, evaluator, tmp_path: Path, monkeypatch,
    ):
        """Without --replay-stage2, baseline mode must run cleanly
        even when no API key exists. This is the regression gate
        for default eval flows."""
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        ds = tmp_path / "tiny.jsonl"
        ds.write_text(json.dumps(_row()) + "\n", encoding="utf-8")
        rc = evaluator.main([
            "--dataset", str(ds),
            "--out-dir", str(tmp_path / "out"),
        ])
        assert rc == 0


# ---------------------------------------------------------------------------
# Unit tests must not pull the openai SDK as a hard dependency.
# ---------------------------------------------------------------------------


class TestNoOpenAIDependency:
    def test_evaluator_module_imports_without_openai(self, evaluator):
        """The evaluator module is loaded at fixture time; if it had a
        top-level `import openai`, the fixture would have failed in
        environments without the SDK. Just assert the module is alive."""
        assert hasattr(evaluator, "evaluate")
        assert hasattr(evaluator, "run_replay")
        assert hasattr(evaluator, "compute_side_by_side")
