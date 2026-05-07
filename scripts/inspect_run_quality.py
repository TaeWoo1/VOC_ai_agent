#!/usr/bin/env python3
"""Read-only audit of a single run directory.

Usage
-----

    PYTHONPATH=. python3 scripts/inspect_run_quality.py \
        --run-dir outputs/2026-04-30_product-83743e299623_run-010

What it prints
--------------

  - Product / goodsNo / product_name
  - corpus_mode / primary_sort / review_count_analyzed
  - Per-sort table (attempted / succeeded / failed) + retry counts
  - Partial-success flag
  - Seller PDF status from manifest + on-disk presence cross-check
  - analysis_report polarity_audit summary (n_total / n_suspect / per-attribute share)
  - Up to 5 suspect sample quotes
  - Number of top_quotes with display_text vs missing
  - Manifest collection block presence

Read-only: never writes, never modifies anything under run_dir.
Designed for live-run verification — invoke right after `run_all.py`
finishes and use the output as a pre-publish gate.

Exit code
---------
0 — every check passed (PDF present, manifest valid, audit absent or clean,
    every quote carries display_text)
1 — at least one warning surfaced (missing PDF, missing display_text on
    quotes, manifest not on disk, sidecar absent, …); details printed
2 — invocation error (missing run dir, unreadable JSON)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Tiny print helpers — terminal-only, no color libs required.
# ---------------------------------------------------------------------------


def _hdr(title: str) -> None:
    print()
    print(f"━━ {title} " + "━" * max(0, 60 - len(title)))


def _kv(label: str, value: Any, *, ok: bool | None = None) -> None:
    """Aligned key/value line. Optionally prepends a status glyph."""
    glyph = ""
    if ok is True:
        glyph = "✓ "
    elif ok is False:
        glyph = "✗ "
    print(f"  {glyph}{label:<32} {value}")


def _safe_load_json(path: Path, *, optional: bool = True) -> dict | list | None:
    """Read+parse a JSON file. Returns None on missing-or-malformed.
    `optional=True` silently swallows FileNotFoundError; malformed
    JSON always emits a stderr warning so the operator is aware
    something was on disk but couldn't be parsed."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        if not optional:
            print(f"  ⚠ missing required file: {path}", file=sys.stderr)
        return None
    except (OSError, json.JSONDecodeError) as e:
        print(f"  ⚠ failed to read {path}: {e}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Per-section inspectors. Each appends warnings to a shared list and
# returns nothing (printing is the side effect).
# ---------------------------------------------------------------------------


def inspect_product_block(
    manifest: dict | None,
    collection: dict | None,
    warnings: list[str],
    analysis_report: dict | None = None,
) -> None:
    """Print the Product section.

    Pass-19H: prefer `analysis_report.product` over `manifest.product`
    for profile / category / name_ko. The analysis_report is
    regenerated on every republish via the freshly-resolved profile;
    the manifest can lag when hydration is partial or when the
    operator runs republish in a non-standard order. Reading the
    fresh source first prevents the inspector from showing
    `profile=default` while the adapter / PDF / cardnews are
    correctly using `lip_makeup`.

    Resolution order per field: analysis_report.product →
    manifest.product → "—".
    """
    manifest_product = (manifest or {}).get("product") if manifest else None
    ar_product = (analysis_report or {}).get("product") if analysis_report else None

    def _coalesce(key: str) -> str | None:
        # Prefer analysis_report (regenerated on every republish);
        # fall back to manifest only when the AR slot is empty.
        if isinstance(ar_product, dict):
            v = ar_product.get(key)
            if v not in (None, ""):
                return v
        if isinstance(manifest_product, dict):
            return manifest_product.get(key)
        return None

    _hdr("Product")
    name_ko = _coalesce("name_ko")
    category = _coalesce("category")
    profile = _coalesce("selected_profile_id")
    goods_no = (collection or {}).get("goodsNo") if collection else None
    product_url = (collection or {}).get("product_url") if collection else None
    if not goods_no:
        # Either source's slug can yield the goodsNo for legacy runs.
        for product in (ar_product, manifest_product):
            if isinstance(product, dict):
                slug = product.get("slug")
                if isinstance(slug, str) and slug.startswith("product-"):
                    goods_no = slug.split("-", 1)[1]
                    break
    _kv("product_name", name_ko or "—")
    _kv("category", category or "—")
    _kv("profile", profile or "—")
    _kv("goodsNo", goods_no or "—")
    _kv("product_url", product_url or "—")

    # Pass-19H: surface a one-line drift warning when manifest and
    # analysis_report disagree on profile. Operators should run
    # republish to bring the manifest in line — but the inspector
    # showing the FRESH value plus a clear warning is more helpful
    # than silent precedence.
    if (
        isinstance(ar_product, dict)
        and isinstance(manifest_product, dict)
    ):
        ar_profile = ar_product.get("selected_profile_id")
        m_profile = manifest_product.get("selected_profile_id")
        if ar_profile and m_profile and ar_profile != m_profile:
            warnings.append(
                f"manifest.product.selected_profile_id={m_profile!r} "
                f"differs from analysis_report.product.selected_profile_id="
                f"{ar_profile!r} — re-run republish to sync manifest"
            )


def inspect_corpus_block(
    analysis_report: dict | None,
    collection: dict | None,
    warnings: list[str],
) -> None:
    _hdr("Corpus")
    corpus = (analysis_report or {}).get("corpus") or {}
    n_analyzed = corpus.get("n_reviews_analyzed")
    n_total = corpus.get("n_reviews_total")
    primary_sort = corpus.get("primary_sort")
    sampling = corpus.get("sampling_strategy")
    confidence = corpus.get("confidence_level")
    corpus_mode = (collection or {}).get("corpus_mode") if collection else None
    _kv("review_count_analyzed", n_analyzed if n_analyzed is not None else "—")
    _kv("review_count_total", n_total if n_total is not None else "—")
    _kv("primary_sort", primary_sort or "—")
    _kv("corpus_mode", corpus_mode or "—")
    _kv("sampling_strategy", sampling or "—")
    _kv("confidence_level", confidence or "—")


def inspect_sorts_block(
    collection: dict | None,
    warnings: list[str],
) -> None:
    _hdr("Sorts (collection_summary.json)")
    if not collection:
        warnings.append(
            "collection_summary.json missing — cannot audit per-sort outcomes"
        )
        print("  ⚠ collection_summary.json not found (legacy run?)")
        return
    # Lifecycle status surface — surfaced first so the operator
    # immediately sees whether analysis even ran. `pending` is NOT
    # a collection failure; it means scrape provenance is intact
    # and the operator can re-run analysis with --skip-scrape.
    analysis_status = collection.get("analysis_status")
    if analysis_status == "pending":
        print(
            "  ⏸ analysis_status: PENDING — scrape recorded but Stage "
            "1/2/3 / aggregation has not completed (or crashed mid-run). "
            "Re-run analysis with `--skip-scrape` to retry without "
            "losing scrape provenance."
        )
    elif analysis_status == "completed":
        completed_at = collection.get("completed_at") or "—"
        _kv("analysis_status", f"completed (at {completed_at})", ok=True)
    elif analysis_status == "failed":
        warnings.append("analysis_status=failed — see analysis logs")
        _kv("analysis_status", "failed", ok=False)
    else:
        # Pre-1.1 sidecar with no lifecycle field — accept silently.
        pass
    if collection.get("skipped_scrape"):
        print("  scrape was SKIPPED (--skip-scrape); no per-sort data")
        return
    attempted = collection.get("sorts_attempted") or []
    succeeded = collection.get("sorts_succeeded") or []
    failed = collection.get("sorts_failed") or []
    blocked = collection.get("sorts_blocked_or_anti_bot") or []
    # Pass-19E: separate buckets so "anti-bot / auth-wall" warnings
    # are emitted ONLY when the connector observed hard auth evidence.
    sort_control_failures = (
        collection.get("sorts_with_sort_control_failure") or []
    )
    reused_via_default = (
        collection.get("sorts_reused_via_default_response") or []
    )
    partial = collection.get("partial_success")
    _kv("sorts_attempted", attempted)
    _kv(
        "sorts_succeeded",
        f"{succeeded}  ({len(succeeded)}/{len(attempted)})",
        ok=(len(succeeded) == len(attempted)),
    )
    _kv(
        "sorts_failed",
        f"{failed}",
        ok=(len(failed) == 0),
    )
    if reused_via_default:
        _kv(
            "sorts_reused_via_default_response",
            reused_via_default,
            ok=True,
        )
    if blocked:
        # AUTH-EVIDENCE bucket. The summary builder now puts ONLY
        # entries with hard 401/403/429/captcha/login evidence here,
        # so this warning means re-login or cooldown is required.
        _kv(
            "sorts_blocked_or_anti_bot",
            blocked,
            ok=False,
        )
        warnings.append(
            f"anti-bot / auth-wall on {len(blocked)} sort(s): {blocked}"
        )
    if sort_control_failures:
        # NO-AUTH-EVIDENCE bucket. Operator action differs — fix the
        # connector's click / scroll / wait logic, do NOT re-login.
        # Distinguish three subreasons so the operator can prioritize:
        #   1. `sort_control_unreachable` — connector's widened sort-row
        #      probe (scroll-into-view + disclosure-affordance click)
        #      could not surface the requested rating tab. UI-shape
        #      signal; recovery is selector / probe maintenance.
        #   2. `review_sort_api_not_triggered` family — sort-tab click
        #      took effect but the cursor API never fired afterward.
        #   3. Generic sort-not-reached — fallback bucket for any other
        #      no-auth-evidence sort-control failure.
        per_sort = collection.get("per_sort") or {}
        api_not_fired: list[str] = []
        sort_not_reached: list[str] = []
        sort_unreachable: list[str] = []
        for st in sort_control_failures:
            entry = per_sort.get(st) or {}
            status = entry.get("status") or ""
            if status == "sort_control_unreachable":
                sort_unreachable.append(st)
                continue
            sub = entry.get("auth_wall_subreason") or ""
            if sub in (
                "review_sort_api_not_triggered",
                "no_review_api_after_sort_click",
                "anonymous_auth_wall_no_review_api",
                "anonymous_auth_wall_false_empty",
            ):
                api_not_fired.append(st)
            else:
                sort_not_reached.append(st)
        _kv(
            "sorts_with_sort_control_failure",
            sort_control_failures,
            ok=False,
        )
        if sort_unreachable:
            # Generic phrasing avoids batchim/particle agreement bugs
            # across sort-name suffixes (RATING_ASC vs DATETIME_DESC).
            warnings.append(
                f"정렬 컨트롤 도달 실패 ({len(sort_unreachable)}개 sort): "
                f"{sort_unreachable} — UI 변경 가능성, 재수집 또는 "
                "셀렉터 점검 필요"
            )
        if sort_not_reached:
            warnings.append(
                f"정렬 전환 실패 ({len(sort_not_reached)}개 sort): "
                f"{sort_not_reached} — 리뷰 영역 sort 컨테이너 안에서 "
                "버튼을 탐색하도록 connector를 점검하세요"
            )
        if api_not_fired:
            warnings.append(
                f"리뷰 API 미발화 ({len(api_not_fired)}개 sort): "
                f"{api_not_fired} — 정렬 클릭 후 review API가 fire되지 "
                "않았거나, default sort response 재사용을 검토하세요"
            )
        # Special-case the user's exact pattern: USEFUL_SCORE_DESC
        # and/or RECOMMENDED_DESC failed with no API. Surface a
        # dedicated message so the operator immediately recognizes it.
        useful_or_rec = [
            s for s in sort_control_failures
            if s in ("USEFUL_SCORE_DESC", "RECOMMENDED_DESC")
        ]
        if useful_or_rec and api_not_fired:
            warnings.append(
                f"추천·유용 정렬 evidence pool 부재 ({useful_or_rec}): "
                "default sort response를 reuse하거나 review-area "
                "scope 버튼 탐색으로 회복 가능성 검토"
            )
    _kv("partial_success", partial, ok=(partial is False))
    # Per-sort detail
    per_sort = collection.get("per_sort") or {}
    if per_sort:
        print()
        print(
            f"  {'sort_type':<20} {'status':<26} {'attempts':>8}"
            f" {'raw_seen':>10} {'rows_inserted':>14}"
        )
        for st in attempted:
            entry = per_sort.get(st) or {}
            print(
                f"  {st:<20} {str(entry.get('status') or '—'):<26} "
                f"{entry.get('attempts', '—'):>8} "
                f"{entry.get('raw_records_seen', '—'):>10} "
                f"{entry.get('rows_inserted', '—'):>14}"
            )


def inspect_seller_pdf(
    run_dir: Path,
    manifest: dict | None,
    warnings: list[str],
) -> None:
    _hdr("Seller PDF")
    if manifest is None:
        warnings.append("manifest.json missing")
        print("  ⚠ manifest.json missing — cannot resolve PDF status")
        return
    artifacts = (manifest.get("artifacts") or {})
    pdf_record = artifacts.get("seller_report_ko_pdf") or {}
    status = pdf_record.get("status")
    rel_path = pdf_record.get("path")
    abs_path = run_dir / rel_path if rel_path else None
    on_disk = bool(abs_path and abs_path.is_file())
    _kv("manifest status", status or "—", ok=(status == "ok"))
    _kv("path (relative)", rel_path or "—")
    _kv("on disk", on_disk, ok=on_disk)
    if status == "ok" and not on_disk:
        warnings.append(
            f"manifest reports seller PDF ok but file missing at {abs_path}"
        )
    if status != "ok" and on_disk:
        warnings.append(
            f"PDF exists at {abs_path} but manifest status={status!r} "
            f"(provenance drift)"
        )


def inspect_polarity_audit(
    analysis_report: dict | None,
    collection: dict | None,
    warnings: list[str],
) -> None:
    _hdr("Polarity audit")
    if not analysis_report:
        # Distinguish "analysis not run yet" from "missing artifact."
        # When the sidecar reports `analysis_status="pending"`, the
        # absence of analysis_report.json is expected — not a warning.
        if collection and collection.get("analysis_status") == "pending":
            print(
                "  analysis_report.json absent — expected (analysis_status=pending)"
            )
            return
        warnings.append("analysis_report.json missing")
        print("  ⚠ analysis_report.json missing")
        return
    audit = analysis_report.get("polarity_audit")
    if not audit:
        warnings.append(
            "polarity_audit block absent — analysis_report predates the "
            "P0 reliability layer or was generated by a stale adapter"
        )
        print("  ⚠ polarity_audit block absent")
        return
    n_total = audit.get("n_total_quotes", 0)
    n_suspect = audit.get("n_total_suspect", 0)
    share = audit.get("n_total_suspect_share", 0.0)
    _kv("quotes audited", n_total)
    _kv(
        "suspect quotes",
        f"{n_suspect} ({share:.1%})",
        ok=(n_suspect == 0),
    )
    by_attr = audit.get("by_attribute") or {}
    if by_attr:
        print("  per-attribute:")
        for attr, stats in sorted(
            by_attr.items(), key=lambda kv: -(kv[1].get("n_suspect") or 0),
        ):
            n_t = stats.get("n_total", 0)
            n_s = stats.get("n_suspect", 0)
            ss = stats.get("suspect_share", 0.0)
            print(f"    {attr:<32} {n_s}/{n_t}  ({ss:.1%})")
    samples = audit.get("samples") or []
    if samples:
        print()
        print("  top suspect samples (up to 5):")
        for i, s in enumerate(samples[:5], 1):
            attr = s.get("attribute_key", "—")
            rid = s.get("review_id", "—")
            text = s.get("text", "")
            claimed = s.get("claimed_polarity", "—")
            suggested = s.get("suggested_polarity", "—")
            preview = text[:80] + ("…" if len(text) > 80 else "")
            print(f"    {i}. [{attr}] {rid}  claimed={claimed} → suggested={suggested}")
            print(f"       {preview!r}")


def _is_dangling_display(display: str) -> bool:
    """Heuristic: True when `display` ends with a Hangul syllable and
    NOT with a sentence terminator OR a Korean sentence-final ending.

    Reuses the locked complete-form regex from `quote_display.py` so
    the inspector and the renderer agree on what counts as "clean."
    """
    if not display:
        return False
    s = display.strip()
    if not s:
        return False
    last = s[-1]
    if not ("가" <= last <= "힣"):
        return False
    if s.endswith((".", "!", "?", "…", "~", "ㅎㅎ", "ㅋㅋ")):
        return False
    try:
        from src.voc.reporting.phase2e.quote_display import (
            _ends_with_complete_form,
        )
        if _ends_with_complete_form(s):
            return False
    except ImportError:
        pass
    return True


def inspect_display_text_coverage(
    analysis_report: dict | None,
    warnings: list[str],
) -> None:
    """Audit-field coverage check.

    Pass-16: display_text is the cardnews-facing field; display_text
    dangling-tail issues are NOT a report-facing blocker when
    display_quote_summary exists and is clean for the same quote.
    The PDF appendix uses _br3_appendix_quote_text which prefers
    display_quote_summary; the dangling display_text only matters if
    that fallback chain reaches it.

    So: dangling display_text is reported as an audit-level
    `info` (not a `warning`) when the SAME quote carries a clean
    display_quote_summary. Genuine surface-quality issues are picked
    up by `inspect_report_quote_summary_quality`.
    """
    _hdr("Quote display_text coverage")
    if not analysis_report:
        return
    # Pass-18: import the shared report-facing degraded-summary
    # predicate locally (avoids a top-of-file import cycle on a
    # script-style file that's also script-loadable).
    from src.voc.content.quote_summary_normalizer import (
        is_degraded_quote_summary as _summary_is_degraded,
    )
    attributes = analysis_report.get("attributes") or []
    n_total = 0
    n_with_display = 0
    dangling_audit_only: list[dict] = []
    dangling_blocking: list[dict] = []
    missing: list[tuple[str, str | None]] = []
    for attr in attributes:
        for q in (attr.get("top_quotes") or []):
            n_total += 1
            display = q.get("display_text")
            summary = q.get("display_quote_summary")
            if display:
                n_with_display += 1
                if _is_dangling_display(display):
                    sample = {
                        "attribute": attr.get("key"),
                        "review_id": q.get("review_id"),
                        "polarity": q.get("polarity"),
                        "raw": q.get("text") or "",
                        "display": display,
                        "summary": summary,
                    }
                    # Pass-18: the "clean summary present" check now
                    # uses the SAME predicate the adapter / renderer /
                    # report-facing inspector section use. The audit-
                    # field dangling check (`_is_dangling_display`)
                    # rejects nominal-phrase tails like
                    # "...라는 의견" / "...로 언급" — those are exactly
                    # how the pass-17 fallbacks end, and they ARE
                    # report-clean. Using the audit predicate here
                    # produced false "no clean summary" verdicts.
                    has_clean_summary = (
                        isinstance(summary, str)
                        and summary.strip()
                        and not _summary_is_degraded(summary.strip())
                    )
                    if has_clean_summary:
                        dangling_audit_only.append(sample)
                    else:
                        dangling_blocking.append(sample)
            else:
                missing.append((attr.get("key"), q.get("review_id")))
    _kv("quotes total", n_total)
    _kv(
        "with display_text",
        f"{n_with_display}/{n_total}",
        ok=(n_total == 0 or n_with_display == n_total),
    )

    n_audit = len(dangling_audit_only)
    n_block = len(dangling_blocking)
    if n_block:
        _kv("dangling end (no clean summary)", n_block, ok=False)
        warnings.append(
            f"{n_block} display_text dangling AND no clean display_quote_summary"
        )
        print("  blocking dangling samples (up to 10):")
        for i, s in enumerate(dangling_blocking[:10], 1):
            attr = s["attribute"] or "—"
            rid = s["review_id"] or "—"
            pol = s["polarity"] or "—"
            print(f"    {i}. [{attr}] {rid}  polarity={pol}")
            print(f"       display: {s['display']!r}")
            print(f"       summary: {s['summary']!r}")
    if n_audit:
        # Audit-level only — report-facing PDF will use the clean
        # summary, so this is informational, not a blocker.
        _kv("dangling end (audit-only; clean summary present)", n_audit, ok=True)
        if n_audit <= 5:
            print("  audit-only dangling samples:")
            for i, s in enumerate(dangling_audit_only[:5], 1):
                print(
                    f"    {i}. [{s['attribute']}] {s['review_id']} — "
                    f"display dangling but summary clean"
                )
    if missing:
        warnings.append(
            f"{len(missing)} top_quotes missing display_text"
        )
        print("  missing display_text on:")
        for attr, rid in missing[:10]:
            print(f"    - {attr} / review_id={rid}")


# Pass-17: predicates moved to a shared module. The inspector uses
# the same definition the renderer + adapter use, so "degraded" here
# matches what those layers would have rejected.
from src.voc.content.quote_summary_normalizer import (  # noqa: E402
    looks_dangling as _summary_looks_dangling,
    looks_too_generic as _summary_looks_too_generic,
    looks_truncated as _summary_looks_truncated,
)


def inspect_report_quote_summary_quality(
    analysis_report: dict | None,
    warnings: list[str],
) -> None:
    """Report-facing quote-quality block. Reads `display_quote_summary`
    on every top_quote and reports coverage / generic count / dangling
    count / truncated count. Warnings fire only when the SUMMARY
    field is degraded — display_text dangling alone is audit-only."""
    _hdr("Report-facing quote summary quality")
    if not analysis_report:
        return
    attributes = analysis_report.get("attributes") or []
    n_total = 0
    n_with_summary = 0
    n_generic = 0
    n_dangling = 0
    n_truncated = 0
    bad_samples: list[dict] = []
    for attr in attributes:
        for q in (attr.get("top_quotes") or []):
            n_total += 1
            summary = q.get("display_quote_summary")
            if not (isinstance(summary, str) and summary.strip()):
                continue
            n_with_summary += 1
            s = summary.strip()
            issue: str | None = None
            if _summary_looks_truncated(s):
                n_truncated += 1
                issue = "truncated"
            elif _summary_looks_dangling(s):
                n_dangling += 1
                issue = "dangling"
            elif _summary_looks_too_generic(s):
                n_generic += 1
                issue = "generic"
            if issue:
                bad_samples.append({
                    "attribute": attr.get("key"),
                    "review_id": q.get("review_id"),
                    "issue": issue,
                    "summary": s,
                })
    _kv("quotes total", n_total)
    _kv(
        "with display_quote_summary",
        f"{n_with_summary}/{n_total}",
        ok=(n_total == 0 or n_with_summary == n_total),
    )
    _kv("summary truncated (\"...\" / \"…\")", n_truncated,
        ok=(n_truncated == 0))
    _kv("summary dangling end", n_dangling, ok=(n_dangling == 0))
    _kv("summary generic / filler", n_generic, ok=(n_generic == 0))
    n_bad_total = n_truncated + n_dangling + n_generic
    if n_bad_total:
        warnings.append(
            f"{n_bad_total} report-facing quote summaries are degraded "
            f"(truncated={n_truncated} dangling={n_dangling} generic={n_generic})"
        )
        if bad_samples:
            print("  degraded summary samples (up to 10):")
            for i, s in enumerate(bad_samples[:10], 1):
                print(
                    f"    {i}. [{s['attribute']}] {s['review_id']}  "
                    f"issue={s['issue']}"
                )
                print(f"       summary: {s['summary']!r}")


def inspect_sort_outcomes_warnings(
    collection: dict | None,
    warnings: list[str],
) -> None:
    """Surface high-impact partial-success conditions.

    The Sorts inspector already prints the table; this pass is the
    "did anything important fail" gate. Specifically:
      - RATING_ASC failure under-observes negative reviews and is
        the highest-leverage partial-success failure mode.
      - Generic partial_success raises the visibility bar but does
        not fail the run.
    """
    if not collection:
        return
    sorts_failed = collection.get("sorts_failed") or []
    if not sorts_failed:
        return
    _hdr("Sort-outcome warnings")
    if "RATING_ASC" in sorts_failed:
        msg = (
            "RATING_ASC (평점 낮은순) 수집 실패 — 부정 리뷰 신호가 "
            "과소 관측될 수 있습니다."
        )
        print(f"  ⚠ {msg}")
        warnings.append(msg)
    if "RECOMMENDED_DESC" in sorts_failed:
        print(
            "  ⚠ RECOMMENDED_DESC (도움순) 수집 실패 — "
            "highly-recommended evidence pool 부재"
        )
    other_failed = [
        s for s in sorts_failed
        if s not in ("RATING_ASC", "RECOMMENDED_DESC")
    ]
    if other_failed:
        print(f"  other failed sorts: {other_failed}")


def inspect_schema_mismatch(
    run_dir: Path,
    analysis_report: dict | None,
    warnings: list[str],
) -> None:
    """Validate analysis_report.json against the run-local schema and
    surface enum mismatches in `corpus.sampling_strategy`.

    Pure-stdlib check: parses both JSON files and verifies the report
    value is in the schema's enum. If `jsonschema` is importable, also
    runs a full validate() pass for the corpus block.
    """
    schema_path = run_dir / "shared" / "analysis_report.schema.json"
    schema = _safe_load_json(schema_path)
    if not schema or not analysis_report:
        return
    _hdr("Schema contract")
    try:
        sampling = (
            (analysis_report.get("corpus") or {}).get("sampling_strategy")
        )
        enum_vals = (
            schema.get("properties", {})
                  .get("corpus", {})
                  .get("properties", {})
                  .get("sampling_strategy", {})
                  .get("enum")
        )
    except (AttributeError, TypeError):
        sampling = None
        enum_vals = None
    if not sampling or not enum_vals:
        _kv("sampling_strategy enum", "—")
        return
    in_enum = sampling in enum_vals
    _kv(
        f"sampling_strategy={sampling!r}",
        f"in enum {enum_vals}",
        ok=in_enum,
    )
    if not in_enum:
        warnings.append(
            f"schema enum mismatch: sampling_strategy={sampling!r} "
            f"not in {enum_vals}"
        )
    # Optional full validation when jsonschema is available.
    try:
        import jsonschema  # type: ignore
        jsonschema.validate(instance=analysis_report, schema=schema)
        _kv("full schema validation", "passed", ok=True)
    except ImportError:
        pass
    except Exception as e:  # noqa: BLE001
        warnings.append(f"schema validation failed: {e}")
        _kv("full schema validation", str(e), ok=False)


def inspect_sort_recovery_log(
    collection: dict | None,
    warnings: list[str],
) -> None:
    """Surface per-sort recovery action history.

    Run-003 QA pass-5: when a sort hits an auth-wall-class failure,
    the orchestrator defers it to a recovery pass and records the
    action history (`wait_after_auth_wall`, `retry_after_other_sorts`,
    `final_failed`). The inspector pulls these from
    `collection_summary.per_sort.<sort>.recovery_actions` so an
    operator scanning the run can see what recovery attempts ran
    without grepping logs.
    """
    if not collection:
        return
    per_sort = collection.get("per_sort") or {}
    sorts_with_recovery = [
        (st, det) for st, det in per_sort.items()
        if isinstance(det, dict) and (det.get("recovery_actions") or [])
    ]
    if not sorts_with_recovery:
        return
    _hdr("Sort recovery log")
    final_failed: list[str] = []
    for st, det in sorts_with_recovery:
        actions = det.get("recovery_actions") or []
        attempts = det.get("attempts")
        outcome = det.get("status")
        line = f"  {st:<22} attempts={attempts!s:<3} status={outcome!r:<28} → {actions}"
        print(line)
        if "final_failed" in actions:
            final_failed.append(st)
    if final_failed:
        warnings.append(
            f"sort recovery exhausted on {final_failed} (recovery_actions ended with "
            f"final_failed) — consider --retry-failed-from-summary later"
        )


def inspect_auth_wall_subreasons(
    collection: dict | None,
    warnings: list[str],
) -> None:
    """Surface per-sort auth-wall subreason classification + diagnostic
    artifact path + recommended next action.

    Run-003 QA pass-7: when a sort hit `anonymous_auth_wall`, the
    orchestrator now writes an `auth_wall_subreason` (login_required /
    api_blocked / no_review_api / false_empty / sort_selector_failed /
    target_goods_filter_empty / unknown) and a `diagnostic_artifact_path`
    pointing to the per-attempt diagnostic_summary.json. The inspector
    prints those + a Korean operator hint per subreason so an operator
    knows what to try next.
    """
    if not collection:
        return
    per_sort = collection.get("per_sort") or {}
    sorts_with_subreason = [
        (st, det) for st, det in per_sort.items()
        if isinstance(det, dict) and det.get("auth_wall_subreason")
    ]
    if not sorts_with_subreason:
        return
    _hdr("Auth-wall subreason (pass-7)")
    for st, det in sorts_with_subreason:
        sub = det.get("auth_wall_subreason")
        hint = det.get("auth_wall_next_action_hint_ko") or "—"
        diag = det.get("diagnostic_artifact_path") or "(not emitted)"
        actions = det.get("recovery_actions") or []
        status = det.get("status")
        print(f"  {st}  status={status}")
        print(f"    subreason       : {sub}")
        print(f"    diagnostic      : {diag}")
        print(f"    recovery_actions: {actions}")
        print(f"    next action     : {hint}")
        if "final_failed" in actions:
            warnings.append(
                f"{st} final_failed (subreason={sub}). next: {hint}"
            )


def inspect_retry_outcome(
    run_dir: Path,
    collection: dict | None,
    analysis_report: dict | None,
    warnings: list[str],
) -> None:
    """If a `_pre_retry_snapshot/<ts>/` directory exists under shared/,
    diff the prior collection_summary against the current one.

    Run-003 QA pass-6 surface — when an operator runs
    `validate_retry_recovery.py --live`, the prior state is archived
    here. The inspector picks the most recent snapshot and reports
    before/after counts + whether RATING_ASC / RECOMMENDED_DESC
    recovery succeeded + whether negative_signal_coverage upgraded.
    """
    if not collection:
        return
    snap_root = run_dir / "shared" / "_pre_retry_snapshot"
    if not snap_root.is_dir():
        return
    snaps = sorted(
        (d for d in snap_root.iterdir() if d.is_dir()),
        reverse=True,
    )
    if not snaps:
        return
    snap = snaps[0]
    prior_summary_path = snap / "collection_summary.json"
    prior_report_path = snap / "analysis_report.json"
    if not prior_summary_path.is_file():
        return

    try:
        prior = json.loads(prior_summary_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return

    _hdr(f"Retry outcome (vs snapshot {snap.name})")
    prior_failed = list(prior.get("sorts_failed") or [])
    cur_failed = list(collection.get("sorts_failed") or [])
    cur_succeeded = list(collection.get("sorts_succeeded") or [])
    print(f"  prior sorts_failed       : {prior_failed}")
    print(f"  current sorts_failed     : {cur_failed}")
    print(f"  current sorts_succeeded  : {cur_succeeded}")

    # Per-target recovery — aligns with validate_retry_recovery.py
    # output for consistency.
    for st in ("RATING_ASC", "RECOMMENDED_DESC"):
        before_in_prior = st in prior_failed
        if not before_in_prior:
            continue
        recovered = (
            st in cur_succeeded
            or int((collection.get("raw_records_seen_by_sort") or {}).get(st, 0) or 0) > 0
        )
        glyph = "✓" if recovered else "✗"
        per = (collection.get("per_sort") or {}).get(st) or {}
        actions = per.get("recovery_actions") or []
        print(
            f"  {glyph} {st:<22} recovered={recovered}  "
            f"recovery_actions={actions}"
        )

    # Confidence-axes upgrade signal.
    cov_before = None
    if prior_report_path.is_file():
        try:
            prior_report = json.loads(prior_report_path.read_text(encoding="utf-8"))
            cov_before = (
                ((prior_report.get("corpus") or {}).get("confidence_axes") or {})
                .get("negative_signal_coverage", {})
                .get("level")
            )
        except (OSError, json.JSONDecodeError, AttributeError):
            cov_before = None
    cov_after = None
    if isinstance(analysis_report, dict):
        cov_after = (
            ((analysis_report.get("corpus") or {}).get("confidence_axes") or {})
            .get("negative_signal_coverage", {})
            .get("level")
        )
    print(f"  negative_signal_coverage : {cov_before} → {cov_after}")
    if cov_before == "degraded" and cov_after in ("partial", "complete"):
        print("  ✓ negative_signal_coverage UPGRADED.")
    elif cov_before == cov_after and cov_before is not None:
        print(
            f"  • negative_signal_coverage unchanged ({cov_after})."
        )


def inspect_quote_summary_quality(
    analysis_report: dict | None,
    warnings: list[str],
) -> None:
    """Evaluate the seller-facing `display_quote_summary` field for
    polarity-tail duplication.

    Quote surface policy (Run-003 QA pass-5):
      - `text`                  : audit only
      - `display_text`          : readable span (cardnews surface)
      - `display_quote_summary` : seller-facing quote (PDF / business
                                  surfaces). Must NEVER carry the
                                  "...아쉬움 의견" / "...만족 의견"
                                  duplication that the synthesizer
                                  emitted in earlier passes.
    """
    if not analysis_report:
        return
    _hdr("Quote summary quality (display_quote_summary)")
    issues: list[dict] = []
    n_total = 0
    n_with_summary = 0
    for attr in (analysis_report.get("attributes") or []):
        for q in (attr.get("top_quotes") or []):
            n_total += 1
            s = q.get("display_quote_summary") or ""
            if s:
                n_with_summary += 1
            # Duplicate-tail detection.
            if (
                "아쉬움 의견" in s and s.count("아쉬움") >= 2
            ) or (
                "만족 의견" in s and s.count("만족") >= 2
            ):
                issues.append({
                    "attribute": attr.get("key"),
                    "review_id": q.get("review_id"),
                    "polarity": q.get("polarity"),
                    "summary": s,
                })
    _kv("quotes total", n_total)
    _kv(
        "with display_quote_summary",
        f"{n_with_summary}/{n_total}",
        ok=(n_total == 0 or n_with_summary == n_total),
    )
    if issues:
        warnings.append(
            f"{len(issues)} display_quote_summary value(s) carry duplicate "
            f"polarity tails — synthesizer regression"
        )
        print(f"  ✗ {len(issues)} duplicate-tail summary samples:")
        for i, it in enumerate(issues[:8], 1):
            print(
                f"    {i}. [{it['attribute']}] {it['review_id']!r} "
                f"polarity={it['polarity']!r}\n"
                f"       summary={it['summary']!r}"
            )
    else:
        _kv("duplicate-tail summaries", 0, ok=True)


def inspect_attribute_fit_skips(
    analysis_report: dict | None,
    warnings: list[str],
) -> None:
    """Count how many quotes the attribute-fit guardrail excluded
    from seller-facing representative slots.

    `attribute_fit_warning` is set per-quote when the cleaned text
    appears off-topic for the host attribute (e.g. "모공 효과"
    surfaced under dryness_skin_texture). Adapter excludes them from
    `monitoring_candidates.top_negative_quotes` and
    `strengths.representative_quote`. This inspector counts both
    sides for QA visibility — a high count signals the underlying
    Stage 1 detection may be drifting.
    """
    if not analysis_report:
        return
    _hdr("Attribute-fit guardrail skip count")
    n_flagged = 0
    n_attribute_fit_skipped = 0
    n_polarity_suspect_skipped = 0
    for attr in (analysis_report.get("attributes") or []):
        for q in (attr.get("top_quotes") or []):
            if q.get("attribute_fit_warning"):
                n_flagged += 1
    for m in (analysis_report.get("monitoring_candidates") or []):
        n_attribute_fit_skipped += int(m.get("attribute_fit_skipped") or 0)
        n_polarity_suspect_skipped += int(
            m.get("polarity_suspect_skipped") or 0
        )
    _kv("quotes carrying attribute_fit_warning", n_flagged)
    _kv("excluded from monitoring_candidates", n_attribute_fit_skipped)
    _kv("excluded from polarity-suspect filter", n_polarity_suspect_skipped)


def inspect_cardnews_presentation(
    run_dir: Path,
    manifest: dict | None,
    warnings: list[str],
) -> None:
    """Verify the buyer-journey cardnews is the primary artifact.

    Run-003 QA pass-5: the legacy 7-slide skeleton + editorial
    cardnews JSONs continue to ship for back-compat, but downstream
    consumers should consume the buyer_journey JSON. The manifest
    carries a `presentation.<lang>` block (written by republish_run)
    that names the primary artifact. Inspector warns when:
      - buyer_journey JSON is missing from disk
      - manifest still lists a 7-slide skeleton as primary
    """
    _hdr("Cardnews presentation policy")
    bj_path = run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json"
    bj_present = bj_path.is_file()
    _kv("buyer_journey_cardnews.json on disk", bj_present, ok=bj_present)
    if not bj_present:
        warnings.append(
            "buyer_journey_cardnews.json missing under "
            f"{bj_path.relative_to(run_dir.parent)} — run-003 pass-5 "
            "expects this as the primary cardnews surface"
        )

    if not manifest:
        return
    presentation = (manifest.get("presentation") or {}).get("ko") or {}
    primary_kind = presentation.get("primary_kind")
    primary_path = presentation.get("primary_path")
    _kv(
        "manifest primary cardnews",
        f"{primary_kind} → {primary_path}",
        ok=(primary_kind == "buyer_journey_cardnews_json"),
    )
    if primary_kind and primary_kind != "buyer_journey_cardnews_json":
        warnings.append(
            f"manifest reports {primary_kind!r} as primary cardnews — "
            f"expected buyer_journey_cardnews_json. Downstream consumers "
            f"may render the 7-slide legacy."
        )
    legacy = presentation.get("legacy_fallbacks_present") or []
    if legacy:
        kinds = [x.get("kind") for x in legacy]
        print(f"  legacy fallbacks present (informational): {kinds}")


def inspect_manifest_collection_block(
    manifest: dict | None,
    warnings: list[str],
) -> None:
    _hdr("Manifest collection block")
    if not manifest:
        return
    block = manifest.get("collection")
    if not block:
        warnings.append(
            "manifest has no `collection` block — sidecar may not be wired"
        )
        print("  ⚠ collection block absent")
        return
    interesting = (
        "product_url", "goodsNo", "corpus_mode", "primary_sort",
        "sorts_attempted", "sorts_succeeded", "partial_success",
        "review_count_analyzed",
    )
    for k in interesting:
        if k in block:
            _kv(k, block[k])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--run-dir", type=Path, required=True,
                   help="Path to a run directory (e.g. outputs/2026-04-30_…)")
    args = p.parse_args(argv)

    run_dir: Path = args.run_dir.resolve()
    if not run_dir.is_dir():
        print(f"✗ run-dir does not exist: {run_dir}", file=sys.stderr)
        return 2

    manifest = _safe_load_json(run_dir / "manifest.json")
    analysis_report = _safe_load_json(run_dir / "shared" / "analysis_report.json")
    collection = _safe_load_json(run_dir / "shared" / "collection_summary.json")

    warnings: list[str] = []

    print("━" * 64)
    print(f"  inspect_run_quality :: {run_dir.name}")
    print("━" * 64)

    inspect_product_block(manifest, collection, warnings, analysis_report)
    inspect_corpus_block(analysis_report, collection, warnings)
    inspect_sorts_block(collection, warnings)
    inspect_sort_outcomes_warnings(collection, warnings)
    inspect_sort_recovery_log(collection, warnings)
    inspect_auth_wall_subreasons(collection, warnings)
    inspect_retry_outcome(run_dir, collection, analysis_report, warnings)
    inspect_seller_pdf(run_dir, manifest, warnings)
    inspect_polarity_audit(analysis_report, collection, warnings)
    inspect_display_text_coverage(analysis_report, warnings)
    inspect_report_quote_summary_quality(analysis_report, warnings)
    inspect_quote_summary_quality(analysis_report, warnings)
    inspect_attribute_fit_skips(analysis_report, warnings)
    inspect_cardnews_presentation(run_dir, manifest, warnings)
    inspect_schema_mismatch(run_dir, analysis_report, warnings)
    inspect_manifest_collection_block(manifest, warnings)

    _hdr("Summary")
    if not warnings:
        print("  ✓ all checks passed — run looks publishable")
        return 0
    print(f"  ⚠ {len(warnings)} warning(s):")
    for i, w in enumerate(warnings, 1):
        print(f"    {i}. {w}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
