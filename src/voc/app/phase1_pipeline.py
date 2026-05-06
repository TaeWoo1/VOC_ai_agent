"""Phase 1 ingestion pipeline orchestrator (Coupang + OliveYoung bait report).

Stages (PR3 + PR4):
  collect → normalize → strip-and-promote → [optional enrich] → quality gate → persist

The enrich step (PR4) is an optional callable: if `enrich_fn` is provided, it
receives `(channel_meta, product_external_id)` per row and returns a
`DerivedAttributes` instance (or None). For Coupang this is None today; for
OliveYoung the CLI wires it to a `SegmentNormalizer`-backed callable.

Observability (PR4 clarification): connector-level drops and pipeline-level
normalize rejections live in distinct fields on `ConnectorRunSummary`. The
pipeline writes its `pipeline_normalize_rejections` counter back onto the
summary BEFORE persisting it to phase1_runs, so the bait report can disclose
both kinds of data loss without ambiguity.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from pydantic import BaseModel

from src.voc.app.connector_run_summary import (
    ConnectorRunSummary,
    QualityStatus,
    evaluate_quality_gates,
)
from src.voc.connectors.base import ChannelConnector, CollectParams
from src.voc.ingestion.normalizer import normalize
from src.voc.persistence.phase1_review_repository import Phase1ReviewRepository
from src.voc.persistence.phase1_run_repository import Phase1RunRepository
from src.voc.processing.promotion import strip_promoted_keys
from src.voc.schemas.channel_meta import DerivedAttributes
from src.voc.schemas.raw import RawReview

logger = logging.getLogger(__name__)

# Convention: every Phase 1 connector puts a stable per-product external ID under
# this key in raw_metadata. The pipeline copies it onto the phase1_reviews row
# AND strips it from raw_metadata.
PRODUCT_EXTERNAL_ID_KEY: str = "product_external_id"

# Type alias for the optional enrich callable. Receives the typed channel_meta
# and the row's product_external_id (which is needed for per-product option
# dictionary lookups). Returns a DerivedAttributes instance or None.
EnrichFn = Callable[[BaseModel, str | None], "DerivedAttributes | None"]


@dataclass(frozen=True)
class Phase1RunResult:
    run_id: str
    quality_status: QualityStatus
    rows_inserted: int
    rows_skipped: int   # rows that normalize() rejected (pipeline-level)


class Phase1Pipeline:
    """Phase 1 orchestrator. Stateless; repos are injected, per-run config is passed to run()."""

    def __init__(
        self,
        review_repo: Phase1ReviewRepository,
        run_repo: Phase1RunRepository,
    ):
        self._reviews = review_repo
        self._runs = run_repo

    async def run(
        self,
        connector: ChannelConnector,
        target: str,
        channel_meta_class: type[BaseModel],
        promoted_keys: set[str],
        source_method: str = "csv_upload",
        params: CollectParams | None = None,
        enrich_fn: EnrichFn | None = None,
    ) -> Phase1RunResult:
        run_id = _new_run_id()
        started = datetime.now(timezone.utc)

        # ---------- collect ----------
        try:
            raws = await connector.collect(target, params)
        except Exception as e:
            logger.exception("connector.collect failed for run %s", run_id)
            error_summary = _error_summary(
                run_id=run_id,
                channel=connector.channel_name,
                target=target,
                started=started,
                error_msg=str(e),
                # Pull the requested sort off the connector instance via
                # getattr so we don't introduce a hard dependency on
                # OY-specific fields here. None for non-OY connectors.
                requested_sort_type=getattr(connector, "_sort_type", None),
            )
            self._save_run(
                run_id=run_id,
                channel=connector.channel_name,
                target=target,
                started_at=started,
                finished_at=datetime.now(timezone.utc),
                summary=error_summary.model_dump(mode="json"),
                quality_status="invalid",
            )
            return Phase1RunResult(run_id=run_id, quality_status="invalid",
                                   rows_inserted=0, rows_skipped=0)

        # Prefer connector-populated summary; otherwise build a minimal one externally.
        summary: ConnectorRunSummary = (
            getattr(connector, "last_run_summary", None)
            or _minimal_summary(
                run_id=run_id,
                channel=connector.channel_name,
                target=target,
                started=started,
                raws=raws,
            )
        )
        # Override the connector's run_id so persistence linkage uses the pipeline's id.
        summary = summary.model_copy(update={"run_id": run_id})
        quality_status = evaluate_quality_gates(summary)

        # ---------- quality gate ----------
        if quality_status == "invalid":
            finished = datetime.now(timezone.utc)
            self._save_run(
                run_id=run_id,
                channel=connector.channel_name,
                target=target,
                started_at=started,
                finished_at=finished,
                summary=summary.model_dump(mode="json"),
                quality_status=quality_status,
            )
            return Phase1RunResult(run_id=run_id, quality_status=quality_status,
                                   rows_inserted=0, rows_skipped=0)

        # ---------- normalize → strip-and-promote → enrich → row dict ----------
        rows: list[dict] = []
        skipped = 0
        for raw in raws:
            try:
                row = self._build_row(
                    raw=raw,
                    channel_meta_class=channel_meta_class,
                    promoted_keys=promoted_keys,
                    source_method=source_method,
                    run_id=run_id,
                    enrich_fn=enrich_fn,
                )
            except ValueError as e:
                # normalize() rejected the row (e.g., 10-char text floor)
                skipped += 1
                logger.debug("normalize rejected row in run %s: %s", run_id, e)
                continue
            rows.append(row)

        # ---------- persist ----------
        inserted = self._reviews.save_many(rows)
        finished = datetime.now(timezone.utc)

        # PR4 observability: stamp pipeline-level rejection count onto the summary
        # so phase1_runs.summary_json carries the full picture (connector + pipeline).
        summary = summary.model_copy(update={"pipeline_normalize_rejections": skipped})

        self._save_run(
            run_id=run_id,
            channel=connector.channel_name,
            target=target,
            started_at=started,
            finished_at=finished,
            summary=summary.model_dump(mode="json"),
            quality_status=quality_status,
        )
        return Phase1RunResult(
            run_id=run_id,
            quality_status=quality_status,
            rows_inserted=inserted,
            rows_skipped=skipped,
        )

    # -----------------------------------------------------------------

    @staticmethod
    def _build_row(
        *,
        raw: RawReview,
        channel_meta_class: type[BaseModel],
        promoted_keys: set[str],
        source_method: str,
        run_id: str,
        enrich_fn: EnrichFn | None,
    ) -> dict:
        # Capture raw_rating BEFORE normalize (CanonicalReview only stores normalized).
        raw_rating = raw.raw_rating
        raw_metadata: dict[str, Any] = dict(raw.raw_metadata)

        canonical = normalize(raw)  # may raise ValueError → caller counts as skipped

        # Build typed channel_meta from raw_metadata (read promoted slots, default None when absent).
        channel_meta_kwargs = {k: raw_metadata.get(k) for k in promoted_keys}
        channel_meta = channel_meta_class(**channel_meta_kwargs)

        product_external_id = raw_metadata.get(PRODUCT_EXTERNAL_ID_KEY)

        # Optional enrich pass: produce DerivedAttributes from typed channel_meta.
        derived_obj = enrich_fn(channel_meta, product_external_id) if enrich_fn else None
        derived_dict = derived_obj.model_dump(mode="json") if derived_obj is not None else None

        # Strip promoted keys + product_external_id from raw_metadata for persistence.
        stripped_raw = strip_promoted_keys(
            raw_metadata, promoted_keys | {PRODUCT_EXTERNAL_ID_KEY}
        )

        return {
            "review_id": canonical.review_id,
            "source_channel": canonical.source_channel,
            "source_method": source_method,
            "source_id": canonical.source_id,
            "source_url": canonical.source_url,
            "text": canonical.text,
            "rating_normalized": canonical.rating_normalized,
            "rating_raw": float(raw_rating) if raw_rating is not None else None,
            "review_date": canonical.review_date.isoformat() if canonical.review_date else None,
            "language": canonical.language,
            "content_fingerprint": canonical.content_fingerprint,
            "is_duplicate": canonical.is_duplicate,
            "duplicate_of": canonical.duplicate_of,
            "product_keyword": canonical.product_keyword,
            "product_external_id": product_external_id,
            "channel_meta": channel_meta.model_dump(mode="json"),
            "derived": derived_dict,
            "raw_metadata": stripped_raw,
            "run_id": run_id,
            "collected_at": canonical.collected_at.isoformat(),
            "ingested_at": canonical.ingested_at.isoformat(),
        }

    def _save_run(
        self,
        *,
        run_id: str,
        channel: str,
        target: str,
        started_at: datetime,
        finished_at: datetime | None,
        summary: dict,
        quality_status: str,
    ) -> None:
        self._runs.save(
            run_id=run_id,
            channel=channel,
            requested_target=target,
            started_at=started_at.isoformat(),
            finished_at=finished_at.isoformat() if finished_at else None,
            quality_status=quality_status,
            summary=summary,
        )


# ----------------------------------------------------------------------
# Module-level helpers
# ----------------------------------------------------------------------


def _new_run_id() -> str:
    return f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"


def _minimal_summary(
    *, run_id: str, channel: str, target: str,
    started: datetime, raws: list[RawReview],
) -> ConnectorRunSummary:
    return ConnectorRunSummary(
        run_id=run_id,
        channel=channel,
        requested_target=target,
        started_at=started,
        finished_at=datetime.now(timezone.utc),
        raw_records_seen=len(raws),
        records_parsed=len(raws),
    )


# 2026-05-01 — exception-text classifiers. `_error_summary` is on the
# critical path for every connector that raises out of `connector.collect`,
# regardless of which CLI / orchestrator invoked it. Without this, the
# Playwright/Chrome CDP-attach wall surfaces as a generic
# `unknown_failure` because the error text only lands in
# `sample_dropped_reasons`. Hint sets are duplicated here (NOT imported
# from the OY-specific CLI) so the module stays connector-agnostic.
_PIPELINE_CDP_ATTACH_HINTS: tuple[str, ...] = (
    "setDownloadBehavior",
    "Browser context management is not supported",
    "connect_over_cdp",
    "Browser closed",
    "Target closed",
    "ECONNREFUSED 127.0.0.1",
)
_PIPELINE_PAGE_OPEN_HINTS: tuple[str, ...] = (
    "page.goto",
    "ERR_NAME_NOT_RESOLVED",
    "ERR_CONNECTION_REFUSED",
    "Navigation failed",
)


def _error_summary(
    *, run_id: str, channel: str, target: str,
    started: datetime, error_msg: str,
    requested_sort_type: str | None = None,
) -> ConnectorRunSummary:
    """Build the `ConnectorRunSummary` for a `connector.collect` exception.

    2026-05-01 addition: when the error text matches a known CDP-attach
    or page-open marker, the corresponding `cdp_attach_failed` /
    `page_open_failed` flag is set on the summary so downstream
    classifiers (`collection_batch.classify_status`,
    `connector_run_summary.evaluate_quality_gates`) can route to a
    specific status instead of the legacy generic `unknown_failure`.
    The verbatim error text is preserved in both
    `sample_dropped_reasons` (truncated) and the matched
    `*_error` field (not truncated).
    """
    cdp_attach_failed = any(h in error_msg for h in _PIPELINE_CDP_ATTACH_HINTS)
    page_open_failed = (
        not cdp_attach_failed
        and any(h in error_msg for h in _PIPELINE_PAGE_OPEN_HINTS)
    )
    return ConnectorRunSummary(
        run_id=run_id,
        channel=channel,
        requested_target=target,
        started_at=started,
        finished_at=datetime.now(timezone.utc),
        raw_records_seen=0,
        records_parsed=0,
        sample_dropped_reasons=[f"connector.collect raised: {error_msg[:200]}"],
        # Preserve the operator's requested sort even when the connector
        # raised before populating its own run summary. Without this, a
        # CDP-level Playwright failure for `--sort-type DATETIME_DESC`
        # would surface as `requested_sort_type=null` in the run record,
        # making post-mortem investigation harder.
        requested_sort_type=requested_sort_type,
        cdp_attach_failed=cdp_attach_failed,
        cdp_attach_error=error_msg if cdp_attach_failed else None,
        page_open_failed=page_open_failed,
        page_open_error=error_msg if page_open_failed else None,
    )
