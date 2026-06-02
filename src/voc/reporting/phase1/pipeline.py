"""Phase 1 report pipeline orchestrator.

Chains the report layers into a single pure-function entry point:

    rows, query → compute_metrics → detect_signals → render_template → Phase1Report

The pipeline does NOT hit the database. The CLI (``scripts/generate_phase1_report.py``)
owns the DB read + filter; ``build_report`` takes an already-filtered row list
so it can be tested from a fixture without any DB at all.

Scope resolution: ``build_report`` treats the row list as authoritative. It
resolves ``scope.products`` from the rows themselves (product_ids that
actually appear) and echoes the caller's ``query`` on the report as-is for
provenance, even if the query was unfiltered. This matches the design
principle that the narrative is a rendering of data, not a query log.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from src.voc.reporting.phase1.derived import compute_derived_findings
from src.voc.reporting.phase1.metrics import compute_metrics
from src.voc.reporting.phase1.narrative import render_template
from src.voc.reporting.phase1.schema import (
    Phase1Report,
    ProductInScope,
    ReportProvenance,
    ReportQuery,
    ReportScope,
    SignalCoverage,
    SignalsBundle,
)
from src.voc.reporting.phase1.signals import (
    Lexicons,
    detect_signals_with_membership,
    load_lexicons,
)


def build_report(
    rows: Iterable[dict],
    query: ReportQuery,
    *,
    lexicons: Lexicons | None = None,
    product_labels: dict[str, str] | None = None,
    product_categories: dict[str, str] | None = None,
    generated_at: datetime | None = None,
    report_id: str | None = None,
) -> Phase1Report:
    """Build a fully rendered ``Phase1Report`` from a row list + query.

    ``lexicons=None`` triggers ``load_lexicons()`` with bundled defaults.
    Pass an explicit ``Lexicons`` instance in tests to avoid file I/O.

    ``product_labels`` is an optional ``{product_external_id: display_label}``
    map. When provided, the scope's ``display_label`` field is populated for
    matching product ids; missing ids fall back to rendering the id itself.

    ``product_categories`` is an optional ``{product_external_id: category}``
    map used by the base+extensions lexicon scoping. See
    ``detect_signals`` for the exact semantics. Omitting this parameter
    disables category scoping — every lexicon entry matches every row
    regardless of its ``categories`` field, preserving pre-base+extensions
    behavior for callers that don't know about categories.
    """
    rows = list(rows)
    if lexicons is None:
        lexicons = load_lexicons()
    if product_labels is None:
        product_labels = {}
    if generated_at is None:
        generated_at = datetime.now(timezone.utc)
    if report_id is None:
        report_id = _new_report_id(generated_at)

    scope = _resolve_scope(rows, product_labels)
    metrics = compute_metrics(rows)
    signals, membership = detect_signals_with_membership(
        rows, lexicons, product_categories=product_categories,
    )
    dominant_product_id = (
        metrics.dominant_product.product_id if metrics.dominant_product else None
    )
    derived = compute_derived_findings(
        rows, signals, membership,
        dominant_product_id=dominant_product_id,
    )
    coverage = compute_signal_coverage(rows, signals, membership)
    provenance = _resolve_provenance(rows, lexicons)

    report = Phase1Report(
        report_id=report_id,
        generated_at=generated_at,
        query=query,
        scope=scope,
        deterministic_metrics=metrics,
        signals=signals,
        narrative=None,
        derived=derived,
        coverage=coverage,
        provenance=provenance,
    )
    # Build review_id → text lookup so the template renderer can inject
    # quoted excerpts under each signal bullet. Empty/None text rows are
    # skipped. Renderer falls back to counts-only when this dict is empty.
    review_text_by_id: dict[str, str] = {}
    for r in rows:
        rid = r.get("review_id")
        text = r.get("text")
        if rid and text:
            review_text_by_id[str(rid)] = text
    report.narrative = render_template(
        report, review_text_by_id=review_text_by_id,
    )
    return report


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _new_report_id(now: datetime) -> str:
    return f"phase1_report_{now.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"


def _resolve_scope(
    rows: list[dict],
    product_labels: dict[str, str],
) -> ReportScope:
    channels: set[str] = set()
    product_counts: dict[tuple[str, str], int] = {}
    for r in rows:
        ch = r.get("source_channel")
        if ch:
            channels.add(str(ch))
        pid = r.get("product_external_id")
        if pid:
            key = (str(pid), str(ch or ""))
            product_counts[key] = product_counts.get(key, 0) + 1

    products = [
        ProductInScope(
            product_id=pid,
            channel=ch,
            display_label=product_labels.get(pid),
            n_reviews=n,
        )
        for (pid, ch), n in sorted(
            product_counts.items(), key=lambda kv: (-kv[1], kv[0])
        )
    ]
    return ReportScope(
        channels=sorted(channels),
        products=products,
        total_reviews=len(rows),
    )


# ---------------------------------------------------------------------------
# Product-label map loading
# ---------------------------------------------------------------------------


def compute_signal_coverage(
    rows: list[dict],
    signals: SignalsBundle,
    membership: dict[str, set[str]],
) -> SignalCoverage:
    """Partition rows into five mutually-exclusive coverage buckets and
    count silent rows by rating. Purely descriptive — no new detection
    logic, just aggregation over membership + row metadata.

    The buckets reflect which SIGNAL CATEGORIES (positive / cautionary /
    gap) fired on a given row, not which individual signal. This gives
    readers a single honest view of ``how much of this corpus did the
    rule-based layer engage with at all?''
    """
    pos_ids: set[str] = set()
    for s in signals.positive:
        pos_ids.update(membership.get(s.name, set()))
    caut_ids: set[str] = set()
    for s in signals.cautionary:
        caut_ids.update(membership.get(s.name, set()))
    gap_ids: set[str] = set()
    for s in signals.gaps:
        gap_ids.update(membership.get(s.name, set()))

    all_rids: set[str] = {
        str(r["review_id"]) for r in rows if r.get("review_id")
    }
    any_signal = pos_ids | caut_ids | gap_ids
    no_signal = all_rids - any_signal

    pos_only = pos_ids - caut_ids - gap_ids
    caut_only = caut_ids - pos_ids - gap_ids
    gap_only = gap_ids - pos_ids - caut_ids
    mixed = any_signal - pos_only - caut_only - gap_only

    # No-signal rows broken down by integer rating bucket.
    row_by_rid: dict[str, dict] = {
        str(r["review_id"]): r for r in rows if r.get("review_id")
    }
    no_signal_by_rating: dict[int, int] = {}
    for rid in no_signal:
        rating = row_by_rid.get(rid, {}).get("rating_raw")
        try:
            b = int(rating) if rating is not None else None
        except (TypeError, ValueError):
            b = None
        if b is not None:
            no_signal_by_rating[b] = no_signal_by_rating.get(b, 0) + 1

    return SignalCoverage(
        total_reviews=len(rows),
        rows_with_any_signal=len(any_signal),
        rows_with_no_signal=len(no_signal),
        positive_only=len(pos_only),
        cautionary_only=len(caut_only),
        gap_only=len(gap_only),
        mixed=len(mixed),
        no_signal_by_rating=no_signal_by_rating,
    )


def load_product_labels(path: Path | str | None) -> dict[str, str]:
    """Load the ``{product_external_id: display_label}`` mapping.

    File shape (see ``data/phase1_product_labels.json``):

        {
          "version": "1.1",
          "labels": {
            "A000000238828": "페탈 드롭 리퀴드 블러쉬",
            ...
          },
          "categories": {
            "A000000238828": "blush",
            ...
          }
        }

    ``path=None`` or a missing file returns an empty map — the report still
    renders with product-id fallbacks. Malformed JSON raises; corrupt curator
    data should fail loudly rather than silently produce id-only titles.

    The ``categories`` sibling is read by ``load_product_categories``; this
    function ignores it.
    """
    if path is None:
        return {}
    p = Path(path)
    if not p.is_file():
        return {}
    payload = json.loads(p.read_text(encoding="utf-8"))
    labels = payload.get("labels") or {}
    return {str(k): str(v) for k, v in labels.items() if v}


def load_product_categories(path: Path | str | None) -> dict[str, str]:
    """Load the ``{product_external_id: category}`` mapping.

    File shape: same file as ``load_product_labels``, sibling ``categories``
    field. See docstring on ``load_product_labels`` for the full shape.

    ``path=None`` or a missing file returns an empty map. Callers treat an
    empty map the same as no scoping — lexicon entries fall back to
    universal matching per ``detect_signals`` semantics.
    """
    if path is None:
        return {}
    p = Path(path)
    if not p.is_file():
        return {}
    payload = json.loads(p.read_text(encoding="utf-8"))
    categories = payload.get("categories") or {}
    return {str(k): str(v) for k, v in categories.items() if v}


def _resolve_provenance(rows: list[dict], lexicons: Lexicons) -> ReportProvenance:
    run_ids = sorted({str(r["run_id"]) for r in rows if r.get("run_id")})
    review_ids = sorted({str(r["review_id"]) for r in rows if r.get("review_id")})
    return ReportProvenance(
        phase1_run_ids=run_ids,
        sample_review_ids=review_ids,
        lexicon_version=lexicons.version,
        llm_model=None,
        llm_prompt_hash=None,
    )
