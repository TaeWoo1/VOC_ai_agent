#!/usr/bin/env python3
"""Bundle a finished pipeline run into a tool-agnostic creator handoff.

The output package is the single artifact an external Claude
session / custom skill consumes to produce the final visual report
or cardnews. It contains:

  - the seller PDF,
  - the v3.0 analysis_report.json (with polarity_audit + display_text),
  - the consumer insight brief,
  - the buyer-cardnews copy in tool-agnostic shape (no Figma fields),
  - a free-form design brief, README, quality review, and a single
    structured `creator_payload.json` entry point.

Hard rules
----------
- Read-only over `--run-dir`. We never re-scrape, re-classify, or
  re-aggregate.
- Pure copy + generate. No analysis logic touched.
- Output goes to `--out-dir`. Existing files there are overwritten;
  unrelated files are preserved.
- The package surface is tool-agnostic: no `figma_*` field names,
  no master-frame layer references. Any prior Figma artifact is
  copied under a neutral name (`buyer_cardnews_copy_ko.json`).

Usage
-----

    PYTHONPATH=. python3 scripts/package_creator_handoff.py \\
        --run-dir   outputs/2026-04-30_product-83743e299623_run-010 \\
        --content-copy outputs/figma_packages/mediheal_pad_instagram_v1/figma_cardnews_copy_ko.json \\
        --out-dir   outputs/content_packages/2026-04-30_mediheal_pad_run-010

The script prints the final tree on success.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent

# Required input files under `--run-dir`. Missing any of these aborts.
REQUIRED_INPUTS_FROM_RUN: tuple[tuple[str, str], ...] = (
    ("manifest.json", "manifest"),
    ("seller_report/seller_report_ko.pdf", "seller_pdf"),
    ("shared/analysis_report.json", "analysis_report"),
    ("shared/consumer_insight_brief.json", "consumer_insight_brief"),
)

# Optional inputs — copied through when present, omitted from manifest
# without warning when absent. (Lifecycle sidecar may not exist on
# legacy runs.)
OPTIONAL_INPUTS_FROM_RUN: tuple[tuple[str, str], ...] = (
    ("shared/collection_summary.json", "collection_summary"),
)

# Required output files in the package.
PACKAGE_REQUIRED_FILES: tuple[str, ...] = (
    "manifest.json",
    "seller_report_ko.pdf",
    "shared/analysis_report.json",
    "shared/consumer_insight_brief.json",
    "buyer_cardnews_copy_ko.json",
    "content_design_brief.md",
    "quality_review.md",
    "README_FOR_CREATOR.md",
    "creator_payload.json",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _safe_load_json(path: Path) -> dict | list | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _atomic_write(path: Path, body: str) -> None:
    """Write-temp-then-rename so a partial file never appears."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(body, encoding="utf-8")
    tmp.replace(path)


def _copy_with_parent_mkdir(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


# ---------------------------------------------------------------------------
# Tool-agnostic copy normalization
# ---------------------------------------------------------------------------


def _strip_tool_specific_fields(copy_dict: dict) -> dict:
    """Make a Figma-flavored cardnews copy dict tool-agnostic.

    The source `figma_cardnews_copy_ko.json` is already mostly neutral
    (slides + product + corpus_summary). It does NOT contain master-
    frame layer names. We:

      - drop any top-level `figma_*` keys (defensive — none present
        today, but the contract should not depend on accident),
      - reset `format` to `instagram_cardnews_7slide` (already the
        case in the current file) so the consumer skill never sees
        `figma_master_frames` or similar,
      - leave slide content (`title`, `subtitle`, `bullets`,
        `footer_note`, `chips`) untouched — they're tool-agnostic.

    Returns a new dict; the input is not mutated.
    """
    out = json.loads(json.dumps(copy_dict))  # cheap deep clone
    figma_keys = [k for k in list(out.keys()) if k.startswith("figma_")]
    for k in figma_keys:
        del out[k]
    if "format" in out and isinstance(out["format"], str):
        if out["format"].startswith("figma_"):
            out["format"] = "instagram_cardnews_7slide"
    return out


# ---------------------------------------------------------------------------
# Generators — README, design brief, payload, manifest.
# ---------------------------------------------------------------------------


def _extract_corpus_summary(analysis_report: dict) -> dict:
    corpus = analysis_report.get("corpus") or {}
    return {
        "n_reviews_analyzed": corpus.get("n_reviews_analyzed"),
        "n_reviews_total": corpus.get("n_reviews_total"),
        "primary_sort": corpus.get("primary_sort"),
        "sampling_strategy": corpus.get("sampling_strategy"),
        "confidence_level": corpus.get("confidence_level"),
        "signal_stability": corpus.get("signal_stability"),
        "observation_window": corpus.get("observation_window"),
    }


def _extract_product_block(analysis_report: dict) -> dict:
    return dict(analysis_report.get("product") or {})


def _extract_seller_insight_summary(analysis_report: dict) -> dict:
    """Compact summary of seller-facing insights — strengths, monitoring
    candidates, top tradeoffs. The consumer skill uses this to caption
    the cardnews; the full report is in `analysis_report.json` for
    deeper queries."""
    strengths = analysis_report.get("strengths") or []
    monitoring = analysis_report.get("monitoring_candidates") or []
    tradeoffs = analysis_report.get("tradeoffs") or []
    quick = analysis_report.get("quick_decision") or {}
    return {
        "strengths": [
            {
                "attribute_key": s.get("attribute_key"),
                "supporting_count": s.get("supporting_count"),
            }
            for s in strengths[:5]
        ],
        "monitoring_candidates": [
            {
                "attribute_key": m.get("attribute_key"),
                "concern_label_ko": m.get("concern_label_ko"),
                "n_negative": m.get("n_negative"),
                "interview_hook_ko": m.get("interview_hook_ko"),
            }
            for m in monitoring[:5]
        ],
        "top_tradeoff_pairs": [
            {"pair": t.get("pair"), "count": t.get("count")}
            for t in tradeoffs[:5]
        ],
        "verdict_ko": quick.get("verdict_ko"),
        "watch_outs_ko": quick.get("watch_outs_ko") or [],
    }


def _extract_polarity_reliability(analysis_report: dict) -> dict | None:
    """Surface the polarity_audit numbers so the creator skill knows
    the reliability footprint of the quotes it might cite. Returns
    None when the audit block is absent (legacy adapter)."""
    audit = analysis_report.get("polarity_audit")
    if not isinstance(audit, dict):
        return None
    return {
        "n_total_quotes": audit.get("n_total_quotes"),
        "n_total_suspect": audit.get("n_total_suspect"),
        "n_total_suspect_share": audit.get("n_total_suspect_share"),
        "by_attribute": audit.get("by_attribute"),
    }


# Design brief is shared — same direction across products. Product-
# specific bits (palette emphasis, profile id, audience) are merged
# in by `_build_design_brief_block`.
DEFAULT_DESIGN_BRIEF: dict = {
    "tone": "informational, credible, cosmetics editorial",
    "audience": "general buyer evaluating the product before purchase",
    "language": "ko",
    "format": {
        "primary": "instagram_carousel_7slide",
        "canvas": "1080x1350",
        "optional_variants": ["editorial_dark_photo_1080x1350"],
    },
    "palette": {
        "core": ["warm_ivory", "muted_beige", "soft_gray"],
        "accent": ["muted_sage"],
        "avoid": [
            "saturated_red", "neon", "high_contrast_black_white",
            "medical_blue",
        ],
    },
    "typography": {
        "primary_korean": "Pretendard Variable",
        "primary_latin": "Inter",
        "rules": [
            "short bullets — keep each line under 36 Hangul characters",
            "title weight ≥ 600; body weight 400–500",
            "no all-caps Korean",
        ],
    },
    "imagery_rules": {
        "required": [
            "tone-matched flat compositions OR product-only crops",
            "neutral lighting, low specular highlights",
        ],
        "forbidden": [
            "human faces",
            "before/after comparisons",
            "medical visuals (microscope / cell / clinic)",
            "brand logo dependency",
            "skin condition close-ups (irritation / scarring)",
            "stock-photo influencer poses",
        ],
    },
    "voice_rules": {
        "must": [
            "review-grounded, hedged ('후기', '의견', '검토 후보')",
            "explicit count framing ('만족 후기 N건', '불만 후기 M건')",
            "methodology disclaimer on the final slide",
        ],
        "must_not": [
            "medical / efficacy claims (효과·효능·치료·진정 단정)",
            "superlatives ('최고', '1위', '인생템', '필수템')",
            "directives ('반드시', '절대', '꼭')",
            "exaggerated skincare promises",
            "ad-like or influencer copy",
        ],
    },
    "final_slide": {
        "must_contain_disclaimer_ko": (
            "공개 리뷰 데이터를 정리한 자료입니다. "
            "무작위 표본이 아니며 특정 결과를 보장하지 않습니다."
        ),
    },
}


def _build_design_brief_block(product: dict) -> dict:
    """Compose the design brief — base direction + per-product context."""
    profile_id = product.get("selected_profile_id")
    out = json.loads(json.dumps(DEFAULT_DESIGN_BRIEF))
    out["product_context"] = {
        "name_ko": product.get("name_ko"),
        "category_ko": product.get("category"),
        "profile_id": profile_id,
    }
    # Profile-aware emphasis vocabulary (kept to a small whitelist so
    # the creator skill can caption with category-appropriate nouns).
    if profile_id == "skincare_pad":
        out["emphasis_keywords_ko"] = [
            "촉촉", "패드", "에센스 양", "용기", "트위저", "데일리",
        ]
        out["suppress_keywords_ko"] = [
            "발색", "립", "립스틱", "웜톤", "쿨톤",
        ]
    elif profile_id == "makeup_blush":
        out["emphasis_keywords_ko"] = [
            "발색", "지속력", "묻어남", "도구", "발림성",
        ]
        out["suppress_keywords_ko"] = []
    return out


def _build_claim_safety_block(buyer_copy: dict) -> dict:
    """Restate the claim-safety contract that the cardnews copy
    already satisfies. The creator skill MUST NOT relax these."""
    return {
        "review_corpus_disclosure_required": True,
        "no_efficacy_claims": True,
        "no_medical_claims": True,
        "no_superlatives": True,
        "no_directive_imperatives": True,
        "global_footer_disclaimer_ko": buyer_copy.get(
            "global_footer_disclaimer_ko",
        ),
        "banned_korean_morphemes": [
            "효과", "효능", "치료", "진정",
            "최고", "1위", "인생템", "필수템",
            "반드시", "절대",
        ],
    }


def _build_creator_payload(
    *,
    run_id: str,
    product: dict,
    corpus: dict,
    buyer_copy: dict,
    seller_insights: dict,
    polarity_reliability: dict | None,
    design_brief: dict,
    claim_safety: dict,
    source_files: dict[str, dict],
    collection_summary: dict | None,
    handoff_warnings: list[dict] | None = None,
) -> dict:
    payload: dict = {
        "schema_version": "1.0",
        "kind": "creator_handoff_payload",
        "generated_at": _utc_iso_now(),
        "run_id": run_id,
        "product": product,
        "corpus": corpus,
        "buyer_cardnews": buyer_copy,
        "seller_insights_summary": seller_insights,
        "design_brief": design_brief,
        "claim_safety": claim_safety,
        "source_files": source_files,
        "handoff_warnings": list(handoff_warnings or []),
    }
    if polarity_reliability is not None:
        payload["polarity_reliability"] = polarity_reliability
    if collection_summary is not None:
        payload["collection_provenance"] = collection_summary
    return payload


# ---------------------------------------------------------------------------
# README / brief markdown rendering
# ---------------------------------------------------------------------------


def _render_readme(
    *,
    run_id: str,
    product: dict,
    corpus: dict,
    seller_insights: dict,
    polarity_reliability: dict | None,
    collection_summary: dict | None,
    package_files: list[str],
    handoff_warnings: list[dict] | None = None,
) -> str:
    name_ko = product.get("name_ko") or "(unknown product)"
    goods_no = (collection_summary or {}).get("goodsNo")
    if not goods_no:
        url = product.get("source_url") or ""
        # Best-effort goodsNo extraction from URL.
        import re as _re
        m = _re.search(r"[?&]goodsNo=([A-Za-z0-9]+)", url)
        goods_no = m.group(1) if m else "(unknown)"
    profile = product.get("selected_profile_id") or "(unspecified)"
    category = product.get("category") or "(uncategorized)"
    n_analyzed = corpus.get("n_reviews_analyzed")
    confidence = corpus.get("confidence_level")
    sampling = corpus.get("sampling_strategy")
    verdict = seller_insights.get("verdict_ko") or "(see analysis_report.json)"

    # Caveat fragments — composed conditionally.
    caveat_lines: list[str] = [
        "- This is an **observed review corpus**, not a random sample. "
        "Headline counts (만족 후기 N건 / 불만 후기 M건) reflect what a "
        "consumer can reach by switching OliveYoung sort tabs, not "
        "population-level distributions.",
        "- This is **not a medical or efficacy claim**. Do not introduce "
        "wording like 효과 / 효능 / 치료 / 진정 as guaranteed outcomes.",
        "- **No exaggerated skincare claims.** The buyer copy is hedged "
        "(`만족 후기 N건이 누적된 강점이지만, …`) — preserve that hedging.",
    ]
    polarity_note = ""
    if polarity_reliability:
        n_sus = polarity_reliability.get("n_total_suspect") or 0
        n_tot = polarity_reliability.get("n_total_quotes") or 0
        if n_tot > 0:
            polarity_note = (
                f"\n  - polarity guardrail: {n_sus} of {n_tot} quotes "
                f"flagged suspect; suspect quotes were filtered from "
                f"watch-out surfaces but kept in the audit sidecar. "
                f"If you cite a quote directly, verify polarity matches "
                f"the section it appears in."
            )
    if polarity_note:
        caveat_lines.append(
            "- Quote reliability is not perfect. Stage 2 polarity "
            "classification produced some mislabeled spans;"
            + polarity_note
        )
    if collection_summary:
        partial = collection_summary.get("partial_success")
        sorts_failed = collection_summary.get("sorts_failed") or []
        if partial:
            caveat_lines.append(
                f"- **Partial collection.** {len(sorts_failed)} sort(s) "
                f"failed during scrape ({sorts_failed!r}). The corpus is "
                f"smaller than a fully-successful run would produce; "
                f"sort-tail bias is more pronounced. Mention the sample "
                f"size honestly in the cardnews."
            )
        analysis_status = collection_summary.get("analysis_status")
        if analysis_status == "pending":
            caveat_lines.append(
                "- ⚠ The pipeline emitted this package while "
                "`analysis_status=pending`. Stage 1/2/3 / aggregation "
                "may not have completed. Cross-check against "
                "`analysis_report.json` before publishing."
            )
    caveat_lines.append(
        "- **LLM polish may be unavailable** in the prior pipeline run. "
        "If `manifest.json:safety.fallback_to_skeleton == true`, the "
        "cardnews copy is the deterministic skeleton — phrasing is "
        "literal, not editorially polished. The creator skill can "
        "polish; it must not introduce claims."
    )

    files_md = "\n".join(f"- `{p}`" for p in sorted(package_files))

    # Handoff warnings section. Emitted whenever the validator
    # produced anything — both blocking warnings and informational
    # notes appear so the creator skill sees the full audit context.
    handoff_warnings = list(handoff_warnings or [])
    blocking_count = sum(
        1 for w in handoff_warnings
        if w.get("severity") == "warning"
    )
    if handoff_warnings:
        warnings_lines = [
            "## Handoff warnings",
            "",
        ]
        if blocking_count:
            warnings_lines.append(
                f"⚠ **{blocking_count} consistency warning(s) detected.** "
                f"The buyer cardnews copy in this package disagrees with "
                f"`analysis_report.json` on at least one numeric review "
                f"count. Treat the analysis report as the source of "
                f"truth; if you cite a count in the final visual, use "
                f"the analysis report's value (or omit the count)."
            )
            warnings_lines.append("")
        for w in handoff_warnings:
            sev = (w.get("severity") or "info").upper()
            code = w.get("code") or "unknown"
            msg = w.get("message") or ""
            field = w.get("field")
            line = f"- **[{sev}] {code}**"
            if field:
                line += f" at `{field}`"
            line += f" — {msg}"
            warnings_lines.append(line)
        warnings_md = "\n".join(warnings_lines) + "\n"
    else:
        warnings_md = (
            "## Handoff warnings\n\n"
            "_None — buyer cardnews copy is consistent with the analysis "
            "report._\n"
        )

    seller_top_strengths = seller_insights.get("strengths") or []
    seller_top_monitoring = seller_insights.get("monitoring_candidates") or []
    strengths_md = "\n".join(
        f"  - `{s.get('attribute_key')}` — {s.get('supporting_count')} "
        f"supporting reviews"
        for s in seller_top_strengths[:5]
    ) or "  _(no strengths surfaced — see analysis_report.json)_"
    watch_outs_md = "\n".join(
        f"  - `{m.get('attribute_key')}` ({m.get('concern_label_ko')}) "
        f"— {m.get('n_negative')} negative reviews"
        for m in seller_top_monitoring[:5]
    ) or "  _(no monitoring candidates — see analysis_report.json)_"

    return f"""# Creator handoff — {name_ko}

This package is the **single input** for the external Claude session
or custom skill that will produce the final visual report or cardnews.
Read this file first, then `creator_payload.json` for structured
inputs.

---

## Product

| Field | Value |
|---|---|
| Name (Korean) | {name_ko} |
| goodsNo | `{goods_no}` |
| Category | {category} |
| Profile id | `{profile}` |
| Source URL | {product.get("source_url") or "(unspecified)"} |
| Run id | `{run_id}` |

## Corpus

| Field | Value |
|---|---:|
| Reviews analyzed | {n_analyzed if n_analyzed is not None else "?"} |
| Confidence level | {confidence or "?"} |
| Sampling strategy | `{sampling or "?"}` |
| Primary sort | `{corpus.get("primary_sort") or "?"}` |

## Intended audience & content goal

- **Audience:** Korean retail buyer evaluating this product before
  purchase. Not a power user, not an influencer, not a clinician.
- **Goal:** Surface what reviewers actually said (strengths + frictions)
  in a 7-slide Instagram carousel format. The reader should walk away
  with: (a) what people consistently like, (b) where opinions split,
  (c) who the product fits, (d) what to check before buying.

## Seller-side highlights (from `analysis_report.json`)

**Top strengths**

{strengths_md}

**Top watch-outs**

{watch_outs_md}

**Headline verdict**

> {verdict}

## Available input files

{files_md}

The structured payload is `creator_payload.json`. The deterministic
buyer cardnews copy is `buyer_cardnews_copy_ko.json` (7 slides,
already claim-safe). Use those as the primary source. Cross-reference
`analysis_report.json` for any quote, count, or attribute key.

## What the external Claude skill should generate

1. **A polished 7-slide Instagram carousel** at 1080×1350.
2. Each slide visualizes one section type from the cardnews copy:
   `hook` → `loved` → `divides` → `fit` → `watch_outs` → `best_for`
   → `method`.
3. The methodology disclaimer **must** appear on the final slide
   verbatim from `claim_safety.global_footer_disclaimer_ko`.
4. Optional: an editorial dark-photo variant in the same dimensions.

See `content_design_brief.md` for the tool-agnostic creative direction
(palette, typography, imagery rules, voice rules) and `quality_review.md`
for the prior reviewer's notes on this specific cardnews copy.

## Caveats — non-negotiable

{chr(10).join(caveat_lines)}

---

{warnings_md}
---

If anything in this package conflicts with `claim_safety` in
`creator_payload.json`, the `claim_safety` block wins.
"""


def _render_design_brief(brief: dict, product: dict) -> str:
    name_ko = product.get("name_ko") or "(unknown product)"
    profile = product.get("selected_profile_id") or "(unspecified)"
    palette = brief.get("palette") or {}
    typography = brief.get("typography") or {}
    imagery = brief.get("imagery_rules") or {}
    voice = brief.get("voice_rules") or {}

    def _bullets(items):
        return "\n".join(f"- {it}" for it in (items or [])) or "_(none)_"

    return f"""# Content design brief — {name_ko}

Tool-agnostic creative direction. The output can be produced in any
environment that can render Korean typography on a 1080×1350 canvas.
This brief specifies tone, palette, typography, imagery rules, and
voice rules — not a specific design tool or layout system.

---

## Tone & audience

- **Tone:** {brief.get("tone")}
- **Audience:** {brief.get("audience")}
- **Language:** Korean ({brief.get("language") or "ko"})
- **Profile context:** `{profile}`

## Format

- **Primary:** {brief.get("format", {}).get("primary")}
- **Canvas:** {brief.get("format", {}).get("canvas")}
- **Optional variants:** {", ".join(brief.get("format", {}).get("optional_variants") or []) or "_(none)_"}

## Palette

- **Core:** {", ".join(palette.get("core") or [])}
- **Accent:** {", ".join(palette.get("accent") or [])}
- **Avoid:** {", ".join(palette.get("avoid") or [])}

The direction is warm ivory / muted beige / soft gray with a single
muted-sage accent. Never saturate — the surface should read as
editorial / informational, not promotional.

## Typography

- **Korean:** {typography.get("primary_korean")}
- **Latin:** {typography.get("primary_latin")}
- **Rules:**
{_bullets(typography.get("rules"))}

## Imagery rules

**Required**

{_bullets(imagery.get("required"))}

**Forbidden**

{_bullets(imagery.get("forbidden"))}

Notably forbidden: human faces, before/after imagery, medical visuals,
brand logo dependency. The piece must read as a buyer-facing review
summary, not an ad.

## Voice rules

**Must**

{_bullets(voice.get("must"))}

**Must NOT**

{_bullets(voice.get("must_not"))}

## Final slide — methodology

The final slide MUST carry this disclaimer verbatim:

> {brief.get("final_slide", {}).get("must_contain_disclaimer_ko")}

## What this brief intentionally does NOT specify

- Pixel measurements per element. Layout decisions are the creator's.
- Specific photographs or illustrations. The creator chooses imagery
  consistent with the palette and the imagery rules.
- A specific design tool, plugin, or template. The buyer cardnews
  copy is tool-agnostic; render it in whatever environment best
  suits the creator skill.
"""


def _render_quality_review_fallback(product: dict, package_files: list[str]) -> str:
    """When no `quality_review.md` exists alongside the input copy,
    emit a stub so the package always has the file."""
    return f"""# Quality review — {product.get('name_ko') or 'untitled'}

_No quality_review.md was found alongside the input cardnews copy.
This stub is the fallback. The creator should treat the cardnews
copy as the primary source of truth and verify each slide against
`analysis_report.json`._

## Files in package

{chr(10).join(f"- `{p}`" for p in sorted(package_files))}

## Recommended pre-publish checks

- Each `bullets` count cited (e.g. `만족 후기 N건`) matches the
  count in `analysis_report.json`.
- The methodology disclaimer is present on the final slide.
- No banned tokens (효과 / 효능 / 최고 / 1위 / 인생템 / 반드시 / 절대).
- No human faces, before/after, or medical visuals.
"""


def _render_manifest(
    *,
    run_id: str,
    product: dict,
    package_files: dict[str, Path],
    out_dir: Path,
    source_run_dir: Path,
    source_content_copy: Path,
    handoff_warnings: list[dict] | None = None,
) -> dict:
    """Package-level manifest — distinct from the run's manifest.json.
    Records every file in the package with its sha256 + bytes so the
    creator skill can detect tampering or re-render mismatches."""
    files_block: dict[str, dict] = {}
    for rel_path, abs_path in package_files.items():
        if not abs_path.is_file():
            continue
        files_block[rel_path] = {
            "sha256": _sha256(abs_path),
            "bytes": abs_path.stat().st_size,
        }
    return {
        "schema_version": "1.0",
        "kind": "creator_handoff_manifest",
        "run_id": run_id,
        "generated_at": _utc_iso_now(),
        "product": product,
        "files": files_block,
        "sources": {
            "run_dir": str(source_run_dir),
            "content_copy_input": str(source_content_copy),
        },
        "handoff_warnings": list(handoff_warnings or []),
    }


# ---------------------------------------------------------------------------
# Consistency validation — buyer cardnews copy vs analysis_report
# ---------------------------------------------------------------------------
#
# The buyer cardnews copy is generated upstream (LLM polish step or
# deterministic skeleton) and shipped verbatim by this packager. If
# the upstream pipeline regenerated `analysis_report.json` after the
# copy was authored — for example, a Stage 2 re-run — the headline
# review count in the copy can drift away from `n_reviews_analyzed`.
# This validator catches that drift and surfaces it; it never
# rewrites the copy.
#
# Detection scope:
#   - Structured: `corpus_summary.n_reviews_analyzed` if present.
#   - Narrative: any string value containing the pattern `리뷰 N건`
#     (with comma-allowed digits). Per-attribute counts ("만족 후기
#     N건", "불만 후기 N건") are scoped on the noun "후기" rather than
#     "리뷰" and are NOT corpus-total mentions, so they're correctly
#     excluded by the regex.
#
# Warning shape (codes are stable; field paths help operators triage):
#   {"code": "review_count_mismatch" | "copy_count_not_found",
#    "severity": "warning" | "info",
#    "field": "<dotted location>",  // optional
#    "expected": int,               // optional
#    "found": int,                  // optional
#    "message": "..."}


# Pattern intentionally anchored on `리뷰` (not `후기`) so per-attribute
# counts like `만족 후기 157건` don't trigger. Allows optional comma-
# separated digits and an optional space before `건`. The `(?:공개\s+)?`
# group lets `공개 리뷰 N건` match without changing the captured count.
_REVIEW_COUNT_RE: re.Pattern = re.compile(
    r"(?:공개\s+)?리뷰\s*([0-9][0-9,]*)\s*건",
)


def _walk_strings(node: Any, path: str = "") -> Any:
    """Yield (string, dotted_path) tuples for every string value in a
    nested JSON-shaped object. Used for narrative count scanning."""
    if isinstance(node, str):
        yield node, path
        return
    if isinstance(node, list):
        for i, item in enumerate(node):
            yield from _walk_strings(item, f"{path}[{i}]")
        return
    if isinstance(node, dict):
        for k, v in node.items():
            child_path = f"{path}.{k}" if path else k
            yield from _walk_strings(v, child_path)


def _extract_count_mentions_from_copy(
    buyer_copy: dict,
) -> list[tuple[int, str, str]]:
    """Return (count, source_kind, location) for every review-count
    mention found in the cardnews copy.

    `source_kind` is `"structured"` for the dedicated
    `corpus_summary.n_reviews_analyzed` field, or `"narrative"` for
    regex hits over string values.
    """
    out: list[tuple[int, str, str]] = []
    cs = buyer_copy.get("corpus_summary")
    if isinstance(cs, dict):
        n = cs.get("n_reviews_analyzed")
        if isinstance(n, int):
            out.append((int(n), "structured",
                        "corpus_summary.n_reviews_analyzed"))
    for s, path in _walk_strings(buyer_copy):
        for m in _REVIEW_COUNT_RE.finditer(s):
            digits = m.group(1).replace(",", "")
            if not digits:
                continue
            try:
                value = int(digits)
            except ValueError:
                continue
            out.append((value, "narrative", path))
    return out


def validate_count_consistency(
    buyer_copy: dict,
    analysis_report: dict,
) -> list[dict]:
    """Compare review-count mentions in `buyer_copy` against
    `analysis_report.corpus.n_reviews_analyzed`. Returns a list of
    warning dicts. Empty list when fully consistent or when the
    expected count is missing.

    Pure: no I/O, no mutation.
    """
    corpus = analysis_report.get("corpus") if isinstance(analysis_report, dict) else None
    expected = (corpus or {}).get("n_reviews_analyzed")
    if not isinstance(expected, int):
        # Without a baseline we cannot judge.
        return [{
            "code": "expected_count_missing",
            "severity": "info",
            "message": (
                "analysis_report.corpus.n_reviews_analyzed is absent or "
                "non-integer; consistency check skipped."
            ),
        }]
    mentions = _extract_count_mentions_from_copy(buyer_copy)
    if not mentions:
        return [{
            "code": "copy_count_not_found",
            "severity": "info",
            "message": (
                "buyer_cardnews_copy_ko.json contains no review-count "
                "mention; cannot cross-check against analysis_report."
            ),
        }]
    warnings: list[dict] = []
    seen_locations: set[str] = set()
    for found, kind, location in mentions:
        if found == expected:
            continue
        # Deduplicate by (location, found) so the same drift doesn't
        # surface as N nearly-identical warnings when the copy
        # repeats the same mention.
        key = f"{location}:{found}"
        if key in seen_locations:
            continue
        seen_locations.add(key)
        warnings.append({
            "code": "review_count_mismatch",
            "severity": "warning",
            "field": location,
            "source_kind": kind,
            "expected": expected,
            "found": found,
            "message": (
                f"buyer_cardnews_copy_ko.json mentions {found:,} reviews "
                f"at {location} ({kind}); "
                f"analysis_report.corpus.n_reviews_analyzed reports "
                f"{expected:,}. The cardnews count is stale or has drifted."
            ),
        })
    return warnings


def _has_blocking_warnings(warnings: list[dict]) -> bool:
    """True when any warning has severity='warning' (i.e. not just info)."""
    return any(
        (w or {}).get("severity") == "warning" for w in warnings
    )


# ---------------------------------------------------------------------------
# Main package builder
# ---------------------------------------------------------------------------


class ConsistencyError(RuntimeError):
    """Raised when `strict_consistency=True` and the validator finds a
    blocking warning (e.g. review-count mismatch). The exception's
    `warnings` attribute carries the full list so the CLI can print
    operator-readable context before exiting."""

    def __init__(self, warnings: list[dict]):
        self.warnings = warnings
        codes = sorted({(w.get("code") or "?") for w in warnings
                        if w.get("severity") == "warning"})
        super().__init__(
            f"strict_consistency: {len(warnings)} warning(s) "
            f"(codes={codes}). Run without --strict-consistency to "
            f"package anyway; warnings will still be embedded in "
            f"README / payload / manifest."
        )


def build_package(
    *,
    run_dir: Path,
    content_copy_path: Path,
    out_dir: Path,
    strict_consistency: bool = False,
) -> dict:
    """Assemble the creator handoff package. Returns the manifest dict.

    `strict_consistency=True` raises `ConsistencyError` when the
    validator finds any blocking warning (e.g. the buyer cardnews
    copy mentions a review count that disagrees with
    `analysis_report.corpus.n_reviews_analyzed`). Default behavior
    is non-blocking — warnings are still embedded in README,
    creator_payload, and manifest so the consumer skill sees them.
    """
    if not run_dir.is_dir():
        raise FileNotFoundError(f"--run-dir not found: {run_dir}")
    if not content_copy_path.is_file():
        raise FileNotFoundError(
            f"--content-copy not found: {content_copy_path}"
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "shared").mkdir(parents=True, exist_ok=True)

    # ---- Required inputs ----
    missing: list[str] = []
    for rel, _key in REQUIRED_INPUTS_FROM_RUN:
        if not (run_dir / rel).is_file():
            missing.append(rel)
    if missing:
        raise FileNotFoundError(
            f"required input(s) missing under {run_dir}: {missing}"
        )

    # Copy seller PDF + analysis_report + brief.
    _copy_with_parent_mkdir(
        run_dir / "seller_report" / "seller_report_ko.pdf",
        out_dir / "seller_report_ko.pdf",
    )
    _copy_with_parent_mkdir(
        run_dir / "shared" / "analysis_report.json",
        out_dir / "shared" / "analysis_report.json",
    )
    _copy_with_parent_mkdir(
        run_dir / "shared" / "consumer_insight_brief.json",
        out_dir / "shared" / "consumer_insight_brief.json",
    )

    # Copy the buyer cardnews copy under the neutral name.
    raw_copy = _safe_load_json(content_copy_path)
    if not isinstance(raw_copy, dict):
        raise ValueError(
            f"--content-copy is not a JSON object: {content_copy_path}"
        )
    neutral_copy = _strip_tool_specific_fields(raw_copy)
    _atomic_write(
        out_dir / "buyer_cardnews_copy_ko.json",
        json.dumps(neutral_copy, ensure_ascii=False, indent=2) + "\n",
    )

    # quality_review.md — copy through if present alongside input copy,
    # else generate a stub.
    qr_src = content_copy_path.parent / "quality_review.md"
    if qr_src.is_file():
        _copy_with_parent_mkdir(qr_src, out_dir / "quality_review.md")
        qr_was_copied = True
    else:
        qr_was_copied = False  # filled in below after we know package_files

    # ---- Optional sidecars ----
    collection_summary = None
    cs_path = run_dir / "shared" / "collection_summary.json"
    if cs_path.is_file():
        collection_summary = _safe_load_json(cs_path)

    # ---- Generate brief / README / payload ----
    analysis_report = _safe_load_json(
        run_dir / "shared" / "analysis_report.json",
    ) or {}
    product = _extract_product_block(analysis_report)
    corpus = _extract_corpus_summary(analysis_report)
    seller_insights = _extract_seller_insight_summary(analysis_report)
    polarity_reliability = _extract_polarity_reliability(analysis_report)
    design_brief = _build_design_brief_block(product)
    claim_safety = _build_claim_safety_block(neutral_copy)

    # Consistency validation — buyer copy vs analysis_report. Pure
    # check; raises only when `strict_consistency=True` AND there is
    # at least one blocking (severity='warning') item.
    handoff_warnings = validate_count_consistency(
        neutral_copy, analysis_report,
    )
    if strict_consistency and _has_blocking_warnings(handoff_warnings):
        raise ConsistencyError(handoff_warnings)

    run_id = run_dir.name

    # Pre-compute the package_files list for README/quality fallback.
    package_files_relative: list[str] = list(PACKAGE_REQUIRED_FILES)
    if collection_summary is not None:
        package_files_relative.append("shared/collection_summary.json")

    if not qr_was_copied:
        _atomic_write(
            out_dir / "quality_review.md",
            _render_quality_review_fallback(product, package_files_relative),
        )

    # design brief
    _atomic_write(
        out_dir / "content_design_brief.md",
        _render_design_brief(design_brief, product),
    )

    # creator_payload.json
    source_files_block: dict[str, dict] = {
        "seller_report_ko_pdf": {"path": "seller_report_ko.pdf"},
        "analysis_report_json": {"path": "shared/analysis_report.json"},
        "consumer_insight_brief_json": {
            "path": "shared/consumer_insight_brief.json",
        },
        "buyer_cardnews_copy_ko_json": {
            "path": "buyer_cardnews_copy_ko.json",
        },
        "content_design_brief_md": {"path": "content_design_brief.md"},
        "quality_review_md": {"path": "quality_review.md"},
        "readme_md": {"path": "README_FOR_CREATOR.md"},
    }
    if collection_summary is not None:
        # Copy the collection_summary into the package shared/.
        _copy_with_parent_mkdir(
            cs_path, out_dir / "shared" / "collection_summary.json",
        )
        source_files_block["collection_summary_json"] = {
            "path": "shared/collection_summary.json",
        }

    payload = _build_creator_payload(
        run_id=run_id,
        product=product,
        corpus=corpus,
        buyer_copy=neutral_copy,
        seller_insights=seller_insights,
        polarity_reliability=polarity_reliability,
        design_brief=design_brief,
        claim_safety=claim_safety,
        source_files=source_files_block,
        collection_summary=collection_summary,
        handoff_warnings=handoff_warnings,
    )
    _atomic_write(
        out_dir / "creator_payload.json",
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    )

    # README — depends on package_files (now finalized).
    _atomic_write(
        out_dir / "README_FOR_CREATOR.md",
        _render_readme(
            run_id=run_id,
            product=product,
            corpus=corpus,
            seller_insights=seller_insights,
            polarity_reliability=polarity_reliability,
            collection_summary=collection_summary,
            package_files=package_files_relative,
            handoff_warnings=handoff_warnings,
        ),
    )

    # Package-level manifest — last so all SHA-256 reads land on
    # finalized files.
    package_files_abs: dict[str, Path] = {
        rel: out_dir / rel for rel in package_files_relative
    }
    manifest = _render_manifest(
        run_id=run_id,
        product=product,
        package_files=package_files_abs,
        out_dir=out_dir,
        source_run_dir=run_dir,
        source_content_copy=content_copy_path,
        handoff_warnings=handoff_warnings,
    )
    _atomic_write(
        out_dir / "manifest.json",
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
    )

    # ---- Validate every required file landed ----
    for rel in PACKAGE_REQUIRED_FILES:
        abs_p = out_dir / rel
        if not abs_p.is_file():
            raise RuntimeError(
                f"package validation failed: missing {abs_p}"
            )
    return manifest


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _print_tree(out_dir: Path) -> None:
    print(f"\n  {out_dir}/")
    for p in sorted(out_dir.rglob("*")):
        if p.is_dir():
            continue
        rel = p.relative_to(out_dir)
        depth = len(rel.parts) - 1
        indent = "  " + ("  " * (depth + 1))
        size_kb = p.stat().st_size / 1024
        print(f"{indent}{rel}  ({size_kb:.1f} KB)")
    print()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="package_creator_handoff",
        description=__doc__.split("\n\n")[0],
    )
    p.add_argument(
        "--run-dir", type=Path, required=True,
        help="Path to the pipeline run directory "
             "(must contain manifest.json + shared/analysis_report.json + "
             "seller_report/seller_report_ko.pdf + "
             "shared/consumer_insight_brief.json).",
    )
    p.add_argument(
        "--content-copy", type=Path, required=True,
        help="Path to the buyer cardnews copy JSON (typically the prior "
             "Figma-flavored figma_cardnews_copy_ko.json — copied under a "
             "neutral name in the output package).",
    )
    p.add_argument(
        "--out-dir", type=Path, required=True,
        help="Path to the output package directory. Created if missing.",
    )
    p.add_argument(
        "--strict-consistency", action="store_true",
        help=(
            "Fail with non-zero exit when the buyer cardnews copy "
            "disagrees with analysis_report.json on a numeric review "
            "count. Default behavior is non-blocking — warnings are "
            "embedded in the package's README, creator_payload, and "
            "manifest so the consumer skill sees them, but the package "
            "still gets built."
        ),
    )
    args = p.parse_args(argv)

    try:
        manifest = build_package(
            run_dir=args.run_dir.resolve(),
            content_copy_path=args.content_copy.resolve(),
            out_dir=args.out_dir.resolve(),
            strict_consistency=bool(args.strict_consistency),
        )
    except ConsistencyError as e:
        # Print the warnings the validator collected so the operator
        # can decide whether to re-run without --strict-consistency
        # or fix the buyer copy.
        print(f"✗ {e}", file=sys.stderr)
        for w in e.warnings:
            sev = (w.get("severity") or "info").upper()
            field = f" at {w.get('field')!r}" if w.get("field") else ""
            print(f"  [{sev}] {w.get('code')}{field} — {w.get('message')}",
                  file=sys.stderr)
        return 4
    except (FileNotFoundError, ValueError) as e:
        print(f"✗ {e}", file=sys.stderr)
        return 2
    except RuntimeError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 3

    warnings = manifest.get("handoff_warnings") or []
    blocking = sum(1 for w in warnings if w.get("severity") == "warning")
    print(f"✓ creator handoff package built at {args.out_dir}")
    print(f"  run_id      : {manifest['run_id']}")
    print(f"  files       : {len(manifest['files'])}")
    print(
        f"  product     : {manifest.get('product', {}).get('name_ko') or '(unknown)'}"
    )
    if blocking:
        print(
            f"  ⚠ warnings  : {blocking} consistency warning(s) embedded "
            f"in README / creator_payload / manifest — see the README "
            f"'Handoff warnings' section."
        )
    _print_tree(args.out_dir.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
