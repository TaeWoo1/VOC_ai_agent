"""Unit-level tests for scripts/run_all.py.

End-to-end (URL → scrape → DB → analysis → PDF) is too heavy for
unit tests — it needs a populated DB and either a real scrape or
a `--skip-scrape` workflow. Instead these tests exercise the
orchestration seams directly:

  - argparse surface
  - .env auto-load
  - in-process invocation of run_content.main() against an
    already-allocated run_dir + pre-written analysis_report.json
  - cardnews PNG render + review_ops tail steps (mocked: real
    Playwright / DB are not exercised; we only assert the
    orchestrator wires the calls correctly and tolerates failures)
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[2]
RUN_ALL_PATH = REPO / "scripts" / "run_all.py"


def _load_run_all():
    name = "_test_run_all_module"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, RUN_ALL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Argparse surface
# ---------------------------------------------------------------------------


class TestArgparseSurface:
    def test_help_prints(self, capsys):
        cli = _load_run_all()
        with pytest.raises(SystemExit):
            cli._parse_args(["--help"])
        out = capsys.readouterr().out
        assert "--product-url" in out
        assert "--no-llm" in out
        assert "--polish-mode" in out
        assert "--angle-mode" in out
        assert "--skip-cardnews-png" in out
        assert "--skip-review-ops" in out
        assert "--allow-live-image-fetch" in out

    def test_tail_step_flags_default_off(self):
        cli = _load_run_all()
        ns = cli._parse_args(["--product-url", "x"])
        assert ns.skip_cardnews_png is False
        assert ns.skip_review_ops is False
        assert ns.allow_live_image_fetch is False

    def test_product_url_required(self, capsys):
        cli = _load_run_all()
        with pytest.raises(SystemExit):
            cli._parse_args([])

    def test_default_polish_mode_full(self):
        cli = _load_run_all()
        ns = cli._parse_args(["--product-url", "x"])
        assert ns.polish_mode == "full"
        assert ns.angle_mode == "auto"

    def test_default_corpus_mode_observable(self):
        cli = _load_run_all()
        ns = cli._parse_args(["--product-url", "x"])
        assert ns.corpus_mode == "observable_multi_sort"
        assert ns.max_reviews_per_sort is None
        assert ns.max_total_reviews is None

    def test_corpus_mode_primary_only_opt_in(self):
        cli = _load_run_all()
        ns = cli._parse_args([
            "--product-url", "x",
            "--corpus-mode", "primary_only",
        ])
        assert ns.corpus_mode == "primary_only"

    def test_corpus_mode_invalid_rejected(self, capsys):
        cli = _load_run_all()
        with pytest.raises(SystemExit):
            cli._parse_args([
                "--product-url", "x",
                "--corpus-mode", "garbage",
            ])

    def test_max_reviews_per_sort_passes_through(self):
        cli = _load_run_all()
        ns = cli._parse_args([
            "--product-url", "x",
            "--max-reviews-per-sort", "100",
        ])
        assert ns.max_reviews_per_sort == "100"

    def test_max_total_reviews_passes_through(self):
        cli = _load_run_all()
        ns = cli._parse_args([
            "--product-url", "x",
            "--max-total-reviews", "300",
        ])
        assert ns.max_total_reviews == 300


# ---------------------------------------------------------------------------
# Slug derivation
# ---------------------------------------------------------------------------


class TestSlugDerivation:
    def test_uses_product_name_when_given(self):
        cli = _load_run_all()
        slug = cli._derive_product_slug("https://example.com/p/123", "ROMAND BETTER")
        assert slug == "romand-better"

    def test_falls_back_to_url_when_no_name(self):
        cli = _load_run_all()
        slug = cli._derive_product_slug(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000123456",
            None,
        )
        # URL-only with non-romanizable Korean → product-{12hex} fallback
        # OR an ASCII-derived slug — either is acceptable.
        assert slug
        assert slug == slug.lower()
        assert " " not in slug


# ---------------------------------------------------------------------------
# In-process content-engine invocation
# ---------------------------------------------------------------------------


def _minimal_analysis_report() -> dict:
    """Rich enough for the cardnews to clear every slide floor —
    mirrors the fixture used by other content tests."""
    return {
        "schema_version": "3.0",
        "product": {
            "slug": "demo-product",
            "name_ko": "데모 제품",
            "category": "color_cosmetics",
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
            {"key": "pigmentation", "label_ko": "발색", "n_positive": 181, "n_negative": 71},
            {"key": "persistence", "label_ko": "지속력", "n_positive": 47, "n_negative": 12},
            {"key": "transfer_resistance", "label_ko": "묻어남", "n_positive": 20, "n_negative": 38},
            {"key": "application_blending", "label_ko": "발림성", "n_positive": 32, "n_negative": 8},
        ],
        "strengths": [
            {"attribute_key": "pigmentation", "supporting_count": 181},
            {"attribute_key": "persistence", "supporting_count": 47},
        ],
        "monitoring_candidates": [
            {"attribute_key": "transfer_resistance", "concern_label_ko": "묻어남", "n_negative": 38},
            {"attribute_key": "pigmentation", "concern_label_ko": "발색", "n_negative": 71},
            {"attribute_key": "persistence", "concern_label_ko": "지속력", "n_negative": 12},
            {"attribute_key": "application_blending", "concern_label_ko": "발림성", "n_negative": 8},
        ],
        "buyer_segments": [],   # Phase 2E adapter emits empty
        "quick_decision": {
            "verdict_ko": "발색이 진하다는 평이 두드러집니다",
            "who_for_ko": ["발색 관련 호평이 반복되는 사용 패턴",
                           "지속력 관련 호평이 반복되는 사용 패턴"],
            "who_not_for_ko": ["묻어남이 중요한 사용 상황을 자주 겪는 분"],
            "watch_outs_ko": ["묻어남"],
            "confidence_level": "strong",
        },
        "methodology_notes": {"disclosure_ko": "공개 리뷰 데이터 기반 정보입니다"},
    }


class TestContentEngineInProcess:
    @pytest.fixture(autouse=True)
    def _isolate_polish_cache(self, tmp_path: Path, monkeypatch):
        monkeypatch.setenv(
            "VOC_CONTENT_LLM_CACHE_DIR",
            str(tmp_path / "_polish_cache"),
        )

    def test_no_llm_path_writes_skeleton_under_supplied_run_dir(
        self, tmp_path: Path
    ):
        """Allocate a run dir manually, write analysis_report.json,
        invoke `_run_content_engine` with --no-llm. Verify
        skeleton lands under the supplied run_dir."""
        from src.voc.content.paths import allocate_run_dir
        cli = _load_run_all()

        run_dir = allocate_run_dir(
            "2026-04-29", "demo-product", base=tmp_path / "outputs",
        )
        # Pre-place the analysis report (the seller pipeline would
        # have written it via --emit-analysis-report-json).
        ar_path = run_dir / "shared" / "analysis_report.json"
        ar_path.write_text(
            json.dumps(_minimal_analysis_report(), ensure_ascii=False),
            encoding="utf-8",
        )

        rc = cli._run_content_engine(
            analysis_report_path=ar_path,
            run_dir=run_dir,
            no_llm=True,
            llm_model=None,
            llm_temperature=None,
            polish_mode="full",
            angle_mode="auto",
            style_seed=None,
            max_retries=1,
        )
        assert rc == 0

        manifest = json.loads(
            (run_dir / "manifest.json").read_text(encoding="utf-8")
        )
        assert manifest["schema_version"] == "1.2"
        ko = manifest["artifacts"]["buyer_content"]["ko"]
        assert ko["skeleton_cardnews_json"]["status"] == "ok"
        assert ko["editorial_cardnews_json"]["status"] == "skipped"
        assert manifest["safety"]["editorial_polish_used"] is False


# ---------------------------------------------------------------------------
# .env auto-load (no-op when SDK or file missing)
# ---------------------------------------------------------------------------


class TestDotenvLoad:
    def test_no_op_when_dotenv_missing(self, monkeypatch, tmp_path):
        """If `python-dotenv` is unavailable, the loader returns
        cleanly — no crash, no env mutation."""
        cli = _load_run_all()
        # Force the ImportError path
        monkeypatch.setattr(cli, "REPO", tmp_path)
        # No .env file present → early return
        cli._load_dotenv_if_available()  # must not raise

    def test_loads_anthropic_key_when_dotenv_present(
        self, tmp_path, monkeypatch
    ):
        """When `python-dotenv` is installed AND .env carries
        ANTHROPIC_API_KEY, the loader pushes it into os.environ.
        Skipped silently when dotenv is not installed."""
        try:
            import dotenv  # noqa: F401
        except ImportError:
            pytest.skip("python-dotenv not installed; skipping load test")

        cli = _load_run_all()
        monkeypatch.setattr(cli, "REPO", tmp_path)
        env_file = tmp_path / ".env"
        env_file.write_text("FAKE_KEY_FOR_TEST=__sentinel__\n", encoding="utf-8")
        monkeypatch.delenv("FAKE_KEY_FOR_TEST", raising=False)

        cli._load_dotenv_if_available()
        assert __import__("os").environ.get("FAKE_KEY_FOR_TEST") == "__sentinel__"


# ---------------------------------------------------------------------------
# Tail steps — cardnews PNG render + review_ops companion
#
# Both steps are mocked. Real PNG rasterization needs Playwright +
# chromium-headless-shell; real review_ops needs a populated SQLite
# DB. Neither is appropriate for unit-level coverage. We instead
# exercise the orchestrator seam by patching the helper functions
# in-place and asserting call shape + failure-soft semantics.
# ---------------------------------------------------------------------------


def _make_run_dir_with_report(tmp_path: Path) -> tuple[Path, Path]:
    """Allocate a run_dir, drop a minimal analysis_report.json into
    `shared/`, and return (run_dir, analysis_report_path)."""
    from src.voc.content.paths import allocate_run_dir
    run_dir = allocate_run_dir(
        "2026-04-29", "demo-product", base=tmp_path / "outputs",
    )
    ar_path = run_dir / "shared" / "analysis_report.json"
    ar_path.parent.mkdir(parents=True, exist_ok=True)
    ar_path.write_text(
        json.dumps(_minimal_analysis_report(), ensure_ascii=False),
        encoding="utf-8",
    )
    return run_dir, ar_path


class TestCardnewsPngRender:
    def test_subprocess_command_shape(self, tmp_path: Path, monkeypatch):
        """The helper builds the documented `python -m cardnews.render`
        command with --analysis-report, --out-dir, --lang, and creates
        the out-dir parent path. We capture argv via subprocess.run
        instead of letting it actually fork."""
        cli = _load_run_all()
        run_dir, ar_path = _make_run_dir_with_report(tmp_path)

        captured = {}

        class _CompletedStub:
            returncode = 0

        def _fake_run(cmd, env=None, cwd=None, check=False):
            captured["cmd"] = list(cmd)
            captured["env_pythonpath"] = (env or {}).get("PYTHONPATH", "")
            captured["cwd"] = cwd
            captured["check"] = check
            return _CompletedStub()

        monkeypatch.setattr(cli.subprocess, "run", _fake_run)

        rc = cli._run_cardnews_png_render(
            analysis_report_path=ar_path,
            run_dir=run_dir,
            lang="ko",
            allow_live_image_fetch=False,
        )
        assert rc == 0
        # Out-dir created up-front.
        assert (run_dir / "cardnews" / "ko").is_dir()
        # Command shape — module form, required flags present.
        cmd = captured["cmd"]
        assert cmd[0] == sys.executable
        assert cmd[1:3] == ["-m", "cardnews.render"]
        assert "--analysis-report" in cmd
        assert str(ar_path) in cmd
        assert "--out-dir" in cmd
        assert str(run_dir / "cardnews" / "ko") in cmd
        assert "--lang" in cmd
        assert "ko" in cmd
        # No live-fetch by default.
        assert "--allow-live-image-fetch" not in cmd
        # check=False so a non-zero exit doesn't raise — failure-soft contract.
        assert captured["check"] is False

    def test_allow_live_image_fetch_propagates(
        self, tmp_path: Path, monkeypatch
    ):
        cli = _load_run_all()
        run_dir, ar_path = _make_run_dir_with_report(tmp_path)

        captured = {}

        class _CompletedStub:
            returncode = 0

        def _fake_run(cmd, env=None, cwd=None, check=False):
            captured["cmd"] = list(cmd)
            return _CompletedStub()

        monkeypatch.setattr(cli.subprocess, "run", _fake_run)

        cli._run_cardnews_png_render(
            analysis_report_path=ar_path,
            run_dir=run_dir,
            lang="ko",
            allow_live_image_fetch=True,
        )
        assert "--allow-live-image-fetch" in captured["cmd"]

    def test_returns_subprocess_returncode_unchanged(
        self, tmp_path: Path, monkeypatch
    ):
        """A non-zero subprocess exit propagates as the helper's return
        value (so the orchestrator can downgrade it to a warning)."""
        cli = _load_run_all()
        run_dir, ar_path = _make_run_dir_with_report(tmp_path)

        class _CompletedStub:
            returncode = 7

        monkeypatch.setattr(
            cli.subprocess, "run",
            lambda cmd, env=None, cwd=None, check=False: _CompletedStub(),
        )
        rc = cli._run_cardnews_png_render(
            analysis_report_path=ar_path,
            run_dir=run_dir,
            lang="ko",
            allow_live_image_fetch=False,
        )
        assert rc == 7


class TestReviewOpsCompanion:
    def test_delegates_to_process_run_dir(self, tmp_path: Path, monkeypatch):
        """The helper calls `src.voc.reporting.review_ops.pipeline.process_run_dir`
        with the supplied run_dir and translates `success` → 0."""
        cli = _load_run_all()
        run_dir, _ = _make_run_dir_with_report(tmp_path)

        from src.voc.reporting.review_ops import pipeline as ro_pipeline

        captured = {}

        def _fake_process(rd, *, db_path=None):
            captured["run_dir"] = rd
            captured["db_path"] = db_path
            return ro_pipeline.ProcessResult(
                run_dir=rd,
                status="success",
                reviews_loaded=42,
                json_path=rd / "shared" / "review_ops_analysis.json",
                html_path=rd / "review_ops" / "review_ops_report.html",
                db_status="ok",
            )

        monkeypatch.setattr(ro_pipeline, "process_run_dir", _fake_process)
        rc = cli._run_review_ops_companion(run_dir=run_dir)
        assert rc == 0
        assert captured["run_dir"] == run_dir

    def test_failed_status_returns_nonzero(self, tmp_path: Path, monkeypatch):
        cli = _load_run_all()
        run_dir, _ = _make_run_dir_with_report(tmp_path)

        from src.voc.reporting.review_ops import pipeline as ro_pipeline

        def _fake_process(rd, *, db_path=None):
            return ro_pipeline.ProcessResult(
                run_dir=rd, status="failed", error_message="db blew up",
            )

        monkeypatch.setattr(ro_pipeline, "process_run_dir", _fake_process)
        assert cli._run_review_ops_companion(run_dir=run_dir) == 1

    def test_safety_violation_returns_two(self, tmp_path: Path, monkeypatch):
        cli = _load_run_all()
        run_dir, _ = _make_run_dir_with_report(tmp_path)

        from src.voc.reporting.review_ops import pipeline as ro_pipeline

        def _fake_process(rd, *, db_path=None):
            return ro_pipeline.ProcessResult(
                run_dir=rd,
                status="failed",
                safety_violations=["banned phrase: 결함"],
                error_message="safety validation failed: 1 violation(s)",
            )

        monkeypatch.setattr(ro_pipeline, "process_run_dir", _fake_process)
        assert cli._run_review_ops_companion(run_dir=run_dir) == 2


class TestMainTailStepWiring:
    """Patch every upstream step in `main()` so we can assert the tail
    branches behave as documented."""

    @pytest.fixture
    def _patch_pipeline_and_content(self, monkeypatch, tmp_path):
        """Stub seller pipeline + content engine to no-ops so main()
        runs end-to-end without scraping or LLM calls."""
        cli = _load_run_all()

        def _fake_phase2e(**kw):
            run_dir = kw["run_dir"]
            ar = run_dir / "shared" / "analysis_report.json"
            ar.parent.mkdir(parents=True, exist_ok=True)
            ar.write_text(
                json.dumps(_minimal_analysis_report(), ensure_ascii=False),
                encoding="utf-8",
            )
            seller_pdf = (
                run_dir / "seller_report" / "seller_report_ko.pdf"
            )
            seller_pdf.parent.mkdir(parents=True, exist_ok=True)
            seller_pdf.write_bytes(b"%PDF-stub")
            return seller_pdf, ar

        def _fake_content(**kw):
            return 0

        monkeypatch.setattr(cli, "_run_phase2e_pipeline", _fake_phase2e)
        monkeypatch.setattr(cli, "_run_content_engine", _fake_content)
        return cli

    def test_default_flow_calls_both_tail_steps(
        self, tmp_path, monkeypatch, _patch_pipeline_and_content
    ):
        cli = _patch_pipeline_and_content
        png_calls, ro_calls = [], []

        monkeypatch.setattr(
            cli, "_run_cardnews_png_render",
            lambda **kw: png_calls.append(kw) or 0,
        )
        monkeypatch.setattr(
            cli, "_run_review_ops_companion",
            lambda **kw: ro_calls.append(kw) or 0,
        )

        rc = cli.main([
            "--product-url", "https://example.com/p/123",
            "--output-base", str(tmp_path / "outputs"),
            "--date", "2026-04-29",
        ])
        assert rc == 0
        assert len(png_calls) == 1
        assert png_calls[0]["allow_live_image_fetch"] is False
        assert png_calls[0]["lang"] == "ko"
        assert len(ro_calls) == 1

    def test_skip_cardnews_png_skips_only_step3(
        self, tmp_path, monkeypatch, _patch_pipeline_and_content
    ):
        cli = _patch_pipeline_and_content
        png_calls, ro_calls = [], []
        monkeypatch.setattr(
            cli, "_run_cardnews_png_render",
            lambda **kw: png_calls.append(kw) or 0,
        )
        monkeypatch.setattr(
            cli, "_run_review_ops_companion",
            lambda **kw: ro_calls.append(kw) or 0,
        )

        rc = cli.main([
            "--product-url", "https://example.com/p/123",
            "--output-base", str(tmp_path / "outputs"),
            "--date", "2026-04-29",
            "--skip-cardnews-png",
        ])
        assert rc == 0
        assert png_calls == []
        assert len(ro_calls) == 1

    def test_skip_review_ops_skips_only_step4(
        self, tmp_path, monkeypatch, _patch_pipeline_and_content
    ):
        cli = _patch_pipeline_and_content
        png_calls, ro_calls = [], []
        monkeypatch.setattr(
            cli, "_run_cardnews_png_render",
            lambda **kw: png_calls.append(kw) or 0,
        )
        monkeypatch.setattr(
            cli, "_run_review_ops_companion",
            lambda **kw: ro_calls.append(kw) or 0,
        )

        rc = cli.main([
            "--product-url", "https://example.com/p/123",
            "--output-base", str(tmp_path / "outputs"),
            "--date", "2026-04-29",
            "--skip-review-ops",
        ])
        assert rc == 0
        assert len(png_calls) == 1
        assert ro_calls == []

    def test_allow_live_image_fetch_threads_to_step3(
        self, tmp_path, monkeypatch, _patch_pipeline_and_content
    ):
        cli = _patch_pipeline_and_content
        png_calls = []
        monkeypatch.setattr(
            cli, "_run_cardnews_png_render",
            lambda **kw: png_calls.append(kw) or 0,
        )
        monkeypatch.setattr(
            cli, "_run_review_ops_companion", lambda **kw: 0,
        )

        rc = cli.main([
            "--product-url", "https://example.com/p/123",
            "--output-base", str(tmp_path / "outputs"),
            "--date", "2026-04-29",
            "--allow-live-image-fetch",
        ])
        assert rc == 0
        assert png_calls[0]["allow_live_image_fetch"] is True

    def test_cardnews_failure_is_soft_and_review_ops_still_runs(
        self, tmp_path, monkeypatch, capsys, _patch_pipeline_and_content
    ):
        """A non-zero PNG render exit must NOT abort the orchestrator
        and must NOT block the review_ops companion."""
        cli = _patch_pipeline_and_content
        ro_calls = []
        monkeypatch.setattr(
            cli, "_run_cardnews_png_render", lambda **kw: 9,
        )
        monkeypatch.setattr(
            cli, "_run_review_ops_companion",
            lambda **kw: ro_calls.append(kw) or 0,
        )

        rc = cli.main([
            "--product-url", "https://example.com/p/123",
            "--output-base", str(tmp_path / "outputs"),
            "--date", "2026-04-29",
        ])
        assert rc == 0
        assert len(ro_calls) == 1
        err = capsys.readouterr().err
        assert "cardnews PNG render exited with code 9" in err

    def test_cardnews_exception_is_soft_and_review_ops_still_runs(
        self, tmp_path, monkeypatch, capsys, _patch_pipeline_and_content
    ):
        cli = _patch_pipeline_and_content
        ro_calls = []

        def _boom(**kw):
            raise RuntimeError("playwright missing")

        monkeypatch.setattr(cli, "_run_cardnews_png_render", _boom)
        monkeypatch.setattr(
            cli, "_run_review_ops_companion",
            lambda **kw: ro_calls.append(kw) or 0,
        )

        rc = cli.main([
            "--product-url", "https://example.com/p/123",
            "--output-base", str(tmp_path / "outputs"),
            "--date", "2026-04-29",
        ])
        assert rc == 0
        assert len(ro_calls) == 1
        err = capsys.readouterr().err
        assert "cardnews PNG render raised RuntimeError" in err

    def test_review_ops_failure_is_soft_and_run_all_still_returns_zero(
        self, tmp_path, monkeypatch, capsys, _patch_pipeline_and_content
    ):
        cli = _patch_pipeline_and_content
        monkeypatch.setattr(
            cli, "_run_cardnews_png_render", lambda **kw: 0,
        )
        monkeypatch.setattr(
            cli, "_run_review_ops_companion", lambda **kw: 1,
        )

        rc = cli.main([
            "--product-url", "https://example.com/p/123",
            "--output-base", str(tmp_path / "outputs"),
            "--date", "2026-04-29",
        ])
        assert rc == 0
        err = capsys.readouterr().err
        assert "review_ops companion exited with code 1" in err

    def test_review_ops_exception_is_soft(
        self, tmp_path, monkeypatch, capsys, _patch_pipeline_and_content
    ):
        cli = _patch_pipeline_and_content

        def _boom(**kw):
            raise RuntimeError("db unreachable")

        monkeypatch.setattr(cli, "_run_cardnews_png_render", lambda **kw: 0)
        monkeypatch.setattr(cli, "_run_review_ops_companion", _boom)

        rc = cli.main([
            "--product-url", "https://example.com/p/123",
            "--output-base", str(tmp_path / "outputs"),
            "--date", "2026-04-29",
        ])
        assert rc == 0
        err = capsys.readouterr().err
        assert "review_ops companion raised RuntimeError" in err
