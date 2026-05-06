"""Smoke tests for scripts/run_content.py.

Phase A scaffold + Phase B KO Instagram cardnews. Both modes
exercised. No DB, no network, no LLM.

Sparse fixture (`fake_analysis_report`) is intentionally too thin
to satisfy the cardnews 2-bullet floor — Phase B falls through to
`status=failed` for `skeleton_cardnews_json` (run continues).
Rich fixture (`rich_analysis_report`) lets cardnews succeed.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

from src.voc.content.manifest import (
    BUYER_CONTENT_ARTIFACT_KEYS_PHASE_A,
    MANIFEST_FILENAME,
    MANIFEST_SCHEMA_VERSION,
)

REPO = Path(__file__).resolve().parents[2]
RUN_CONTENT_PATH = REPO / "scripts" / "run_content.py"


def _load_run_content_module():
    """Load scripts/run_content.py without requiring scripts/__init__.py.

    Cached on `sys.modules` so repeated calls reuse the same module
    instance — avoids re-running the import-time sys.path mutation.
    """
    name = "_test_run_content_module"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, RUN_CONTENT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def fake_analysis_report(tmp_path: Path) -> Path:
    """Minimal analysis_report.json — too thin for cardnews to succeed.
    Used to exercise the Phase B failure-isolation path."""
    report = {
        "schema_version": "3.0",
        "product": {
            "slug": "demo-product",
            "name_ko": "데모 제품",
            "source_url": "https://example.com/p/12345",
        },
        "corpus": {
            "n_reviews_total": 1135,
            "primary_sort": "DATETIME_DESC",
            "sampling_strategy": "latest_only",
            "corpus_type": "observed_scrape",
            "confidence_level": "high",
            "signal_stability": "high",
        },
        "attributes": [],
    }
    path = tmp_path / "analysis_report.json"
    path.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
    return path


@pytest.fixture
def rich_analysis_report(tmp_path: Path) -> Path:
    """Rich analysis_report.json — every Phase B cardnews slide
    clears its 2-bullet floor."""
    report = {
        "schema_version": "3.0",
        "product": {
            "slug": "demo-product",
            "name_ko": "데모 제품",
            "source_url": "https://example.com/p/12345",
        },
        "corpus": {
            "n_reviews_total": 1135,
            "primary_sort": "DATETIME_DESC",
            "sampling_strategy": "latest_only",
            "corpus_type": "observed_scrape",
            "confidence_level": "high",
            "signal_stability": "high",
            "observation_window": {"start": "2025-04-01", "end": "2026-04-01"},
        },
        "attributes": [
            {"key": "pigmentation",   "label_ko": "발색",   "n_positive": 181, "n_negative": 71},
            {"key": "persistence",    "label_ko": "지속력", "n_positive": 47,  "n_negative": 12},
            {"key": "transfer_resistance", "label_ko": "묻어남", "n_positive": 20, "n_negative": 38},
            {"key": "application_blending","label_ko":"발림성","n_positive": 32,"n_negative": 8},
        ],
        "strengths": [
            {"attribute_key": "pigmentation", "supporting_count": 181},
            {"attribute_key": "persistence",  "supporting_count": 47},
            {"attribute_key": "application_blending", "supporting_count": 32},
        ],
        "monitoring_candidates": [
            {"attribute_key": "transfer_resistance", "concern_label_ko": "묻어남", "n_negative": 38},
            {"attribute_key": "pigmentation", "concern_label_ko": "발색 변화", "n_negative": 12},
        ],
        "buyer_segments": [
            {"segment_kind": "skin_type", "label_ko": "건성 피부",
             "dominant_count": 32, "dominance_ratio": 0.78, "confidence_level": "strong"},
            {"segment_kind": "tone", "label_ko": "쿨톤",
             "dominant_count": 24, "dominance_ratio": 0.66, "confidence_level": "moderate"},
        ],
        "quick_decision": {
            "verdict_ko": "발색이 진하다는 평이 두드러집니다",
            "who_for_ko": ["건성 피부에서 잘 맞았다는 의견", "쿨톤 사용자에서 호평"],
            "who_not_for_ko": ["마스크/외출 사용이 잦은 분"],
            "watch_outs_ko": ["묻어남"],
            "confidence_level": "strong",
        },
        "methodology_notes": {"disclosure_ko": "공개 리뷰 데이터 기반 정보입니다"},
    }
    path = tmp_path / "rich_analysis_report.json"
    path.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
    return path


def _run(monkeypatch, argv: list[str]) -> int:
    """Invoke run_content.main with monkeypatched argv-equivalent."""
    cli = _load_run_content_module()
    return cli.main(argv)


class TestRunContentCli:
    def test_allocates_new_run_dir(self, tmp_path: Path, fake_analysis_report: Path, monkeypatch):
        out_base = tmp_path / "outputs"
        rc = _run(
            monkeypatch,
            [
                "--report", str(fake_analysis_report),
                "--lang", "ko,en",
                "--channels", "instagram,threads,x",
                "--mock",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        assert rc == 0
        run_dirs = list(out_base.iterdir())
        assert len(run_dirs) == 1
        assert run_dirs[0].name == "2026-04-29_demo-product_run-001"

    def test_writes_manifest_at_run_root(self, tmp_path: Path, fake_analysis_report: Path, monkeypatch):
        out_base = tmp_path / "outputs"
        _run(
            monkeypatch,
            [
                "--report", str(fake_analysis_report),
                "--lang", "ko",
                "--channels", "instagram",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest_path = run_dir / MANIFEST_FILENAME
        assert manifest_path.is_file()
        loaded = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert loaded["schema_version"] == MANIFEST_SCHEMA_VERSION
        assert loaded["safety"]["requires_human_review"] is True

    def test_copies_report_and_schema_into_shared(
        self, tmp_path: Path, fake_analysis_report: Path, monkeypatch
    ):
        out_base = tmp_path / "outputs"
        _run(
            monkeypatch,
            [
                "--report", str(fake_analysis_report),
                "--lang", "ko",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        assert (run_dir / "shared" / "analysis_report.json").is_file()
        assert (run_dir / "shared" / "analysis_report.schema.json").is_file()

    def test_sparse_report_marks_cardnews_failed_run_continues(
        self, tmp_path: Path, fake_analysis_report: Path, monkeypatch
    ):
        """Phase B with a too-thin report: ko/skeleton_cardnews_json
        flips to `failed`; every other buyer_content slot stays
        `skipped`; the run still exits 0 and writes a valid manifest."""
        out_base = tmp_path / "outputs"
        rc = _run(
            monkeypatch,
            [
                "--report", str(fake_analysis_report),
                "--lang", "ko,en",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        assert rc == 0
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))

        ko = manifest["artifacts"]["buyer_content"]["ko"]
        assert ko["skeleton_cardnews_json"]["status"] == "failed"
        assert ko["skeleton_cardnews_json"]["notes"]
        for key in BUYER_CONTENT_ARTIFACT_KEYS_PHASE_A:
            if key == "skeleton_cardnews_json":
                continue
            assert ko[key]["status"] == "skipped"

        # English untouched — Phase B doesn't generate EN.
        en = manifest["artifacts"]["buyer_content"]["en"]
        for key in BUYER_CONTENT_ARTIFACT_KEYS_PHASE_A:
            assert en[key]["status"] == "skipped"

    def test_phase_a_keeps_cardnews_skipped(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        """`--phase a` is a back-compat scaffold-only mode: cardnews
        is not generated even when the report is rich enough."""
        out_base = tmp_path / "outputs"
        _run(
            monkeypatch,
            [
                "--report", str(rich_analysis_report),
                "--lang", "ko,en",
                "--phase", "a",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        for lang in ("ko", "en"):
            for key in BUYER_CONTENT_ARTIFACT_KEYS_PHASE_A:
                assert manifest["artifacts"]["buyer_content"][lang][key]["status"] == "skipped"
        # No file should have been written under buyer_content/ko/
        assert not (run_dir / "buyer_content" / "ko" / "instagram_cardnews.json").exists()

    def test_rich_report_writes_cardnews_ok(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        """Phase B happy path: cardnews JSON is written, manifest
        marks it `ok` with sha256, file is on disk under
        buyer_content/ko/."""
        out_base = tmp_path / "outputs"
        _run(
            monkeypatch,
            [
                "--report", str(rich_analysis_report),
                "--lang", "ko",
                "--channels", "instagram",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        cardnews_path = run_dir / "buyer_content" / "ko" / "instagram_cardnews.json"
        assert cardnews_path.is_file()

        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        rec = manifest["artifacts"]["buyer_content"]["ko"]["skeleton_cardnews_json"]
        assert rec["status"] == "ok"
        assert rec["path"] == "buyer_content/ko/instagram_cardnews.json"
        assert rec["sha256"]
        assert rec["bytes"] == cardnews_path.stat().st_size

    def test_rich_report_cardnews_passes_validator(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        """The on-disk JSON re-validates with zero blocking flags."""
        from src.voc.content.validators import validate_instagram_cardnews_ko

        out_base = tmp_path / "outputs"
        _run(
            monkeypatch,
            [
                "--report", str(rich_analysis_report),
                "--lang", "ko",
                "--channels", "instagram",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        cardnews_path = run_dir / "buyer_content" / "ko" / "instagram_cardnews.json"
        cardnews = json.loads(cardnews_path.read_text(encoding="utf-8"))
        result = validate_instagram_cardnews_ko(cardnews)
        assert result.ok, result.blocking

    def test_phase_b_writes_brief_under_shared(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        """Phase C: brief is generated, lives under `shared/`,
        and is registered as `consumer_insight_brief_json: ok` at
        the top level of the manifest."""
        out_base = tmp_path / "outputs"
        _run(
            monkeypatch,
            [
                "--report", str(rich_analysis_report),
                "--lang", "ko",
                "--channels", "instagram",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        brief_path = run_dir / "shared" / "consumer_insight_brief.json"
        assert brief_path.is_file()

        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        rec = manifest["artifacts"]["consumer_insight_brief_json"]
        assert rec["status"] == "ok"
        assert rec["path"] == "shared/consumer_insight_brief.json"
        assert rec["sha256"]

    def test_phase_b_brief_schema_copied_into_shared(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        out_base = tmp_path / "outputs"
        _run(
            monkeypatch,
            [
                "--report", str(rich_analysis_report),
                "--lang", "ko",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        assert (run_dir / "shared" / "consumer_insight_brief.schema.json").is_file()

    def test_phase_a_skips_brief(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        out_base = tmp_path / "outputs"
        _run(
            monkeypatch,
            [
                "--report", str(rich_analysis_report),
                "--lang", "ko",
                "--phase", "a",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        assert manifest["artifacts"]["consumer_insight_brief_json"]["status"] == "skipped"
        assert not (run_dir / "shared" / "consumer_insight_brief.json").exists()

    def test_sparse_report_marks_brief_failed_run_continues(
        self, tmp_path: Path, fake_analysis_report: Path, monkeypatch
    ):
        """Sparse report can't produce a brief; runner should
        record `consumer_insight_brief_json.status=failed` with notes
        and exit 0."""
        out_base = tmp_path / "outputs"
        rc = _run(
            monkeypatch,
            [
                "--report", str(fake_analysis_report),
                "--lang", "ko",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        assert rc == 0
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        rec = manifest["artifacts"]["consumer_insight_brief_json"]
        assert rec["status"] == "failed"
        assert rec["notes"]

    def test_channel_not_in_scope_keeps_cardnews_skipped(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        """When --channels does not include instagram, cardnews is
        not generated."""
        out_base = tmp_path / "outputs"
        _run(
            monkeypatch,
            [
                "--report", str(rich_analysis_report),
                "--lang", "ko",
                "--channels", "threads,x",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        rec = manifest["artifacts"]["buyer_content"]["ko"]["skeleton_cardnews_json"]
        assert rec["status"] == "skipped"
        assert not (run_dir / "buyer_content" / "ko" / "instagram_cardnews.json").exists()


# ---------------------------------------------------------------------------
# Phase D1: editorial polish CLI
# ---------------------------------------------------------------------------


def _valid_polished_response_for_report(report: dict) -> str:
    """Build a polished_slides JSON that preserves every skeleton
    numeric and references the actually-selected angle. Computed
    at runtime against the live skeleton + brief so we never drift
    from the deterministic generator output.
    """
    from src.voc.content.angle_selection import select_angle
    from src.voc.content.cardnews_generator import generate_instagram_cardnews_ko
    from src.voc.content.editorial_validators import _slide_text  # type: ignore[attr-defined]
    from src.voc.content.insight_brief import generate_consumer_insight_brief

    brief = generate_consumer_insight_brief(report)
    skeleton = generate_instagram_cardnews_ko(report, brief=brief)
    selected = select_angle(
        brief["angle_candidates"],
        brief["channel_angle_recommendations"]["instagram"]["suggested_angle_ids"],
        mode="auto",
    )
    angle_path = f"angle_candidates[{selected.angle_id}]"

    polished_slides = []
    for s in skeleton["slides"]:
        polished = {
            "index": s["index"],
            "type": s["type"],
            "title": s["title"],
            "source_brief_fields": [angle_path],
        }
        # For numeric_preservation we just echo the skeleton text — the
        # validator only requires numbers be present, not paraphrased.
        if s["type"] == "hook":
            polished["subtitle"] = s["subtitle"]
            polished["source_brief_fields"] = ["core_verdict.ko", angle_path]
        elif s["type"] == "best_for":
            polished["for_bullets"] = list(s["for_bullets"])
            polished["not_for_bullets"] = list(s["not_for_bullets"])
            polished["source_brief_fields"] = [
                "best_for[0]", "not_for[0]", angle_path,
            ]
        elif s["type"] == "method":
            polished["bullets"] = list(s["bullets"])
            polished["disclosure"] = s["disclosure"]
            polished["source_brief_fields"] = ["evidence_boundaries.n_reviews_total"]
        else:
            polished["bullets"] = list(s["bullets"])
            polished["source_brief_fields"] = [
                f"{s['type']}_anchor", angle_path,
            ] if False else [angle_path]  # safe fallback
            # Map slide type to a real brief path that resolves
            if s["type"] == "loved":
                polished["source_brief_fields"] = ["best_for[0]", angle_path]
            elif s["type"] == "divides":
                polished["source_brief_fields"] = ["main_tradeoff.ko", angle_path]
            elif s["type"] == "fit":
                polished["source_brief_fields"] = ["best_for[0]", "best_for[1]", angle_path]
            elif s["type"] == "watch_outs":
                polished["source_brief_fields"] = ["watch_outs[0]", angle_path]
        polished_slides.append(polished)

    return json.dumps({"polished_slides": polished_slides}, ensure_ascii=False)


def _read_report(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _patch_mock_llm(monkeypatch, responses):
    """Replace `_make_llm_client_factory` in the runner module with a
    factory that returns a `MockLLMClient` scripted with `responses`."""
    cli = _load_run_content_module()
    from src.voc.content.llm.client import MockLLMClient as _Mock

    def _factory_factory(*, model: str, temperature: float):
        def _factory():
            return _Mock(list(responses), model=model, temperature=temperature)
        return _factory
    monkeypatch.setattr(cli, "_make_llm_client_factory", _factory_factory)


class TestRunContentCliPhaseD:
    @pytest.fixture(autouse=True)
    def _isolate_polish_cache(self, tmp_path: Path, monkeypatch):
        """Each test gets its own polish cache so user-level
        `~/.cache/voc-content-engine` doesn't leak prior runs in.
        Setting `VOC_CONTENT_LLM_CACHE_DIR` flips `default_cache_dir()`
        to a per-test directory."""
        monkeypatch.setenv(
            "VOC_CONTENT_LLM_CACHE_DIR",
            str(tmp_path / "_phase_d_cache"),
        )

    def test_no_llm_keeps_editorial_skipped(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        out_base = tmp_path / "outputs"
        _run(monkeypatch, [
            "--report", str(rich_analysis_report),
            "--lang", "ko",
            "--channels", "instagram",
            "--no-llm",
            "--output-base", str(out_base),
            "--date", "2026-04-29",
        ])
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        rec = manifest["artifacts"]["buyer_content"]["ko"]["editorial_cardnews_json"]
        assert rec["status"] == "skipped"
        assert manifest["safety"]["editorial_polish_used"] is False
        assert manifest["safety"]["fallback_to_skeleton"] is False
        assert not (run_dir / "buyer_content" / "ko" / "editorial_cardnews.json").exists()

    def test_polish_happy_path_writes_editorial(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        _patch_mock_llm(monkeypatch, [_valid_polished_response_for_report(_read_report(rich_analysis_report))])
        out_base = tmp_path / "outputs"
        _run(monkeypatch, [
            "--report", str(rich_analysis_report),
            "--lang", "ko",
            "--channels", "instagram",
            "--output-base", str(out_base),
            "--date", "2026-04-29",
        ])
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        rec_e = manifest["artifacts"]["buyer_content"]["ko"]["editorial_cardnews_json"]
        rec_s = manifest["artifacts"]["buyer_content"]["ko"]["skeleton_cardnews_json"]
        assert rec_e["status"] == "ok"
        assert rec_e["path"] == "buyer_content/ko/editorial_cardnews.json"
        assert rec_s["status"] == "ok"
        assert manifest["safety"]["editorial_polish_used"] is True
        assert manifest["safety"]["fallback_to_skeleton"] is False
        assert (run_dir / "buyer_content" / "ko" / "editorial_cardnews.json").is_file()

    def test_llm_unavailable_persists_skeleton_as_editorial(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        """When LLM client construction fails (e.g. anthropic SDK
        not installed), the runner must persist the deterministic
        skeleton at the editorial path so downstream consumers see
        a valid cardnews JSON. status="ok" with explanatory notes.
        """
        cli = _load_run_content_module()

        # Replace the factory with one that raises like the real
        # AnthropicLLMClient constructor would when the SDK is
        # missing.
        def _factory_factory(*, model: str, temperature: float):
            def _factory():
                raise RuntimeError(
                    "anthropic SDK not installed; install with "
                    "`pip install anthropic` or use MockLLMClient in tests"
                )
            return _factory
        monkeypatch.setattr(cli, "_make_llm_client_factory", _factory_factory)

        out_base = tmp_path / "outputs"
        rc = _run(monkeypatch, [
            "--report", str(rich_analysis_report),
            "--lang", "ko",
            "--channels", "instagram",
            "--output-base", str(out_base),
            "--date", "2026-04-29",
        ])
        assert rc == 0
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads(
            (run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"),
        )
        rec_e = manifest["artifacts"]["buyer_content"]["ko"]["editorial_cardnews_json"]
        rec_s = manifest["artifacts"]["buyer_content"]["ko"]["skeleton_cardnews_json"]
        # Both files are present; both are valid cardnews JSONs.
        assert rec_s["status"] == "ok"
        assert rec_e["status"] == "ok", rec_e
        assert rec_e["path"] == "buyer_content/ko/editorial_cardnews.json"
        assert (run_dir / "buyer_content" / "ko" / "editorial_cardnews.json").is_file()
        # Notes flag the no-LLM fallback explicitly.
        notes = (rec_e.get("notes") or "").lower()
        assert "llm unavailable" in notes or "skeleton" in notes
        # Safety flags reflect "no polish was actually applied".
        assert manifest["safety"]["editorial_polish_used"] is False
        assert manifest["safety"]["fallback_to_skeleton"] is True
        # The persisted editorial JSON IS the skeleton (same
        # content), so its hash matches the skeleton's.
        assert rec_e["sha256"] == rec_s["sha256"]

    def test_polish_failure_falls_back_to_skeleton(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        # Both attempts (initial + retry) return malformed JSON.
        _patch_mock_llm(monkeypatch, ["not json", "still not json"])
        out_base = tmp_path / "outputs"
        rc = _run(monkeypatch, [
            "--report", str(rich_analysis_report),
            "--lang", "ko",
            "--channels", "instagram",
            "--output-base", str(out_base),
            "--date", "2026-04-29",
        ])
        assert rc == 0
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        rec_e = manifest["artifacts"]["buyer_content"]["ko"]["editorial_cardnews_json"]
        rec_s = manifest["artifacts"]["buyer_content"]["ko"]["skeleton_cardnews_json"]
        assert rec_e["status"] == "failed"
        assert rec_e["notes"]
        assert rec_s["status"] == "ok"
        assert manifest["safety"]["editorial_polish_used"] is True
        assert manifest["safety"]["fallback_to_skeleton"] is True

    def test_select_shipping_cardnews_via_manifest(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        from src.voc.content.manifest import select_shipping_cardnews

        _patch_mock_llm(monkeypatch, [_valid_polished_response_for_report(_read_report(rich_analysis_report))])
        out_base = tmp_path / "outputs"
        _run(monkeypatch, [
            "--report", str(rich_analysis_report),
            "--lang", "ko",
            "--channels", "instagram",
            "--output-base", str(out_base),
            "--date", "2026-04-29",
        ])
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        ship = select_shipping_cardnews(manifest, "ko")
        # Run-003 QA pass-5 selection rule: buyer_journey_cardnews_json
        # is the primary surface; legacy 7-slide editorial / skeleton
        # are kept as fallbacks. When buyer_journey is `ok`, it wins.
        assert ship == "buyer_content/ko/buyer_journey_cardnews.json"

    def test_style_seed_recorded_in_config(
        self, tmp_path: Path, rich_analysis_report: Path, monkeypatch
    ):
        _patch_mock_llm(monkeypatch, [_valid_polished_response_for_report(_read_report(rich_analysis_report))])
        out_base = tmp_path / "outputs"
        _run(monkeypatch, [
            "--report", str(rich_analysis_report),
            "--lang", "ko",
            "--channels", "instagram",
            "--style-seed", "42",
            "--output-base", str(out_base),
            "--date", "2026-04-29",
        ])
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        assert manifest["config"]["style_seed"] == 42

    def test_editorial_skipped_when_skeleton_fails(
        self, tmp_path: Path, fake_analysis_report: Path, monkeypatch
    ):
        """Sparse fixture → skeleton fails → editorial polish should
        be skipped (not failed) since there's nothing to polish.
        Empty mock queue verifies the LLM was never called."""
        _patch_mock_llm(monkeypatch, [])
        out_base = tmp_path / "outputs"
        _run(monkeypatch, [
            "--report", str(fake_analysis_report),
            "--lang", "ko",
            "--channels", "instagram",
            "--output-base", str(out_base),
            "--date", "2026-04-29",
        ])
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        rec_e = manifest["artifacts"]["buyer_content"]["ko"]["editorial_cardnews_json"]
        assert rec_e["status"] == "skipped"
        assert manifest["safety"]["editorial_polish_used"] is False

    def test_increments_on_repeat_invocation(
        self, tmp_path: Path, fake_analysis_report: Path, monkeypatch
    ):
        out_base = tmp_path / "outputs"
        for _ in range(3):
            _run(
                monkeypatch,
                [
                    "--report", str(fake_analysis_report),
                    "--lang", "ko",
                    "--output-base", str(out_base),
                    "--date", "2026-04-29",
                ],
            )
        names = sorted(p.name for p in out_base.iterdir())
        assert names == [
            "2026-04-29_demo-product_run-001",
            "2026-04-29_demo-product_run-002",
            "2026-04-29_demo-product_run-003",
        ]

    def test_run_dir_flag_reuses_existing(
        self, tmp_path: Path, fake_analysis_report: Path, monkeypatch
    ):
        out_base = tmp_path / "outputs"
        # Allocate first
        _run(
            monkeypatch,
            [
                "--report", str(fake_analysis_report),
                "--lang", "ko",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        existing = out_base / "2026-04-29_demo-product_run-001"
        # Re-render into the existing dir
        _run(
            monkeypatch,
            [
                "--report", str(fake_analysis_report),
                "--lang", "ko",
                "--run-dir", str(existing),
            ],
        )
        # Only one dir should exist
        assert sorted(p.name for p in out_base.iterdir()) == [existing.name]

    def test_does_not_modify_source_report(
        self, tmp_path: Path, fake_analysis_report: Path, monkeypatch
    ):
        before = fake_analysis_report.read_bytes()
        out_base = tmp_path / "outputs"
        _run(
            monkeypatch,
            [
                "--report", str(fake_analysis_report),
                "--lang", "ko",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        after = fake_analysis_report.read_bytes()
        assert before == after

    def test_rejects_unsupported_lang(
        self, tmp_path: Path, fake_analysis_report: Path, monkeypatch
    ):
        out_base = tmp_path / "outputs"
        with pytest.raises(SystemExit):
            _run(
                monkeypatch,
                [
                    "--report", str(fake_analysis_report),
                    "--lang", "fr",
                    "--output-base", str(out_base),
                    "--date", "2026-04-29",
                ],
            )

    def test_no_artifact_under_docs_or_tmp(
        self, tmp_path: Path, fake_analysis_report: Path, monkeypatch
    ):
        """End-to-end: every manifest path must start under run_dir, never
        under docs/ or /tmp/."""
        out_base = tmp_path / "outputs"
        _run(
            monkeypatch,
            [
                "--report", str(fake_analysis_report),
                "--lang", "ko,en",
                "--output-base", str(out_base),
                "--date", "2026-04-29",
            ],
        )
        run_dir = out_base / "2026-04-29_demo-product_run-001"
        manifest = json.loads((run_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))

        def _walk_paths(node):
            if isinstance(node, dict):
                if "path" in node and isinstance(node["path"], str):
                    yield node["path"]
                for v in node.values():
                    yield from _walk_paths(v)
            elif isinstance(node, list):
                for v in node:
                    yield from _walk_paths(v)

        for path in _walk_paths(manifest):
            assert not path.startswith("/")
            assert not path.startswith("tmp/")
            assert not path.startswith("docs/")
            assert ".." not in path.split("/")
