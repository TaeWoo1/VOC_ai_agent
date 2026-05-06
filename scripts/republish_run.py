"""Re-publish a run directory with the latest code WITHOUT re-running
Stage 1/2 (no fresh LLM calls, no re-scrape).

Use case: the upstream `analysis_report.json` already encodes Stage 2's
verdict (per-attribute polarity counts + sample evidences). Code
changes downstream of aggregation — display paraphrase, confidence
axes, PDF wording, cardnews layout — can be reapplied without rerunning
the LLM. This script does exactly that.

Steps:
  1. Read existing `shared/analysis_report.json` + `shared/collection_summary.json`.
  2. Reconstruct a `ProductReportData` from the analysis_report's
     attributes / strengths / monitoring_candidates / tradeoffs.
  3. Run the v3.0 adapter (`productreportdata_to_analysis_report`)
     with current code — adds `corpus.confidence_axes`, recomputes
     `display_text` via the polarity-aware synthesizer, picks up
     reader-friendly wording.
  4. Re-render the seller PDF with current code (new section headers,
     surface-aware wording, etc.).
  5. Re-build `buyer_content/ko/buyer_journey_cardnews.json`.
  6. Patch the manifest with the new artifact slot.

Hard rules
----------
- Raw `text` field in every quote is copied verbatim from the
  existing analysis_report. NEVER mutated.
- Stage 2 polarity verdicts are preserved verbatim; this script only
  changes derived/display fields.
- Idempotent: running twice produces the same output.

Usage
-----

    PYTHONPATH=. python3 scripts/republish_run.py \
        --run-dir outputs/2026-05-02_product-83743e299623_run-003

Exit codes
----------
  0 — republish succeeded
  2 — invalid args / required artifact missing
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from src.voc.content.adapters.from_phase2e import (  # noqa: E402
    productreportdata_to_analysis_report,
)
from src.voc.content.cardnews_buyer_journey import (  # noqa: E402
    build_buyer_journey_cardnews,
)
from src.voc.content.manifest import compute_sha256  # noqa: E402
from src.voc.content.profiles import (  # noqa: E402
    PROFILE_DEFAULT,
    select_profile_id,
    suppressed_attributes_for,
)
from src.voc.reporting.phase2e.report import (  # noqa: E402
    AttributeSummary, ProductReportData,
)


def _split_category_path(category: str | None) -> list[str] | None:
    """Parse `product.category` into a list of breadcrumb nodes.

    The pipeline writes category as a single string, with " > " (or
    " &gt; ") as the node separator when --category-mode=full_path
    was used. Leaf-only mode produces a single-node string. Either
    shape is split here so the profile resolver gets the same
    Iterable[str] it received during the original run.
    """
    if not isinstance(category, str):
        return None
    s = category.strip()
    if not s:
        return None
    # Tolerate both Korean spaced ">" and HTML-escaped form.
    parts = re.split(r"\s*(?:>|&gt;)\s*", s)
    nodes = [p.strip() for p in parts if p and p.strip()]
    return nodes or None


def _resolve_republish_profile(
    product: dict,
) -> tuple[str, frozenset[str]]:
    """Recompute (selected_profile_id, suppressed_attributes) for a
    republish run.

    Pass-19G: republish previously trusted whatever value was saved
    on `analysis_report.product.selected_profile_id`. That meant a
    run captured before a routing fix (e.g. lip_makeup added in
    Pass-19G) kept its stale `default` profile forever, so neither
    the renderer nor the adapter could pick up the new profile-aware
    fallback table.

    The new contract:
      * Always re-resolve from `category` + `name_ko`.
      * If the resolver yields a non-default profile, use it.
      * If the resolver yields `default` AND the saved value is a
        known non-default profile, preserve the saved value
        (operator may have hand-pinned a less-keyword-obvious case).
      * Suppressed-attribute set is recomputed from whichever profile
        wins, so a saved skincare_pad → lip_makeup transition also
        flips suppression correctly.
    """
    saved_profile = (product.get("selected_profile_id") or "").strip() or None
    category_path = _split_category_path(product.get("category"))
    product_name = product.get("name_ko") or product.get("display_product_name") or ""
    resolved = select_profile_id(
        category_path=category_path,
        product_name=product_name,
    )
    if resolved != PROFILE_DEFAULT:
        chosen = resolved
    elif saved_profile and saved_profile != PROFILE_DEFAULT:
        chosen = saved_profile
    else:
        chosen = PROFILE_DEFAULT
    return chosen, suppressed_attributes_for(chosen)


def _reconstruct_product_report_data(
    analysis_report: dict,
) -> ProductReportData:
    """Rebuild ProductReportData from an existing analysis_report.

    The PDF renderer takes ProductReportData as input — we don't have
    the original on disk, but the analysis_report carries everything
    we need to reconstruct it: per-attribute polarity counts, sample
    evidences, tradeoff pairs. We can't recover `n_records` exactly
    because Stage 2 records aren't in the report; we approximate by
    summing per-attribute totals (close enough for layout purposes).
    """
    product = analysis_report.get("product") or {}
    corpus = analysis_report.get("corpus") or {}
    n_reviews = int(corpus.get("n_reviews_analyzed") or 0)

    attribute_summaries: dict[str, AttributeSummary] = {}
    n_records = 0
    for a in analysis_report.get("attributes") or []:
        key = a.get("key")
        if not key:
            continue
        n_pos = int(a.get("n_positive") or 0)
        n_neg = int(a.get("n_negative") or 0)
        n_mix = int(a.get("n_mixed") or 0)
        s = AttributeSummary(attribute=key)
        s.n_total = n_pos + n_neg + n_mix
        s.n_positive = n_pos
        s.n_negative = n_neg
        s.n_mixed = n_mix
        # The split into negative_weak / negative_strong is no longer
        # observable from the report; pretend everything is weak so
        # the PDF distribution chart still renders.
        s.n_neg_weak = n_neg
        s.n_neg_strong = 0
        # Reconstruct sample evidence dicts from top_quotes. Stage 2
        # records carried `evidence_span`; the v3 schema renames to
        # `text`. We pass both keys so downstream callers find what
        # they expect.
        pos_ev: list[dict] = []
        neg_ev: list[dict] = []
        for q in a.get("top_quotes") or []:
            ev = {
                "text": q.get("text"),
                "evidence_span": q.get("text"),
                "review_id": q.get("review_id"),
                "polarity": q.get("polarity"),
                "rating": q.get("rating"),
                "char_start": q.get("char_start"),
                "char_end": q.get("char_end"),
            }
            pol = (q.get("polarity") or "").lower()
            if pol in ("positive", "pos"):
                pos_ev.append(ev)
            elif pol in (
                "negative_weak", "negative_strong", "negative", "neg", "mixed",
            ):
                neg_ev.append(ev)
        s.sample_evidences_pos = pos_ev
        s.sample_evidences_neg = neg_ev
        attribute_summaries[key] = s
        n_records += s.n_total

    tradeoff_pairs: Counter = Counter()
    for t in analysis_report.get("tradeoffs") or []:
        pair = t.get("pair")
        cnt = int(t.get("count") or 0)
        if pair:
            tradeoff_pairs[pair] = cnt

    return ProductReportData(
        product_id=product.get("slug") or "unknown",
        product_name=product.get("name_ko") or "",
        n_reviews=n_reviews,
        n_records=n_records,
        # n_mixed_reviews and n_with_tradeoff are sample-level stats
        # not present in the report. Approximate from tradeoff_pairs
        # length and per-attribute n_mixed totals — enough for layout.
        n_mixed_reviews=sum(s.n_mixed for s in attribute_summaries.values()),
        n_with_tradeoff=sum(tradeoff_pairs.values()),
        attribute_summaries=attribute_summaries,
        tradeoff_pairs=tradeoff_pairs,
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
        # v2.4 — preserve product image fields so re-running republish
        # doesn't drop them from the regenerated analysis_report.
        product_image_url=product.get("image_url"),
        product_image_local_path=product.get("image_local_path"),
        product_image_source=product.get("image_source"),
    )


def _re_emit_analysis_report(
    run_dir: Path,
    analysis_report: dict,
    collection_summary: dict,
) -> tuple[Path, dict]:
    """Recompute analysis_report.json with the latest adapter code.

    Preserves the legacy `text` field on every quote (raw audit
    invariant) and lets the new adapter regenerate `display_text` via
    `synthesize_phrase_display` + adds `corpus.confidence_axes`.

    Pass-19G: re-resolves `selected_profile_id` from category +
    name_ko on every republish, so a run captured before a routing
    fix doesn't carry its stale profile forever. See
    `_resolve_republish_profile` for the rule.
    """
    data = _reconstruct_product_report_data(analysis_report)
    product = analysis_report.get("product") or {}
    corpus = analysis_report.get("corpus") or {}

    saved_profile = (product.get("selected_profile_id") or "").strip() or None
    resolved_profile, resolved_suppress = _resolve_republish_profile(product)
    if saved_profile != resolved_profile:
        print(
            f"  profile re-resolved: {saved_profile!r} → {resolved_profile!r} "
            f"(category={product.get('category')!r}, "
            f"name={product.get('name_ko')!r})"
        )

    rebuilt = productreportdata_to_analysis_report(
        data,
        source_url=product.get("source_url"),
        primary_sort=corpus.get("primary_sort") or "DATETIME_DESC",
        sampling_strategy=(
            corpus.get("sampling_strategy") or "observable_multi_sort_corpus"
        ),
        corpus_type=corpus.get("corpus_type") or "observed_scrape",
        product_slug=product.get("slug"),
        product_category=product.get("category"),
        # Pass-19G: prefer the freshly-resolved suppression set over
        # the saved one so a default→lip_makeup transition flips
        # multi_use_lip_cheek_compatibility suppression correctly.
        suppress_attributes=sorted(resolved_suppress) if resolved_suppress
        else product.get("suppressed_attributes"),
        selected_profile_id=resolved_profile,
        sorts_attempted=collection_summary.get("sorts_attempted"),
        sorts_succeeded=collection_summary.get("sorts_succeeded"),
        sorts_failed=collection_summary.get("sorts_failed"),
        partial_success=collection_summary.get("partial_success"),
    )

    # Rebuilt n_reviews_total / n_reviews_analyzed comes from
    # `data.n_reviews`. Keep the original analyzed count when it
    # matched (defensive).
    if "n_reviews_total" in corpus:
        rebuilt["corpus"]["n_reviews_total"] = corpus["n_reviews_total"]
    if "n_reviews_analyzed" in corpus:
        rebuilt["corpus"]["n_reviews_analyzed"] = corpus["n_reviews_analyzed"]

    out_path = run_dir / "shared" / "analysis_report.json"
    out_path.write_text(
        json.dumps(rebuilt, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return out_path, rebuilt


def _re_render_pdf(
    run_dir: Path,
    rebuilt_report: dict,
    collection_summary: dict,
) -> Path:
    """Re-render the seller PDF using the v3 business-report layout.

    Imported lazily because the PDF module pulls reportlab + matplotlib
    which we don't need for the analysis_report-only path. V3 reads
    straight from analysis_report + collection_summary — no
    ProductReportData reconstruction.
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "_pdf_v2_for_republish",
        REPO_ROOT / "scripts" / "generate_phase2e_pdf_v2.py",
    )
    pdf_mod = importlib.util.module_from_spec(spec)
    sys.modules["_pdf_v2_for_republish"] = pdf_mod
    spec.loader.exec_module(pdf_mod)

    out_path = run_dir / "seller_report" / "seller_report_ko.pdf"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    return pdf_mod.render_seller_business_report_v3(
        analysis_report=rebuilt_report,
        collection_summary=collection_summary,
        out_path=out_path,
        run_id=run_dir.name,
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _re_emit_buyer_journey(
    run_dir: Path,
    rebuilt_report: dict,
    collection_summary: dict,
) -> Path:
    cardnews = build_buyer_journey_cardnews(
        rebuilt_report,
        sorts_attempted=collection_summary.get("sorts_attempted"),
        sorts_succeeded=collection_summary.get("sorts_succeeded"),
        sorts_failed=collection_summary.get("sorts_failed"),
        partial_success=collection_summary.get("partial_success"),
    )
    out_path = run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(cardnews, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return out_path


_COLLECTION_SUMMARY_KEYS_TO_MIRROR: tuple[str, ...] = (
    # Pass-13: every manifest.collection field that must reflect the
    # current collection_summary.json. After a successful retry the
    # summary is updated in place but the manifest's `collection`
    # block stays frozen at run-allocation time — that's what produced
    # the run-003 inconsistency (manifest showed partial_success=True
    # while the summary already showed 5/5 success).
    "corpus_mode",
    "primary_sort",
    "review_count_analyzed",
    "sorts_attempted",
    "sorts_succeeded",
    "sorts_failed",
    "sorts_blocked_or_anti_bot",
    "partial_success",
)


def _sync_manifest_collection_block(
    manifest: dict, collection_summary: dict,
) -> dict:
    """Overwrite manifest.collection fields with the corresponding
    values from collection_summary.json. Keys not in the summary fall
    through (so manually-added fields like `goodsNo` / `product_url`
    survive). Returns the manifest dict for chaining.
    """
    block = manifest.setdefault("collection", {})
    for key in _COLLECTION_SUMMARY_KEYS_TO_MIRROR:
        if key in collection_summary:
            block[key] = collection_summary[key]
    return manifest


# Pass-19: keys the inspector consumes from `manifest.product`.
# When the manifest's product block is missing or empty, we hydrate
# these fields from `analysis_report.product` so the inspector's
# Product / PDF / cardnews-presentation sections all resolve.
_PRODUCT_BLOCK_KEYS_TO_HYDRATE: tuple[str, ...] = (
    "slug",
    "name_ko",
    "name_en",
    "category",
    "source_url",
    "image_url",
    "image_local_path",
    "image_source",
    "raw_product_name",
    "display_product_name",
    "offer_context",
    "promo_context",
    "report_title",
    "selected_profile_id",
    "suppressed_attributes",
)


# Pass-19H: keys whose values are AUTHORITATIVELY owned by the
# resolver (analysis_report.product), not by operator pinning. The
# republish path overwrites these on every run so a stale manifest
# value can't shadow the freshly-resolved profile.
#
# Why this set is special: profile + suppressed_attributes are
# computed deterministically from category + name_ko via
# `select_profile_id`. Preserving an old `default` value when the
# resolver now returns `lip_makeup` is silently wrong — the
# inspector's Product section read the manifest and reported the
# stale profile while the adapter / quote-summary path had already
# moved on. Operators saw `profile=default` next to lip-makeup-
# anchored summary text and lost trust.
_AUTHORITATIVE_PRODUCT_KEYS: tuple[str, ...] = (
    "selected_profile_id",
    "suppressed_attributes",
)


def _hydrate_manifest_product_block(
    manifest: dict, analysis_report: dict | None,
) -> None:
    """Populate `manifest.product` from `analysis_report.product`.

    Two-tier rule:
      * AUTHORITATIVE keys (profile + suppressed_attributes) are
        always overwritten with the analysis_report's current value.
        These are deterministic outputs of the resolver; preserving
        a stale operator-pinned value is silently wrong.
      * All other keys are filled only when the manifest's slot is
        empty / missing — manifest is the operator's edited record,
        analysis_report is the fallback. (Operator-pinned name_ko or
        slug survives unchanged.)
    """
    if not analysis_report:
        return
    ar_product = analysis_report.get("product") or {}
    if not isinstance(ar_product, dict):
        return
    block = manifest.setdefault("product", {})
    for key in _PRODUCT_BLOCK_KEYS_TO_HYDRATE:
        if key not in ar_product:
            continue
        if key in _AUTHORITATIVE_PRODUCT_KEYS:
            # Always overwrite — resolver wins.
            block[key] = ar_product[key]
        elif not block.get(key):
            # Operator-pinning preserved.
            block[key] = ar_product[key]


def _build_minimal_manifest(
    run_dir: Path,
    analysis_report: dict | None,
    collection_summary: dict | None,
) -> dict:
    """Construct a fresh manifest dict for a run-dir whose manifest is
    missing. Built from analysis_report (product + analysis paths) and
    collection_summary (scrape provenance) so the inspector's Product
    / Sorts / Manifest-collection sections resolve cleanly.

    Schema mirrors what `build_phase_a_manifest` writes for a normal
    run, scoped down to fields the inspector actually consumes.
    Pass-19 fix for the silent-bail bug: pre-pass-19, `_patch_manifest`
    returned without writing when the manifest didn't exist, but the
    main loop logged success — operators got "patch manifest → <path>"
    while no file landed.
    """
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest: dict = {
        "schema_version": "1.3",
        "run_dir": run_dir.name,
        "run_started_at": now,
        "run_completed_at": now,
        "product": {},
        "artifacts": {
            "seller_report_ko_pdf": {"status": "skipped"},
            "buyer_content": {"ko": {}},
        },
        "safety": {
            "requires_human_review": True,
            "blocking_flags": [],
            "advisory_flags": [],
            "editorial_polish_used": False,
            "fallback_to_skeleton": False,
        },
    }
    # Sync the collection block from collection_summary so the
    # inspector's "Manifest collection block" section resolves.
    if collection_summary:
        _sync_manifest_collection_block(manifest, collection_summary)
    # Hydrate product fields from the analysis_report.
    _hydrate_manifest_product_block(manifest, analysis_report)
    return manifest


def _patch_manifest(
    run_dir: Path,
    cardnews_path: Path,
    pdf_path: Path,
    analysis_report_path: Path,
    collection_summary: dict | None = None,
    analysis_report: dict | None = None,
) -> tuple[Path, str]:
    """Add/refresh the buyer_journey_cardnews_json slot in the manifest
    and update sha256 + bytes for any artifact we re-emitted.

    Pass-13: also re-syncs `manifest.collection` from the current
    `collection_summary.json` so a successful retry's partial_success
    state doesn't stay frozen in the manifest.

    Pass-19: when the manifest is missing entirely, builds a new one
    from `analysis_report` + `collection_summary` rather than silently
    bailing. Returns (path, action) where `action` is one of
    "patched" / "created" / "skipped" — the caller logs accordingly
    so "patch manifest →" no longer claims success on a no-op.
    """
    manifest_path = run_dir / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        action = "patched"
    else:
        if analysis_report is None and collection_summary is None:
            # Nothing to bootstrap from.
            return manifest_path, "skipped"
        manifest = _build_minimal_manifest(
            run_dir, analysis_report, collection_summary,
        )
        action = "created"

    if collection_summary is not None:
        _sync_manifest_collection_block(manifest, collection_summary)

    # Pass-19 backfill: hydrate any missing product fields from the
    # analysis_report. The helper fills only empty/missing keys, so
    # operator-pinned values (e.g. `name_ko` set by hand) survive.
    # Calling it unconditionally lets a partially-populated block
    # (e.g. `{name_ko}` only) get the rest of its fields filled.
    _hydrate_manifest_product_block(manifest, analysis_report)

    # Update PDF artifact record
    pdf_record = manifest.setdefault("artifacts", {}).setdefault(
        "seller_report_ko_pdf", {},
    )
    if pdf_path.is_file():
        pdf_record["status"] = "ok"
        pdf_record["path"] = "seller_report/seller_report_ko.pdf"
        pdf_record["sha256"] = compute_sha256(pdf_path)
        pdf_record["bytes"] = pdf_path.stat().st_size

    # Add the new buyer_journey slot
    bc = manifest["artifacts"].setdefault("buyer_content", {}).setdefault(
        "ko", {},
    )
    bj_path_rel = "buyer_content/ko/buyer_journey_cardnews.json"
    if cardnews_path.is_file():
        bc["buyer_journey_cardnews_json"] = {
            "status": "ok",
            "path": bj_path_rel,
            "sha256": compute_sha256(cardnews_path),
            "bytes": cardnews_path.stat().st_size,
        }

    # Stamp the republish event so an operator can spot it later.
    manifest["republished_at"] = datetime.now(timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ",
    )

    # Cardnews presentation summary — Run-003 QA pass-5 operator
    # surface so downstream consumers (cardnews → design skill) know
    # which JSON is primary and which are legacy fallbacks.
    try:
        from src.voc.content.manifest import cardnews_presentation_summary
        manifest["presentation"] = {
            "ko": cardnews_presentation_summary(manifest, lang="ko"),
        }
    except Exception:
        pass

    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest_path, action


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="republish_run", description=__doc__)
    p.add_argument(
        "--run-dir", type=Path, required=True,
        help="Path to a run directory (e.g. outputs/2026-05-02_...)",
    )
    p.add_argument(
        "--skip-pdf", action="store_true",
        help=(
            "Skip the PDF re-render — useful when the host is missing "
            "reportlab/matplotlib. analysis_report and cardnews still "
            "regenerate."
        ),
    )
    p.add_argument(
        "--collect-product-image", action="store_true",
        help=(
            "Try to collect a product image when image_url is set on the "
            "report but image_local_path is missing. For OliveYoung runs "
            "with no image_url at all, also try fetching the detail "
            "page's og:image / JSON-LD using the report's source_url. "
            "All failures are warnings — never abort the run."
        ),
    )
    return p.parse_args(argv)


def _collect_product_image_if_missing(
    *,
    run_dir: Path,
    analysis_report: dict,
) -> dict:
    """Best-effort: populate `analysis_report.product.image_local_path`
    when only `image_url` is set, and try the OY detail-page extractor
    when neither is set but the source_url is an OY product URL.

    Mutates `analysis_report` in place AND returns it. Failures emit
    warnings and leave the report unchanged.
    """
    from src.voc.connectors.product_image_extractor import (
        extract_oy_product_image_url,
    )
    from src.voc.content.product_image_fetcher import (
        fetch_and_cache_product_image,
    )

    product = analysis_report.setdefault("product", {})
    image_url = product.get("image_url")
    image_local_path = product.get("image_local_path")
    image_source = product.get("image_source")
    slug = product.get("slug") or product.get("name_ko") or run_dir.name
    source_url = product.get("source_url") or ""

    # Try OY detail-page extraction when no image_url is recorded.
    if not image_url and "oliveyoung.co.kr" in source_url:
        m = re.search(r"[?&]goodsNo=([A-Z0-9]+)", source_url)
        if m:
            goods_no = m.group(1)
            print(
                f"[republish] image: trying OY detail page for {goods_no}",
                flush=True,
            )
            extracted = extract_oy_product_image_url(goods_no)
            if extracted:
                image_url = extracted
                image_source = "oliveyoung"
                product["image_url"] = image_url
                product["image_source"] = image_source
                print(f"  → og:image / JSON-LD found: {image_url[:80]}…", flush=True)
            else:
                print("  ⚠ no image found via OY detail-page extractor", flush=True)

    # Cache the image to <run>/assets/ if we have a URL but no local path.
    if image_url and not image_local_path:
        meta = fetch_and_cache_product_image(
            url=image_url,
            run_dir=run_dir,
            slug=slug,
            source=image_source,
        )
        if meta is not None:
            product["image_local_path"] = meta["local_path"]
            if not product.get("image_source"):
                product["image_source"] = meta.get("source")
            print(
                f"  → cached image to {meta['local_path']} "
                f"({meta['byte_size']} bytes)",
                flush=True,
            )
        else:
            print(
                f"  ⚠ image cache failed for {image_url} — "
                "report stays without image_local_path",
                flush=True,
            )
    return analysis_report


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    run_dir: Path = args.run_dir.resolve()
    if not run_dir.is_dir():
        print(f"✗ run-dir does not exist: {run_dir}", file=sys.stderr)
        return 2

    ar_path = run_dir / "shared" / "analysis_report.json"
    cs_path = run_dir / "shared" / "collection_summary.json"
    if not ar_path.is_file():
        print(f"✗ missing {ar_path}", file=sys.stderr)
        return 2
    if not cs_path.is_file():
        print(f"✗ missing {cs_path}", file=sys.stderr)
        return 2

    analysis_report = json.loads(ar_path.read_text(encoding="utf-8"))
    collection_summary = json.loads(cs_path.read_text(encoding="utf-8"))

    print(f"[republish] run_dir = {run_dir}")

    if args.collect_product_image:
        print("[republish] step 0/4: try to collect product image (best-effort)")
        try:
            analysis_report = _collect_product_image_if_missing(
                run_dir=run_dir,
                analysis_report=analysis_report,
            )
        except Exception as e:  # noqa: BLE001 — never block republish
            print(
                f"  ⚠ product image collection raised: {e!r} — continuing",
                file=sys.stderr,
            )
        # Persist the image fields back so the next step picks them up.
        ar_path.write_text(
            json.dumps(analysis_report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    print("[republish] step 1/4: re-emit analysis_report.json")
    new_ar_path, rebuilt_report = _re_emit_analysis_report(
        run_dir, analysis_report, collection_summary,
    )
    print(f"  → {new_ar_path}")
    axes = (rebuilt_report.get("corpus") or {}).get("confidence_axes") or {}
    if axes:
        for k in (
            "sample_size_confidence", "collection_completeness",
            "negative_signal_coverage", "evidence_reliability",
        ):
            level = (axes.get(k) or {}).get("level")
            label = (axes.get(k) or {}).get("label_ko")
            print(f"    {k:<28} = {level:<10} | {label}")
        if axes.get("headline_caution"):
            print(f"    headline_caution: {axes['headline_caution']}")

    print("[republish] step 2/4: re-emit buyer_journey_cardnews.json")
    bj_path = _re_emit_buyer_journey(
        run_dir, rebuilt_report, collection_summary,
    )
    print(f"  → {bj_path}")

    if args.skip_pdf:
        print("[republish] step 3/4: PDF re-render SKIPPED (--skip-pdf)")
        pdf_path = run_dir / "seller_report" / "seller_report_ko.pdf"
    else:
        print("[republish] step 3/4: re-render seller PDF")
        try:
            pdf_path = _re_render_pdf(
                run_dir, rebuilt_report, collection_summary,
            )
            print(f"  → {pdf_path}")
        except ImportError as e:
            print(f"  ⚠ PDF render skipped (missing dep): {e}", file=sys.stderr)
            pdf_path = run_dir / "seller_report" / "seller_report_ko.pdf"

    print("[republish] step 4/4: patch manifest")
    manifest_path, manifest_action = _patch_manifest(
        run_dir, bj_path, pdf_path, new_ar_path,
        collection_summary=collection_summary,
        analysis_report=rebuilt_report,
    )
    if manifest_action == "patched":
        print(f"  → patched {manifest_path}")
    elif manifest_action == "created":
        print(
            f"  → created {manifest_path} (was missing; built from "
            f"analysis_report + collection_summary)"
        )
    else:
        print(
            f"  ⚠ manifest write skipped — neither analysis_report nor "
            f"collection_summary was available to bootstrap one "
            f"({manifest_path} still missing)",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
