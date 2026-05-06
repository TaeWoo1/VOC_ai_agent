"""Live validation of `--retry-failed-from-summary` recovery.

Reads an existing run dir's `collection_summary.json`, snapshots the
prior state for rollback safety, then optionally invokes the
phase2e pipeline retrying ONLY the sorts the prior run recorded as
`sorts_failed`. After the retry it republishes the run artifacts
(analysis_report, buyer_journey_cardnews, seller PDF, manifest) and
prints a before/after table covering:

  - retry attempted sorts
  - recovery_actions per sort
  - raw_records_seen_by_sort  (before / after)
  - rows_inserted_by_sort     (before / after)
  - review_count_analyzed     (before / after)
  - whether RATING_ASC / RECOMMENDED_DESC recovered
  - whether negative_signal_coverage can be upgraded from `degraded`

Modes
-----

    --dry-run    show the planned command + before-state. Does NOT
                 invoke the scraper / Stage 2. Use this to sanity-check
                 the wiring before a live invocation.

    --live       actually run the retry pipeline. Requires:
                   * Chrome / Playwright Chromium attached on CDP
                   * Operator logged into OliveYoung in the CDP browser
                   * OPENAI_API_KEY for Stage 2 (or pass --stub-llm)

Usage
-----

    # 1. Dry-run sanity check.
    PYTHONPATH=. python3 scripts/validate_retry_recovery.py \\
        --run-dir outputs/2026-05-02_product-83743e299623_run-003 \\
        --dry-run

    # 2. Live retry — requires browser + LLM.
    PYTHONPATH=. python3 scripts/validate_retry_recovery.py \\
        --run-dir outputs/2026-05-02_product-83743e299623_run-003 \\
        --live

    # 3. Live retry under stub LLM (no OpenAI calls; PDF and
    #    cardnews regenerate but Stage 2 outcomes are deterministic
    #    stubs).
    PYTHONPATH=. python3 scripts/validate_retry_recovery.py \\
        --run-dir outputs/2026-05-02_product-83743e299623_run-003 \\
        --live --stub-llm

Snapshots / rollback
--------------------

The prior `collection_summary.json` and `analysis_report.json` are
copied into `<run_dir>/shared/_pre_retry_snapshot/<UTC ts>/` BEFORE
the retry runs. Rollback is a manual `cp` from that directory back
into `shared/`.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))


# Sorts whose recovery the pass-5 contract specifically calls out.
_TARGETED_SORTS: tuple[str, ...] = ("RATING_ASC", "RECOMMENDED_DESC")


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _per_sort_metric(summary: dict, sort_type: str, field: str) -> int:
    table = summary.get(field) or {}
    val = table.get(sort_type)
    if val is None:
        return 0
    try:
        return int(val)
    except (TypeError, ValueError):
        return 0


def _per_sort_status(summary: dict, sort_type: str) -> str | None:
    per = summary.get("per_sort") or {}
    entry = per.get(sort_type) or {}
    return entry.get("status")


def _per_sort_recovery_actions(summary: dict, sort_type: str) -> list[str]:
    per = summary.get("per_sort") or {}
    entry = per.get(sort_type) or {}
    return list(entry.get("recovery_actions") or [])


def _negative_signal_coverage(report_path: Path) -> str | None:
    try:
        report = _load_json(report_path)
    except (OSError, json.JSONDecodeError):
        return None
    axes = (report.get("corpus") or {}).get("confidence_axes") or {}
    return ((axes.get("negative_signal_coverage") or {}).get("level"))


def _review_count_analyzed(report_path: Path) -> int | None:
    try:
        report = _load_json(report_path)
    except (OSError, json.JSONDecodeError):
        return None
    n = (report.get("corpus") or {}).get("n_reviews_analyzed")
    try:
        return int(n) if n is not None else None
    except (TypeError, ValueError):
        return None


def _snapshot_prior_state(run_dir: Path) -> Path:
    """Copy prior collection_summary + analysis_report + manifest into
    a timestamped snapshot dir. Caller can roll back manually."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    snap_root = run_dir / "shared" / "_pre_retry_snapshot" / ts
    snap_root.mkdir(parents=True, exist_ok=True)
    for rel in (
        "shared/collection_summary.json",
        "shared/analysis_report.json",
        "manifest.json",
    ):
        src = run_dir / rel
        if src.is_file():
            dst = snap_root / Path(rel).name
            shutil.copy2(src, dst)
    return snap_root


def _preflight_checks(*, cdp_port: int) -> list[str]:
    """Return a list of operator-readable warnings — empty list = green
    light. Pass-7 surfaces:
      * CDP browser version (must be Playwright Chromium 143.x ideally)
      * login state observed via /json/version probe
      * OPENAI_API_KEY presence (or --stub-llm)
    """
    issues: list[str] = []
    # CDP browser identity.
    try:
        from src.voc.connectors.oy_chrome_debug import (
            get_browser_version_string,
            classify_browser,
        )
        browser_string = get_browser_version_string(cdp_port)
        if not browser_string:
            issues.append(
                f"CDP endpoint http://127.0.0.1:{cdp_port} does NOT respond "
                f"with a Chrome /json/version. Start the bundled Chromium "
                f"with scripts/open_oy_chromium_debug.py first."
            )
        else:
            cls = classify_browser(browser_string)
            major = cls.get("major")
            if cls.get("is_chrome_for_testing") or major == 143:
                pass  # ideal
            elif major and major >= 147:
                issues.append(
                    f"CDP endpoint reports {browser_string!r} — system "
                    f"Chrome {major} is the known-bad attach path. "
                    f"Switch to the Playwright bundled Chromium."
                )
            else:
                issues.append(
                    f"CDP endpoint reports {browser_string!r} — pass-7 "
                    f"recommends Chrome for Testing 143.x via Playwright."
                )
    except Exception as e:  # noqa: BLE001 — defensive
        issues.append(f"CDP browser probe failed: {e}")

    # OPENAI_API_KEY visibility.
    if not os.environ.get("OPENAI_API_KEY"):
        issues.append(
            "OPENAI_API_KEY is not set. Stage 2 (per-attribute polarity) "
            "will fail unless --stub-llm is also passed."
        )
    return issues


def _print_preflight(issues: list[str]) -> None:
    print("=" * 64)
    print("  Preflight")
    print("=" * 64)
    if not issues:
        print("  ✓ all preflight checks passed")
        return
    for i, msg in enumerate(issues, 1):
        print(f"  ✗ {i}. {msg}")


def _build_retry_command(
    *,
    run_dir: Path,
    product_url: str,
    prior_summary_path: Path,
    cdp_port: int,
    stub_llm: bool,
    auth_wall_recovery_mode: str,
    auth_wall_max_recovery_attempts: int,
    manual_auth_wall_recovery: bool,
    diagnostic_artifact_dir: str | None = None,
    auth_wall_backoff_seconds: float | None = None,
) -> list[str]:
    """Compose the run_phase2e_pipeline.py argv for the retry.

    The retry runs the full multi-sort plan filtered to
    `sorts_failed`, then re-runs Stage 1/2/3 over the merged DB
    rows, then re-emits the collection_summary, analysis_report,
    and PDF into the SAME run dir.
    """
    seller_pdf = run_dir / "seller_report" / "seller_report_ko.pdf"
    analysis_report = run_dir / "shared" / "analysis_report.json"
    collection_summary = run_dir / "shared" / "collection_summary.json"
    cdp_endpoint = f"http://127.0.0.1:{int(cdp_port)}"
    cmd = [
        sys.executable,
        str(REPO_ROOT / "scripts" / "run_phase2e_pipeline.py"),
        product_url,
        "--multi-sort",
        "--corpus-mode", "observable_multi_sort",
        "--retry-failed-from-summary", str(prior_summary_path),
        "--max-reviews", "all",
        "--out-pdf", str(seller_pdf),
        "--emit-analysis-report-json", str(analysis_report),
        "--emit-collection-summary-json", str(collection_summary),
        "--analysis-report-source-url", product_url,
        "--cdp-endpoint", cdp_endpoint,
        "--auth-wall-recovery-mode", auth_wall_recovery_mode,
        "--auth-wall-max-recovery-attempts",
        str(int(auth_wall_max_recovery_attempts)),
    ]
    if manual_auth_wall_recovery:
        cmd.append("--manual-auth-wall-recovery")
    if diagnostic_artifact_dir:
        cmd.extend(["--diagnostic-artifact-dir", diagnostic_artifact_dir])
    # Single-float override: when omitted, run_phase2e_pipeline keeps
    # its mode-based default (quick = 30/60s pair, patient = 120/180s
    # pair). When provided, the pipeline applies the same fixed value
    # to every recovery attempt.
    if auth_wall_backoff_seconds is not None:
        cmd.extend([
            "--auth-wall-backoff-seconds",
            f"{float(auth_wall_backoff_seconds):g}",
        ])
    if stub_llm:
        cmd.append("--stub-llm")
    return cmd


def _run_subprocess(cmd: list[str]) -> int:
    print(f"\n[live] $ {' '.join(cmd)}\n", flush=True)
    proc = subprocess.run(
        cmd, cwd=str(REPO_ROOT),
        env={**os.environ, "PYTHONPATH": str(REPO_ROOT)},
    )
    return proc.returncode


def _republish(run_dir: Path) -> int:
    cmd = [
        sys.executable,
        str(REPO_ROOT / "scripts" / "republish_run.py"),
        "--run-dir", str(run_dir),
    ]
    print(f"\n[republish] $ {' '.join(cmd)}\n", flush=True)
    proc = subprocess.run(
        cmd, cwd=str(REPO_ROOT),
        env={**os.environ, "PYTHONPATH": str(REPO_ROOT)},
    )
    return proc.returncode


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def _print_before_state(prior: dict, prior_report: Path) -> None:
    print("=" * 64)
    print("  Before retry")
    print("=" * 64)
    sf = list(prior.get("sorts_failed") or [])
    ss = list(prior.get("sorts_succeeded") or [])
    print(f"  sorts_succeeded    : {ss}")
    print(f"  sorts_failed       : {sf}")
    print(f"  partial_success    : {prior.get('partial_success')}")
    print(f"  review_count       : {_review_count_analyzed(prior_report)}")
    print(
        f"  negative_signal_   : "
        f"{_negative_signal_coverage(prior_report)}"
    )
    print()
    print("  raw_records_seen_by_sort:")
    for st, n in (prior.get("raw_records_seen_by_sort") or {}).items():
        print(f"    {st:<22} {n}")
    print("  rows_inserted_by_sort:")
    for st, n in (prior.get("rows_inserted_by_sort") or {}).items():
        print(f"    {st:<22} {n}")


def _print_diff(
    *, prior: dict, current: dict,
    prior_report: Path, current_report: Path,
) -> None:
    print()
    print("=" * 64)
    print("  After retry — before / after diff")
    print("=" * 64)

    sorts = sorted(set(
        list(prior.get("sorts_attempted") or [])
        + list(current.get("sorts_attempted") or [])
    ))

    # Per-sort table
    print(f"  {'sort':<22} {'raw_seen B/A':<20} {'rows_ins B/A':<18} {'recovery':<40}")
    print("  " + "-" * 100)
    for st in sorts:
        raw_b = _per_sort_metric(prior, st, "raw_records_seen_by_sort")
        raw_a = _per_sort_metric(current, st, "raw_records_seen_by_sort")
        ins_b = _per_sort_metric(prior, st, "rows_inserted_by_sort")
        ins_a = _per_sort_metric(current, st, "rows_inserted_by_sort")
        rec = _per_sort_recovery_actions(current, st)
        rec_str = ", ".join(rec) if rec else "—"
        print(
            f"  {st:<22} {raw_b:>6}{'/':>2}{raw_a:<10} "
            f"{ins_b:>5}{'/':>2}{ins_a:<7} "
            f"{rec_str[:38]:<40}"
        )

    # Headline counts
    rc_before = _review_count_analyzed(prior_report)
    rc_after = _review_count_analyzed(current_report)
    cov_before = _negative_signal_coverage(prior_report)
    cov_after = _negative_signal_coverage(current_report)
    print()
    print(f"  review_count_analyzed       : {rc_before} → {rc_after}")
    print(f"  negative_signal_coverage    : {cov_before} → {cov_after}")
    if cov_before == "degraded" and cov_after in ("partial", "complete"):
        print("  ✓ negative_signal_coverage UPGRADED.")
    elif cov_before == cov_after:
        print(
            f"  • negative_signal_coverage unchanged ({cov_after}). "
            f"Either retry didn't add RATING_ASC or new failures appeared."
        )
    else:
        print(
            f"  ⚠ negative_signal_coverage moved {cov_before} → "
            f"{cov_after} — verify."
        )

    # Per-target verdicts
    print()
    print("  Per-target recovery verdict:")
    for st in _TARGETED_SORTS:
        before_status = _per_sort_status(prior, st)
        after_status = _per_sort_status(current, st)
        succeeded = (
            after_status not in (
                None, "anonymous_auth_wall", "scraper_subprocess_failed",
                "human_check_timeout",
            )
            and _per_sort_metric(current, st, "raw_records_seen_by_sort") > 0
        )
        glyph = "✓" if succeeded else "✗"
        print(
            f"    {glyph} {st:<22} status: {before_status!r} → "
            f"{after_status!r}; recovery succeeded: {succeeded}"
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--run-dir", type=Path, required=True,
        help="Run directory holding the prior collection_summary.json.",
    )
    mode = p.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run", action="store_true",
        help="Show the planned retry command + before-state. Do not invoke.",
    )
    mode.add_argument(
        "--live", action="store_true",
        help="Actually run the retry pipeline (requires browser + LLM).",
    )
    p.add_argument(
        "--stub-llm", action="store_true",
        help="Pass --stub-llm to the retry pipeline (deterministic Stage 2).",
    )
    p.add_argument(
        "--cdp-port", type=int, default=9222,
        help="CDP port the retry pipeline should attach to (default 9222).",
    )
    p.add_argument(
        "--skip-republish", action="store_true",
        help="Skip the republish step after the retry.",
    )
    # Pass-7 auth-wall knobs — forwarded to run_phase2e_pipeline.
    p.add_argument(
        "--auth-wall-recovery-mode",
        choices=("quick", "patient"),
        default="quick",
        help="Quick (15-25s) or patient (120-180s) deferred backoff.",
    )
    p.add_argument(
        "--auth-wall-max-recovery-attempts", type=int, default=1,
        help="How many times to retry each auth-wall-failed sort (default 1).",
    )
    p.add_argument(
        "--auth-wall-backoff-seconds",
        type=float,
        default=None,
        help=(
            "Single fixed backoff (seconds) applied to every recovery "
            "attempt. Overrides --auth-wall-recovery-mode. Omit to keep "
            "the mode default (patient = 120-180s random)."
        ),
    )
    p.add_argument(
        "--manual-auth-wall-recovery", action="store_true",
        help=(
            "Pause for operator intervention before each auth-wall "
            "recovery attempt (Enter to continue)."
        ),
    )
    p.add_argument(
        "--diagnostic-artifact-dir", default=None,
        help="Directory for per-attempt diagnostic_summary JSONs.",
    )
    args = p.parse_args(argv)

    run_dir: Path = args.run_dir.resolve()
    if not run_dir.is_dir():
        print(f"✗ run-dir does not exist: {run_dir}", file=sys.stderr)
        return 2

    prior_summary_path = run_dir / "shared" / "collection_summary.json"
    prior_report_path = run_dir / "shared" / "analysis_report.json"
    if not prior_summary_path.is_file():
        print(f"✗ missing {prior_summary_path}", file=sys.stderr)
        return 2

    prior = _load_json(prior_summary_path)
    sorts_failed = list(prior.get("sorts_failed") or [])
    product_url = prior.get("product_url") or ""
    if not sorts_failed:
        print(
            "Nothing to retry — prior collection_summary.json reports "
            "no sorts_failed.",
        )
        return 0
    if not product_url:
        print(
            f"✗ prior summary missing product_url: {prior_summary_path}",
            file=sys.stderr,
        )
        return 2

    _print_before_state(prior, prior_report_path)

    # Pass-7: preflight checks before composing the command.
    preflight_issues = _preflight_checks(cdp_port=args.cdp_port)
    if not args.dry_run:
        # Allow OPENAI_API_KEY warning when the operator chose --stub-llm.
        if args.stub_llm:
            preflight_issues = [
                m for m in preflight_issues
                if "OPENAI_API_KEY" not in m
            ]
    _print_preflight(preflight_issues)

    cmd = _build_retry_command(
        run_dir=run_dir,
        product_url=product_url,
        prior_summary_path=prior_summary_path,
        cdp_port=args.cdp_port,
        stub_llm=args.stub_llm,
        auth_wall_recovery_mode=args.auth_wall_recovery_mode,
        auth_wall_max_recovery_attempts=args.auth_wall_max_recovery_attempts,
        manual_auth_wall_recovery=args.manual_auth_wall_recovery,
        diagnostic_artifact_dir=args.diagnostic_artifact_dir,
        auth_wall_backoff_seconds=args.auth_wall_backoff_seconds,
    )

    if args.dry_run or not args.live:
        # Default to dry-run behaviour when neither mode is set so
        # an accidental invocation doesn't fire the scraper.
        print()
        print("=" * 64)
        print("  Planned retry command (dry-run)")
        print("=" * 64)
        print(f"  {' '.join(cmd)}")
        print()
        print("  Failed sorts that would be retried: ", sorts_failed)
        print()
        print("  Pass --live (and have CDP browser + OPENAI_API_KEY)")
        print("  to actually execute. Snapshots will be written to")
        print(f"  {run_dir / 'shared' / '_pre_retry_snapshot'}/")
        return 0

    # --live path
    snap_dir = _snapshot_prior_state(run_dir)
    print(f"\n  [snapshot] prior state archived → {snap_dir}\n")

    rc_retry = _run_subprocess(cmd)
    if rc_retry != 0:
        # Surface the diagnostic artifact path so the operator can
        # read what the connector observed without grep'ing logs.
        diag_dir = args.diagnostic_artifact_dir or (
            "data/collection_artifacts/<batch_id>/"
        )
        print(
            f"\n✗ retry pipeline exited rc={rc_retry}.",
            file=sys.stderr,
        )
        print(
            f"  Rollback snapshot   : {snap_dir}",
            file=sys.stderr,
        )
        print(
            f"  Diagnostic artifacts: {diag_dir}",
            file=sys.stderr,
        )
        # Try to surface the most-recent collection_summary so the
        # operator sees which sorts hit which subreason.
        cur_summary_path = run_dir / "shared" / "collection_summary.json"
        try:
            cur = json.loads(cur_summary_path.read_text(encoding="utf-8"))
            per = cur.get("per_sort") or {}
            print(
                f"  Per-sort auth_wall_subreason (current sidecar):",
                file=sys.stderr,
            )
            for st, det in per.items():
                if not isinstance(det, dict):
                    continue
                sub = det.get("auth_wall_subreason")
                if sub:
                    hint = det.get("auth_wall_next_action_hint_ko") or ""
                    print(
                        f"    {st:<22} subreason={sub}  next: {hint}",
                        file=sys.stderr,
                    )
        except (OSError, json.JSONDecodeError):
            pass
        return 3

    if not args.skip_republish:
        rc_repub = _republish(run_dir)
        if rc_repub != 0:
            print(
                f"\n✗ republish exited rc={rc_repub}. "
                f"Sidecar/PDF state unclear. Snapshot at {snap_dir}.",
                file=sys.stderr,
            )
            return 4

    # Read post-retry state and emit the diff.
    current = _load_json(prior_summary_path)
    _print_diff(
        prior=prior, current=current,
        prior_report=snap_dir / "analysis_report.json",
        current_report=prior_report_path,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
