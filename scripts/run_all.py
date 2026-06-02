"""End-to-end VOC pipeline: product URL → seller PDF + buyer content.

One command:

    PYTHONPATH=. python3 scripts/run_all.py --product-url "<url>"

Flow:

  1. `.env` is auto-loaded (if `python-dotenv` is installed) so
     `OPENAI_API_KEY` (Stage 2) and `ANTHROPIC_API_KEY` (Phase D
     polish) reach the subprocesses without requiring `source .env`.
  2. A Phase-A run directory is allocated under `outputs/`:
        outputs/{YYYY-MM-DD}_{slug}_run-{NNN}/
  3. `run_phase2e_pipeline.py` is invoked as a subprocess. The seller
     PDF lands at `seller_report/seller_report_ko.pdf`; the v3.0
     `analysis_report.json` lands at `shared/analysis_report.json`
     (via the new `--emit-analysis-report-json` flag).
  4. `run_content.main()` is invoked in-process with `--run-dir <same>`
     so the brief, skeleton cardnews, and editorial cardnews land in
     the same run directory.
  5. `python -m cardnews.render` is invoked as a subprocess to
     rasterize the buyer cardnews into PNG pages under
     `cardnews/<lang>/`. Skipped via `--skip-cardnews-png`.
     Failure-soft: a render failure logs a warning and the
     orchestrator continues to the review_ops companion.
  6. `scripts/generate_review_ops_report.py` is invoked in-process
     against the same run dir to produce the operator-facing
     `shared/review_ops_analysis.json` and
     `review_ops/review_ops_report.html`. Skipped via
     `--skip-review-ops`. Failure-soft: a companion failure logs a
     warning and `run_all` still finishes with the base artifacts
     intact.

Failure isolation: each step writes its own status; a failure in
the content engine does not roll back the seller PDF, and a
failure in the seller pipeline cleanly aborts the orchestrator
with a non-zero exit code. Steps 5–6 are explicitly failure-soft:
their output is value-add on top of the seller PDF + buyer
cardnews JSON contract, never a precondition for it.

Pass-through flags
------------------
- `--skip-scrape`, `--stub-llm`, `--max-reviews`, `--multi-sort`,
  `--sort-type` are forwarded to `run_phase2e_pipeline.py`.
- `--no-llm`, `--llm-model`, `--llm-temperature`, `--polish-mode`,
  `--angle-mode`, `--style-seed`, `--max-retries` are forwarded to
  `run_content.py`.

Constraints
-----------
- No analysis-logic changes; the orchestrator never touches Phase 2E
  detector / Stage 2 / aggregation code.
- No DB writes from this file; subprocesses may write to the DB
  (Phase 2E scraper does), unchanged from prior behavior.
- Both `run_phase2e_pipeline.py` and `run_content.py` continue to
  work standalone — the orchestrator is purely additive.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.content.paths import (  # noqa: E402
    BUYER_CONTENT_SUBDIR,
    SELLER_REPORT_SUBDIR,
    SHARED_SUBDIR,
    allocate_run_dir,
    slugify,
)


PHASE2E_RUNNER = REPO / "scripts" / "run_phase2e_pipeline.py"
CONTENT_RUNNER = REPO / "scripts" / "run_content.py"
ANALYSIS_REPORT_FILENAME = "analysis_report.json"
COLLECTION_SUMMARY_FILENAME = "collection_summary.json"
SELLER_PDF_FILENAME = "seller_report_ko.pdf"
CARDNEWS_LANG = "ko"


# ---------------------------------------------------------------------------
# Environment / .env loading
# ---------------------------------------------------------------------------


def _load_dotenv_if_available() -> None:
    """Best-effort `.env` autoload. No-op when `python-dotenv` is
    missing or `.env` is absent. Existing env wins (override=False)
    so an explicit shell export beats a stale `.env` value."""
    env_path = REPO / ".env"
    if not env_path.is_file():
        return
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        return
    load_dotenv(env_path, override=False)


# ---------------------------------------------------------------------------
# Slug from URL or product name
# ---------------------------------------------------------------------------


def _derive_product_slug(url: str, product_name: str | None) -> str:
    """Derive a filesystem-safe slug. Prefers `--product-name`; falls
    back to the URL's `goodsNo` or last path segment.

    Pure delegation to `paths.slugify`. The fallback path returns
    `product-{12hex}` when no romanizable input survives — Korean
    product names with no ASCII tokens land here."""
    if product_name and product_name.strip():
        return slugify(product_name, source_url=url)
    return slugify(None, source_url=url)


# ---------------------------------------------------------------------------
# Subprocess invocation for the seller pipeline
# ---------------------------------------------------------------------------


def _run_phase2e_pipeline(
    *,
    url: str,
    run_dir: Path,
    product_name: str | None,
    product_slug: str,
    skip_scrape: bool,
    stub_llm: bool,
    max_reviews: str,
    multi_sort: bool,
    sort_type: str | None,
    corpus_mode: str = "observable_multi_sort",
    max_reviews_per_sort: str | None = None,
    max_total_reviews: int | None = None,
    wait_until_sort_loaded: bool = False,
    retry_queue_path: Path | None = None,
    human_check_timeout_seconds: int | None = None,
    human_check_poll_seconds: int | None = None,
    strict_retry_backoff_profile: str | None = None,
    strict_max_attempts: int | None = None,
    strict_confirm_before_retry: bool = False,
    strict_reset_session_on_block: bool = False,
    cdp_port: int = 9222,
    cdp_endpoint: str | None = None,
    extra_env: dict[str, str] | None = None,
) -> tuple[Path, Path]:
    """Invoke `run_phase2e_pipeline.py` as a subprocess.

    Returns `(seller_pdf_path, analysis_report_json_path)` — both
    are absolute paths under `run_dir`.

    Raises `subprocess.CalledProcessError` when the runner exits
    non-zero. The orchestrator translates that into its own exit.

    `corpus_mode` semantics:
      observable_multi_sort  → analysis corpus = merged-across-sorts
                                (consumer-observable review space)
      primary_only           → analysis corpus = DATETIME_DESC only
                                (legacy / unbiased-distribution-safe)
    """
    seller_pdf = run_dir / SELLER_REPORT_SUBDIR / SELLER_PDF_FILENAME
    analysis_report = run_dir / SHARED_SUBDIR / ANALYSIS_REPORT_FILENAME
    collection_summary = run_dir / SHARED_SUBDIR / COLLECTION_SUMMARY_FILENAME
    seller_pdf.parent.mkdir(parents=True, exist_ok=True)
    analysis_report.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        str(PHASE2E_RUNNER),
        url,
        "--out-pdf", str(seller_pdf),
        "--emit-analysis-report-json", str(analysis_report),
        "--emit-collection-summary-json", str(collection_summary),
        "--analysis-report-source-url", url,
        "--analysis-report-product-slug", product_slug,
        "--max-reviews", str(max_reviews),
        "--corpus-mode", corpus_mode,
    ]
    if product_name:
        cmd.extend(["--product-name", product_name])
    if skip_scrape:
        cmd.append("--skip-scrape")
    if stub_llm:
        cmd.append("--stub-llm")
    # observable_multi_sort implies --multi-sort inside phase2e runner.
    # Single-sort mode only fires when explicitly requested AND corpus_mode
    # is primary_only (the runner enforces mutual exclusion).
    if corpus_mode == "observable_multi_sort":
        cmd.append("--multi-sort")
    elif multi_sort:
        cmd.append("--multi-sort")
    elif sort_type:
        cmd.extend(["--sort-type", sort_type])
    if max_reviews_per_sort is not None:
        cmd.extend(["--max-reviews-per-sort", str(max_reviews_per_sort)])
    if max_total_reviews is not None:
        cmd.extend(["--max-total-reviews", str(max_total_reviews)])
    if wait_until_sort_loaded:
        cmd.append("--wait-until-sort-loaded")
    if retry_queue_path is not None:
        cmd.extend(["--retry-queue-path", str(retry_queue_path)])
    if human_check_timeout_seconds is not None:
        cmd.extend(["--human-check-timeout-seconds", str(int(human_check_timeout_seconds))])
    if human_check_poll_seconds is not None:
        cmd.extend(["--human-check-poll-seconds", str(int(human_check_poll_seconds))])
    if strict_retry_backoff_profile is not None:
        cmd.extend(["--strict-retry-backoff-profile", str(strict_retry_backoff_profile)])
    if strict_max_attempts is not None:
        cmd.extend(["--strict-max-attempts", str(int(strict_max_attempts))])
    if strict_confirm_before_retry:
        cmd.append("--strict-confirm-before-retry")
    if strict_reset_session_on_block:
        cmd.append("--strict-reset-session-on-block")
    # Browser CDP plumbing. The phase2e subprocess writes the manifest
    # whose `defaults.cdp_endpoint` points the Playwright-bundled
    # Chromium scraper at the right port. Passing the endpoint
    # explicitly avoids a hardcoded `localhost:9222` mismatch when the
    # operator launches the preflight on a different port.
    cdp_endpoint_val = cdp_endpoint or f"http://127.0.0.1:{int(cdp_port)}"
    cmd.extend(["--cdp-endpoint", cdp_endpoint_val])

    env = os.environ.copy()
    env["PYTHONPATH"] = str(REPO)
    # Force unbuffered Python stdout in the subprocess so per-sort
    # progress lines reach the captured log live. Two prior triages
    # (O-001 stream timeout, O-002 fwee "wedge") were misdiagnosed
    # because this log was 0 bytes during a long-running step. See
    # ops/agent_handoffs/O-002-FWEE-WEDGE-TRIAGE.md.
    env["PYTHONUNBUFFERED"] = "1"
    if extra_env:
        env.update(extra_env)

    print(f"[orchestrator] phase2e command:")
    print(f"  {' '.join(cmd)}")
    subprocess.run(cmd, env=env, cwd=str(REPO), check=True)
    return seller_pdf, analysis_report


# ---------------------------------------------------------------------------
# In-process invocation for the content engine
# ---------------------------------------------------------------------------


def _load_run_content() -> object:
    """Load `scripts/run_content.py` as a module without requiring
    `scripts/__init__.py`. Mirrors the test-side loader."""
    spec = importlib.util.spec_from_file_location(
        "_run_content_for_orchestrator", CONTENT_RUNNER,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_content_engine(
    *,
    analysis_report_path: Path,
    run_dir: Path,
    no_llm: bool,
    llm_model: str | None,
    llm_temperature: float | None,
    polish_mode: str,
    angle_mode: str,
    style_seed: int | None,
    max_retries: int,
) -> int:
    """Invoke `run_content.main()` in-process so the existing run
    directory is reused via `--run-dir`."""
    cli = _load_run_content()
    argv = [
        "--report", str(analysis_report_path),
        "--run-dir", str(run_dir),
        "--lang", "ko",
        "--channels", "instagram",
        "--polish-mode", polish_mode,
        "--angle-mode", angle_mode,
        "--max-retries", str(max_retries),
    ]
    if no_llm:
        argv.append("--no-llm")
    if llm_model:
        argv.extend(["--llm-model", llm_model])
    if llm_temperature is not None:
        argv.extend(["--llm-temperature", str(llm_temperature)])
    if style_seed is not None:
        argv.extend(["--style-seed", str(style_seed)])

    print(f"[orchestrator] content_engine argv: {argv}")
    return cli.main(argv)


# ---------------------------------------------------------------------------
# Step 3 — cardnews PNG rasterization (subprocess to cardnews.render)
# ---------------------------------------------------------------------------


def _run_cardnews_png_render(
    *,
    analysis_report_path: Path,
    run_dir: Path,
    lang: str = CARDNEWS_LANG,
    allow_live_image_fetch: bool = False,
) -> int:
    """Invoke `python -m cardnews.render` as a subprocess.

    Writes pages/, manifest.json, layout.json, content_plan.json
    under `<run_dir>/cardnews/<lang>/`. Returns the subprocess exit
    code; the caller treats non-zero as a soft failure.
    """
    out_dir = run_dir / "cardnews" / lang
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, "-m", "cardnews.render",
        "--analysis-report", str(analysis_report_path),
        "--out-dir", str(out_dir),
        "--lang", lang,
    ]
    if allow_live_image_fetch:
        cmd.append("--allow-live-image-fetch")

    env = os.environ.copy()
    env["PYTHONPATH"] = (
        str(REPO) + os.pathsep + env.get("PYTHONPATH", "")
    ).rstrip(os.pathsep)
    # Same observability rationale as the phase2e launch above —
    # unbuffered stdout so cardnews.render progress is visible in
    # captured logs.
    env["PYTHONUNBUFFERED"] = "1"

    print("[orchestrator] cardnews.render command:")
    print(f"  {' '.join(cmd)}")
    completed = subprocess.run(cmd, env=env, cwd=str(REPO), check=False)
    return completed.returncode


# ---------------------------------------------------------------------------
# Step 4 — review_ops companion (in-process; never raises)
# ---------------------------------------------------------------------------


def _run_review_ops_companion(*, run_dir: Path) -> int:
    """Invoke the review_ops pipeline in-process.

    `process_run_dir` is the same function `scripts/generate_review_ops_report.py`
    delegates to, and it never raises — failures come back as
    `result.status in {"failed", "skipped"}`. Returns 0 on success,
    1 on skip (missing analysis_report), 2 on safety violation, and
    1 on any other failure (mirrors the standalone CLI).
    """
    from src.voc.reporting.review_ops.pipeline import process_run_dir
    print(f"[orchestrator] review_ops --run-dir {run_dir}")
    result = process_run_dir(run_dir)
    if result.status == "success":
        print(
            f"[orchestrator] review_ops db_status={result.db_status} "
            f"reviews_loaded={result.reviews_loaded}"
        )
        print(f"[orchestrator] review_ops json     → {result.json_path}")
        print(f"[orchestrator] review_ops html     → {result.html_path}")
        return 0
    if result.status == "skipped":
        print(
            f"[orchestrator] review_ops skipped: {result.error_message}",
            file=sys.stderr,
        )
        return 1
    if result.safety_violations:
        print(
            f"[orchestrator] review_ops safety failed: "
            f"{len(result.safety_violations)} violation(s)",
            file=sys.stderr,
        )
        for line in result.safety_violations:
            print(f"  - {line}", file=sys.stderr)
        return 2
    print(
        f"[orchestrator] review_ops failed: {result.error_message}",
        file=sys.stderr,
    )
    return 1


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="run_all",
        description=(
            "End-to-end VOC pipeline: product URL → seller PDF + "
            "buyer content, all under a single run directory."
        ),
    )
    p.add_argument("--product-url", required=True,
                   help="OliveYoung product URL or bare goodsNo.")
    p.add_argument("--product-name", default=None,
                   help="Override product name (otherwise derived from DB metadata).")
    # ----- Seller pipeline pass-through -----
    p.add_argument("--max-reviews", default="200",
                   help="Max reviews per product (passed to scraper). Default 200.")
    p.add_argument("--skip-scrape", action="store_true",
                   help="Skip scraping; use whatever rows are already in DB.")
    p.add_argument("--stub-llm", action="store_true",
                   help="Use deterministic stub for Stage 2 (no OpenAI calls).")
    p.add_argument("--multi-sort", action="store_true",
                   help="Run primary + 4 signal-sort scrapes (Phase 2E). "
                        "Implied by --corpus-mode=observable_multi_sort.")
    p.add_argument("--sort-type", default=None,
                   help="Single-sort mode for Phase 2E. Ignored when "
                        "--multi-sort or --corpus-mode=observable_multi_sort is set.")
    p.add_argument(
        "--corpus-mode",
        choices=("observable_multi_sort", "primary_only"),
        default="observable_multi_sort",
        help=(
            "How to build the analysis corpus from multi-sort scrapes:\n"
            "  observable_multi_sort  — merged across all sorts (default). "
            "Reflects the review space a consumer can reach by switching "
            "sort tabs. Designed for issue/strength discovery; not for "
            "estimating unbiased rating distribution.\n"
            "  primary_only           — DATETIME_DESC only; signal sorts "
            "kept as evidence pool (legacy)."
        ),
    )
    p.add_argument(
        "--max-reviews-per-sort", default=None,
        help="Per-sort cap under --corpus-mode=observable_multi_sort. "
             "Default: 'all' for primary, 50 for signal sorts. Pass an int "
             "to apply uniformly.",
    )
    p.add_argument(
        "--max-total-reviews", type=int, default=None,
        help="Optional post-merge cap on the deduplicated corpus. "
             "Most-recent-first by review_date. None = no cap.",
    )
    p.add_argument(
        "--wait-until-sort-loaded", "--no-skip-sorts",
        dest="wait_until_sort_loaded", action="store_true",
        help="Strict per-sort retry: keep retrying each sort until it loads, "
             "with indefinite human-check wait. Disables the retry queue. "
             "Ctrl+C aborts.",
    )
    p.add_argument(
        "--retry-queue-path", type=Path, default=None,
        help="Where the orchestrator appends failed sorts in non-strict mode. "
             "Default: <repo>/retry_queue.json (set by phase2e runner).",
    )
    p.add_argument(
        "--human-check-timeout-seconds", type=int, default=None,
        help="Max seconds to wait for an operator to clear an anti-bot / "
             "human-verification page in Chrome. 0 = wait indefinitely. "
             "Default 900 (15 min) when omitted.",
    )
    p.add_argument(
        "--human-check-poll-seconds", type=int, default=None,
        help="DOM poll interval (seconds) while waiting for the human check. "
             "Default 5 when omitted.",
    )
    p.add_argument(
        "--strict-retry-backoff-profile",
        choices=("conservative", "normal", "fast"),
        default=None,
        help="Strict-mode retry backoff. conservative (default) waits "
             "minutes between retries; fast is the legacy 3–6s loop "
             "(opt-in for tests only).",
    )
    p.add_argument(
        "--strict-max-attempts", type=int, default=None,
        help="Cap on per-sort retry attempts in strict mode. 0 = infinite "
             "(default).",
    )
    p.add_argument(
        "--strict-confirm-before-retry", action="store_true",
        help="Skip the timed strict backoff and prompt for Enter before "
             "every retry. Interactive mode.",
    )
    p.add_argument(
        "--strict-reset-session-on-block", action="store_true",
        help="On anti_bot / anonymous_auth_wall / human_check_timeout in "
             "strict mode, the next subprocess creates a fresh CDP context "
             "(cookies/localStorage NOT reused; manual re-login required). "
             "Skips false_empty and plain scraper failures.",
    )
    # ----- Content engine pass-through -----
    p.add_argument("--no-llm", action="store_true",
                   help="Skip the editorial LLM polish entirely.")
    p.add_argument("--llm-model", default=None,
                   help="Override Anthropic model id for Phase D polish.")
    p.add_argument("--llm-temperature", type=float, default=None,
                   help="Override Anthropic sampling temperature.")
    p.add_argument("--polish-mode", default="full", choices=("full", "hook_only"),
                   help="Phase D polish scope. Default: full.")
    p.add_argument("--angle-mode", default="auto",
                   choices=("auto", "strength_first", "tradeoff_first",
                            "risk_first", "segment_first"),
                   help="How to pick the editorial angle. Default: auto.")
    p.add_argument("--style-seed", type=int, default=None,
                   help="Optional integer seed for phrasing variation.")
    p.add_argument("--max-retries", type=int, default=1,
                   help="Polish retry budget. Default: 1.")
    # ----- Orchestrator-level -----
    p.add_argument("--output-base", type=Path, default=REPO / "outputs",
                   help="Base directory for run dirs.")
    p.add_argument("--run-dir", type=Path, default=None,
                   help="Existing run directory to (re-)render into. "
                        "If omitted, a new dir is allocated.")
    p.add_argument("--date", default=None,
                   help="UTC date prefix YYYY-MM-DD for new run dirs (default: today UTC).")
    # ----- Tail-step toggles (failure-soft companions) -----
    p.add_argument(
        "--skip-cardnews-png", action="store_true",
        help="Skip step 5 — cardnews PNG rasterization. Useful on hosts "
             "without Playwright / chromium-headless-shell installed. The "
             "buyer cardnews JSON is still produced by step 4.",
    )
    p.add_argument(
        "--skip-review-ops", action="store_true",
        help="Skip step 6 — operator-facing review_ops companion "
             "(shared/review_ops_analysis.json + review_ops/review_ops_report.html).",
    )
    p.add_argument(
        "--allow-live-image-fetch", action="store_true",
        help="Pass-through to cardnews.render. Allows live HTTP fetches "
             "of product image URLs at render time. OFF by default — "
             "publication renders should run offline against pre-fetched "
             "assets in <run>/assets/. Enable only for ad-hoc dev runs.",
    )
    # ----- Chrome debug preflight ----------------------------------
    # Optional. When set, the orchestrator probes the CDP endpoint
    # before scraping; if it's not up, Chrome is launched with the
    # configured profile and the orchestrator waits for readiness.
    # Without these flags, behavior is unchanged — operator is
    # responsible for opening Chrome manually.
    p.add_argument(
        "--ensure-chrome-debug", action="store_true",
        help="Verify a Chrome CDP endpoint is reachable before "
             "scraping; launch Chrome if not. macOS-tested. Default "
             "off — set this to enable the preflight.",
    )
    p.add_argument(
        "--chrome-debug-browser",
        choices=("playwright_chromium", "system_chrome"),
        default="playwright_chromium",
        help=(
            "Which browser the CDP preflight should use:\n"
            "  playwright_chromium (default) — Playwright's bundled "
            "Chromium (Chrome for Testing). Working CDP attach path "
            "for OliveYoung. Default profile dir: ~/chrome-oy-profile-pw.\n"
            "  system_chrome — System Google Chrome. Note: Chrome 147+ "
            "is a known-bad CDP attach path for the OY scraper "
            "(Browser.setDownloadBehavior wall — see "
            "docs/oy_cdp_attach_compatibility.md). Use only when you "
            "explicitly want the legacy path."
        ),
    )
    p.add_argument(
        "--chrome-debug-port", type=int, default=9222,
        help="CDP port for the preflight check (default 9222).",
    )
    p.add_argument(
        "--chrome-profile-dir", type=Path, default=None,
        help="Chrome user-data-dir for the OY debug session. When "
             "omitted, the default depends on --chrome-debug-browser: "
             "~/chrome-oy-profile-pw for playwright_chromium, "
             "~/chrome-oy-profile for system_chrome.",
    )
    p.add_argument(
        "--reset-oy-chrome-profile", action="store_true",
        help="Before launching, archive the current Chrome profile "
             "to `<dir>_broken_<UTC ts>` and create a fresh one. "
             "Refuses while Chrome is running. Implies "
             "--ensure-chrome-debug. Never deletes the old profile.",
    )
    p.add_argument(
        "--chrome-debug-timeout-sec", type=int, default=20,
        help="How long to wait for CDP readiness when launching "
             "Chrome (default 20s).",
    )
    p.add_argument(
        "--ignore-chrome-profile-mismatch", action="store_true",
        help="By default, the preflight refuses to proceed when CDP "
             "is running with a profile dir that DIFFERS from "
             "--chrome-profile-dir (likely an orphan Chrome process). "
             "Pass this flag to attach anyway. The unverified case "
             "(profile_dir cannot be determined) is always a warning, "
             "not a refusal.",
    )
    return p.parse_args(argv)


def _resolve_profile_dir(args) -> Path:
    """Resolve the effective Chrome profile dir.

    When `--chrome-profile-dir` is unset, default by browser mode:
    `playwright_chromium` → `~/chrome-oy-profile-pw`
    `system_chrome`       → `~/chrome-oy-profile`
    """
    if args.chrome_profile_dir is not None:
        return Path(args.chrome_profile_dir).expanduser()
    from src.voc.connectors.oy_chrome_debug import (
        DEFAULT_PROFILE_DIR_BY_MODE,
    )
    return DEFAULT_PROFILE_DIR_BY_MODE[args.chrome_debug_browser]


def _run_chrome_debug_preflight(args) -> None:
    """Mode-aware Chrome / Chromium debug preflight.

    Triggers when `--ensure-chrome-debug` or `--reset-oy-chrome-profile`
    is passed. Calls into `src.voc.connectors.oy_chrome_debug.
    ensure_browser_for_mode` which encapsulates:
      - probe `/json/version`
      - reject Chrome 147 under playwright_chromium mode
      - launch the bundled Chromium (or system Chrome) when CDP is down

    Always prints a structured log block:
        [preflight]   browser_mode  : playwright_chromium
        [preflight]   profile_dir   : /Users/.../chrome-oy-profile-pw
        [preflight]   cdp_endpoint  : http://127.0.0.1:9222
        [preflight]   browser       : Chrome/143.0.... (Chrome for Testing)
        [preflight]   action        : reused | launched | failed | rejected

    On failure or rejection, raises SystemExit with an operator-readable
    error and an exact `open_oy_chromium_debug.py` recovery hint.
    """
    from src.voc.connectors.oy_chrome_debug import (
        BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
        ChromeDebugError,
        check_profile_path_consistency,
        ensure_browser_for_mode,
    )
    profile_dir = _resolve_profile_dir(args)
    args.chrome_profile_dir = profile_dir  # normalize for downstream callers
    cdp_endpoint = f"http://127.0.0.1:{int(args.chrome_debug_port)}"

    print("[preflight] checking browser CDP endpoint...")
    print(f"[preflight]   browser_mode  : {args.chrome_debug_browser}")
    print(f"[preflight]   profile_dir   : {profile_dir}")
    print(f"[preflight]   cdp_endpoint  : {cdp_endpoint}")
    pp = check_profile_path_consistency(profile_dir)
    if pp["warnings"]:
        for w in pp["warnings"]:
            print(f"[preflight]   ⚠ {w}")

    try:
        result = ensure_browser_for_mode(
            mode=args.chrome_debug_browser,
            profile_dir=profile_dir,
            port=args.chrome_debug_port,
            timeout_sec=int(args.chrome_debug_timeout_sec),
            url=args.product_url,
            reset=bool(args.reset_oy_chrome_profile),
        )
    except (FileNotFoundError, ChromeDebugError) as e:
        print(f"✗ [preflight] {e}", file=sys.stderr)
        raise SystemExit(2)

    if result.get("archive_path"):
        print(
            f"[preflight] previous profile archived → "
            f"{result['archive_path']}"
        )

    browser_string = result.get("browser_string") or "—"
    print(f"[preflight]   browser       : {browser_string}")

    state = result.get("state")
    attached = result.get("attached_profile_dir")

    if state == "incompatible_endpoint":
        # The endpoint is reachable but unsuitable for this mode — most
        # commonly system Chrome 147 under playwright_chromium. Refuse
        # rather than silently scraping with a broken attach path.
        print(f"[preflight]   action        : rejected", file=sys.stderr)
        print(
            f"✗ [preflight] {result.get('incompatible_reason')}",
            file=sys.stderr,
        )
        if args.chrome_debug_browser == BROWSER_MODE_PLAYWRIGHT_CHROMIUM:
            print(
                f"  Recovery: quit the existing Chrome on port "
                f"{args.chrome_debug_port}, then run\n"
                f"    PYTHONPATH=. python3 scripts/open_oy_chromium_debug.py \\\n"
                f"      --profile-dir {profile_dir} --port "
                f"{args.chrome_debug_port} --wait",
                file=sys.stderr,
            )
        raise SystemExit(2)

    if state == "already_running":
        print("[preflight]   action        : reused")
        return
    if state == "already_running_unverified":
        print("[preflight]   action        : reused (profile unverified)")
        print(
            "[preflight] CDP is already running, but profile_dir "
            "could not be verified."
        )
        print(
            f"[preflight] If this is not your intended {profile_dir}, "
            f"quit Chrome and rerun."
        )
        return
    if state == "already_running_mismatched_profile":
        print("[preflight]   action        : rejected (profile mismatch)",
              file=sys.stderr)
        print(
            "[preflight] ✗ CDP is running with a DIFFERENT profile "
            "than requested.",
            file=sys.stderr,
        )
        print(f"[preflight]   requested: {profile_dir}", file=sys.stderr)
        print(f"[preflight]   attached : {attached}", file=sys.stderr)
        if args.ignore_chrome_profile_mismatch:
            print(
                "[preflight]   continuing anyway "
                "(--ignore-chrome-profile-mismatch).",
                file=sys.stderr,
            )
            return
        print(
            "[preflight] Quit Chrome (Cmd+Q on macOS, fully — not "
            "just close the window) and rerun, OR pass "
            "--ignore-chrome-profile-mismatch to attach to the "
            "existing Chrome.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    if state == "launched":
        print(f"[preflight]   action        : launched (pid={result['pid']})")
        # First-launch hint for the bundled-Chromium path: the OY
        # session does NOT carry over from system Chrome, so the
        # operator needs to log in inside the freshly launched window.
        if args.chrome_debug_browser == BROWSER_MODE_PLAYWRIGHT_CHROMIUM:
            print(
                "[preflight] reminder: this is the Playwright-bundled "
                "Chromium, NOT your system Chrome. Sign in to "
                "OliveYoung inside the launched window before scraping "
                "if the session is anonymous."
            )
        else:
            print(
                "[preflight] reminder: if this is a fresh profile, "
                "sign into OliveYoung in the launched Chrome window "
                "before scraping."
            )
        return
    if state == "failed":
        err = result.get("error") or "unknown failure"
        print(f"[preflight]   action        : failed", file=sys.stderr)
        print(f"✗ [preflight] {err}", file=sys.stderr)
        if args.chrome_debug_browser == BROWSER_MODE_PLAYWRIGHT_CHROMIUM:
            print(
                f"  Try: PYTHONPATH=. python3 scripts/open_oy_chromium_debug.py "
                f"--profile-dir {profile_dir} "
                f"--port {args.chrome_debug_port} --wait",
                file=sys.stderr,
            )
        else:
            print(
                f"  Try: PYTHONPATH=. python3 scripts/open_oy_chrome_debug.py "
                f"--profile-dir {profile_dir} "
                f"--port {args.chrome_debug_port} --wait",
                file=sys.stderr,
            )
        raise SystemExit(2)
    # Unexpected state — defensive fallback.
    print(f"✗ [preflight] unexpected state: {state!r}", file=sys.stderr)
    raise SystemExit(2)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    _load_dotenv_if_available()

    slug = _derive_product_slug(args.product_url, args.product_name)
    if args.run_dir:
        run_dir = args.run_dir.resolve()
        if not run_dir.is_dir():
            raise SystemExit(f"--run-dir does not exist: {run_dir}")
        for sub in (SHARED_SUBDIR, f"{SHARED_SUBDIR}/provenance",
                    SELLER_REPORT_SUBDIR, BUYER_CONTENT_SUBDIR):
            (run_dir / sub).mkdir(parents=True, exist_ok=True)
    else:
        date_str = args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        run_dir = allocate_run_dir(date_str, slug, base=args.output_base)

    print(f"[orchestrator] run_dir = {run_dir}")
    print(f"[orchestrator] slug    = {slug}")

    # Step 0 — Chrome debug preflight (optional).
    # Reset implies ensure: if the operator asked to reset the
    # profile, they intend to run scraping next, so we also need to
    # bring Chrome up afterward.
    if args.reset_oy_chrome_profile or args.ensure_chrome_debug:
        _run_chrome_debug_preflight(args)

    # Step 1 — seller pipeline (writes PDF + analysis_report.json into run_dir)
    seller_pdf, analysis_report = _run_phase2e_pipeline(
        url=args.product_url,
        run_dir=run_dir,
        product_name=args.product_name,
        product_slug=slug,
        skip_scrape=args.skip_scrape,
        stub_llm=args.stub_llm,
        max_reviews=args.max_reviews,
        multi_sort=args.multi_sort,
        sort_type=args.sort_type,
        corpus_mode=args.corpus_mode,
        max_reviews_per_sort=args.max_reviews_per_sort,
        max_total_reviews=args.max_total_reviews,
        wait_until_sort_loaded=args.wait_until_sort_loaded,
        retry_queue_path=args.retry_queue_path,
        human_check_timeout_seconds=args.human_check_timeout_seconds,
        human_check_poll_seconds=args.human_check_poll_seconds,
        strict_retry_backoff_profile=args.strict_retry_backoff_profile,
        strict_max_attempts=args.strict_max_attempts,
        strict_confirm_before_retry=args.strict_confirm_before_retry,
        strict_reset_session_on_block=args.strict_reset_session_on_block,
        cdp_port=int(args.chrome_debug_port),
    )
    print(f"[orchestrator] seller PDF          → {seller_pdf}")
    print(f"[orchestrator] analysis_report.json → {analysis_report}")

    if not analysis_report.is_file():
        raise SystemExit(
            f"phase2e runner returned 0 but did not write "
            f"{analysis_report}; cannot run content engine."
        )

    # Step 2 — content engine (in-process; --run-dir reuses the same dir)
    rc = _run_content_engine(
        analysis_report_path=analysis_report,
        run_dir=run_dir,
        no_llm=args.no_llm,
        llm_model=args.llm_model,
        llm_temperature=args.llm_temperature,
        polish_mode=args.polish_mode,
        angle_mode=args.angle_mode,
        style_seed=args.style_seed,
        max_retries=args.max_retries,
    )
    if rc != 0:
        raise SystemExit(f"content engine exited with code {rc}")

    manifest_path = run_dir / "manifest.json"
    print(f"[orchestrator] manifest             → {manifest_path}")

    # Step 3 — cardnews PNG rasterization (failure-soft).
    if args.skip_cardnews_png:
        print("[orchestrator] cardnews PNG render SKIPPED (--skip-cardnews-png)")
    else:
        try:
            png_rc = _run_cardnews_png_render(
                analysis_report_path=analysis_report,
                run_dir=run_dir,
                lang=CARDNEWS_LANG,
                allow_live_image_fetch=args.allow_live_image_fetch,
            )
            if png_rc != 0:
                print(
                    f"⚠ [orchestrator] cardnews PNG render exited with "
                    f"code {png_rc} — continuing to review_ops.",
                    file=sys.stderr,
                )
            else:
                print(
                    f"[orchestrator] cardnews PNGs        → "
                    f"{run_dir / 'cardnews' / CARDNEWS_LANG}"
                )
        except Exception as exc:  # noqa: BLE001 — failure-soft tail step
            print(
                f"⚠ [orchestrator] cardnews PNG render raised "
                f"{type(exc).__name__}: {exc} — continuing to review_ops.",
                file=sys.stderr,
            )

    # Step 4 — review_ops companion (failure-soft).
    if args.skip_review_ops:
        print("[orchestrator] review_ops companion SKIPPED (--skip-review-ops)")
    else:
        try:
            ro_rc = _run_review_ops_companion(run_dir=run_dir)
            if ro_rc != 0:
                print(
                    f"⚠ [orchestrator] review_ops companion exited with "
                    f"code {ro_rc} — base artifacts remain intact.",
                    file=sys.stderr,
                )
        except Exception as exc:  # noqa: BLE001 — failure-soft tail step
            print(
                f"⚠ [orchestrator] review_ops companion raised "
                f"{type(exc).__name__}: {exc} — base artifacts remain intact.",
                file=sys.stderr,
            )

    print(f"[orchestrator] done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
