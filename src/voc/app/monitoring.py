"""Monitoring service — operator-facing view layer over the existing query engine.

Reshapes VOCInsight output into seller/store-owner-oriented DTOs.
Does NOT modify the core generation pipeline.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from src.voc.persistence.repository import EntityRepository
from src.voc.api.schemas import (
    ActionItem,
    FlaggedReview,
    MonitoringDashboard,
    MonitoringIssues,
    MonitoringSummary,
    RecurringIssue,
    ReviewStats,
    generate_run_id,
)
from src.voc.app.orchestrator import VOCPipeline
from src.voc.generation.prompts import (
    MONITORING_DASHBOARD_PROMPT,
    MONITORING_ISSUES_PROMPT,
    MONITORING_SUMMARY_PROMPT,
)
from src.voc.processing.indexer import ChunkIndexer

logger = logging.getLogger(__name__)

# Rating threshold: ratings below this (on 0.0–1.0 scale) count as negative.
_NEGATIVE_RATING_THRESHOLD = 0.4

# Sentinel value used in ChromaDB metadata for missing ratings.
_RATING_SENTINEL = -1.0


class MonitoringService:
    """Entity-scoped monitoring operations built on the existing query engine."""

    def __init__(
        self,
        pipeline: VOCPipeline,
        entity_store: EntityRepository,
        indexer: ChunkIndexer,
    ):
        self._pipeline = pipeline
        self._entity_store = entity_store
        self._indexer = indexer

    # ------------------------------------------------------------------
    # Public methods (one per monitoring endpoint)
    # ------------------------------------------------------------------

    async def get_dashboard(self, entity_id: str) -> MonitoringDashboard:
        entity = self._require_entity(entity_id)
        stats = self._compute_stats(entity)
        entity_filter = self._entity_filter(entity)

        query_result = await self._pipeline.query(
            question=MONITORING_DASHBOARD_PROMPT,
            run_id=generate_run_id("mon"),
            top_k=20,
            filters=entity_filter,
        )

        insight = _normalize_insight(query_result.insight)
        evidence = _normalize_evidence(query_result.retrieved_evidence)

        return MonitoringDashboard(
            entity_id=entity_id,
            display_name=entity["display_name"],
            entity_type=entity["entity_type"],
            last_refreshed_at=entity.get("last_refreshed_at"),
            refresh_count=entity.get("refresh_count", 0),
            review_stats=stats,
            monitoring_summary=_extract_summary(insight),
            what_to_fix_first=_extract_action_items(insight),
            recurring_issues=_extract_recurring_issues(insight),
            reviews_needing_attention=_extract_flagged_reviews(insight, evidence),
            generated_at=datetime.now(timezone.utc),
        )

    async def get_issues(self, entity_id: str) -> MonitoringIssues:
        entity = self._require_entity(entity_id)
        entity_filter = self._entity_filter(entity)

        query_result = await self._pipeline.query(
            question=MONITORING_ISSUES_PROMPT,
            run_id=generate_run_id("mon"),
            top_k=20,
            filters=entity_filter,
        )

        insight = _normalize_insight(query_result.insight)

        return MonitoringIssues(
            entity_id=entity_id,
            what_to_fix_first=_extract_action_items(insight),
            recurring_issues=_extract_recurring_issues(insight),
            generated_at=datetime.now(timezone.utc),
        )

    async def get_summary(self, entity_id: str) -> MonitoringSummary:
        entity = self._require_entity(entity_id)
        stats = self._compute_stats(entity)
        entity_filter = self._entity_filter(entity)

        query_result = await self._pipeline.query(
            question=MONITORING_SUMMARY_PROMPT,
            run_id=generate_run_id("mon"),
            top_k=10,
            filters=entity_filter,
        )

        insight = _normalize_insight(query_result.insight)

        return MonitoringSummary(
            entity_id=entity_id,
            monitoring_summary=_extract_summary(insight),
            review_stats=stats,
            generated_at=datetime.now(timezone.utc),
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _require_entity(self, entity_id: str) -> dict:
        entity = self._entity_store.get(entity_id)
        if entity is None:
            raise EntityNotFoundError(entity_id)
        return entity

    def _entity_filter(self, entity: dict) -> dict:
        """Build a ChromaDB where-filter from the entity's product_keywords."""
        keywords = entity["product_keywords"]
        if len(keywords) == 1:
            return {"product_keyword": keywords[0]}
        return {"product_keyword": {"$in": keywords}}

    def _compute_stats(self, entity: dict) -> ReviewStats:
        """Aggregate review statistics from ChromaDB metadata.

        total_reviews: number of unique reviews (distinct non-empty review_id).
        total_chunks: number of index records (chunks) for this entity.
        """
        entity_filter = self._entity_filter(entity)
        result = self._indexer.collection.get(
            where=entity_filter,
            include=["metadatas"],
        )

        metadatas = result.get("metadatas", [])
        total_chunks = len(metadatas)

        if total_chunks == 0:
            return ReviewStats(
                total_reviews=0,
                total_chunks=0,
                avg_rating=None,
                negative_count=0,
                low_rating_ratio=0.0,
                channels=[],
            )

        review_ids: set[str] = set()
        ratings: list[float] = []
        negative_count = 0
        channels: set[str] = set()

        for meta in metadatas:
            rid = meta.get("review_id", "")
            if rid:
                review_ids.add(rid)

            ch = meta.get("source_channel", "")
            if ch:
                channels.add(ch)

            rating = meta.get("rating_normalized", _RATING_SENTINEL)
            if rating != _RATING_SENTINEL:
                ratings.append(rating)
                if rating < _NEGATIVE_RATING_THRESHOLD:
                    negative_count += 1

        total_reviews = len(review_ids)
        avg_rating = round(sum(ratings) / len(ratings), 2) if ratings else None
        low_rating_ratio = round(negative_count / len(ratings), 2) if ratings else 0.0

        return ReviewStats(
            total_reviews=total_reviews,
            total_chunks=total_chunks,
            avg_rating=avg_rating,
            negative_count=negative_count,
            low_rating_ratio=low_rating_ratio,
            channels=sorted(channels),
        )


class EntityNotFoundError(Exception):
    """Raised when an entity_id is not found in the store."""

    def __init__(self, entity_id: str):
        self.entity_id = entity_id
        super().__init__(f"Entity '{entity_id}' not found")


# ----------------------------------------------------------------------
# Normalization helpers
# ----------------------------------------------------------------------


def _normalize_insight(insight: object) -> dict | None:
    """Ensure insight is a plain dict or None.

    QueryResult.insight is already a dict (from VOCInsight.model_dump()),
    but we normalize defensively in case the upstream shape changes.
    """
    if insight is None:
        return None
    if isinstance(insight, dict):
        return insight
    if hasattr(insight, "model_dump"):
        return insight.model_dump()
    return dict(insight)


def _normalize_evidence(evidence: list) -> list[dict]:
    """Ensure retrieved_evidence is a list of plain dicts."""
    result: list[dict] = []
    for item in evidence:
        if isinstance(item, dict):
            result.append(item)
        elif hasattr(item, "model_dump"):
            result.append(item.model_dump())
        else:
            result.append(dict(item))
    return result


# ----------------------------------------------------------------------
# VOCInsight → operator-facing DTO mapping functions
# ----------------------------------------------------------------------
#
# Mapping:
#   insight["summary"]         → monitoring_summary
#   insight["pain_points"]     → what_to_fix_first  (ActionItem list)
#   insight["themes"]          → recurring_issues    (negative/mixed only)
#   insight["recommendations"] → suggested_action in ActionItems
#   retrieved_evidence chunks  → reviews_needing_attention
#                                (chunks tied to critical/major pain points)


_SEVERITY_TO_PRIORITY = {"critical": 1, "major": 2, "minor": 3}


def _extract_summary(insight: dict | None) -> str:
    if insight is None:
        return "리뷰 데이터가 부족하여 요약을 생성할 수 없습니다."
    return insight.get("summary", "")


def _extract_action_items(insight: dict | None) -> list[ActionItem]:
    """Map pain_points + recommendations → prioritized ActionItem list."""
    if insight is None:
        return []

    pain_points = insight.get("pain_points", [])
    recommendations = insight.get("recommendations", [])

    # Build a lookup: evidence_id → suggested action from recommendations.
    # If a recommendation shares evidence with a pain point, pair them.
    rec_by_evidence: dict[str, str] = {}
    for rec in recommendations:
        for eid in rec.get("evidence_ids", []):
            rec_by_evidence[eid] = rec.get("action", "")

    items: list[ActionItem] = []
    for pp in pain_points:
        severity = pp.get("severity", "minor")
        evidence_ids = pp.get("evidence_ids", [])

        # Find a matching recommendation action
        suggested = ""
        for eid in evidence_ids:
            if eid in rec_by_evidence:
                suggested = rec_by_evidence[eid]
                break

        items.append(ActionItem(
            priority=_SEVERITY_TO_PRIORITY.get(severity, 3),
            issue=pp.get("description", ""),
            why_urgent=f"심각도: {severity}",
            suggested_action=suggested or "추가 검토 필요",
            evidence_ids=evidence_ids,
        ))

    items.sort(key=lambda x: x.priority)
    return items


def _extract_recurring_issues(insight: dict | None) -> list[RecurringIssue]:
    """Map themes with negative/mixed sentiment → RecurringIssue list."""
    if insight is None:
        return []

    issues: list[RecurringIssue] = []
    for theme in insight.get("themes", []):
        sentiment = theme.get("sentiment", "mixed")
        if sentiment not in ("negative", "mixed"):
            continue

        evidence_ids = theme.get("evidence_ids", [])
        evidence_count = len(evidence_ids)

        if evidence_count >= 4:
            frequency = "high"
        elif evidence_count >= 2:
            frequency = "medium"
        else:
            frequency = "low"

        issues.append(RecurringIssue(
            issue=f"{theme.get('label', '')}: {theme.get('description', '')}",
            frequency=frequency,
            sentiment=sentiment,
            evidence_ids=evidence_ids,
        ))

    return issues


def _extract_flagged_reviews(
    insight: dict | None,
    retrieved_evidence: list[dict],
) -> list[FlaggedReview]:
    """Flag retrieved chunks whose evidence overlaps with critical/major pain points.

    Rating-based flagging is not implemented because retrieved_evidence
    dicts do not carry rating_normalized (the orchestrator omits it).
    """
    if insight is None:
        return []

    # Collect evidence_ids from critical/major pain points
    critical_evidence: set[str] = set()
    for pp in insight.get("pain_points", []):
        if pp.get("severity") in ("critical", "major"):
            critical_evidence.update(pp.get("evidence_ids", []))

    if not critical_evidence:
        return []

    flagged: list[FlaggedReview] = []
    for chunk in retrieved_evidence:
        evidence_ids = chunk.get("evidence_ids", [])
        overlap = critical_evidence.intersection(evidence_ids)
        if not overlap:
            continue

        text = chunk.get("text", "")
        snippet = text[:100] + ("…" if len(text) > 100 else "")

        flagged.append(FlaggedReview(
            reason="심각한 불만 관련 리뷰 — 확인 필요",
            review_text_snippet=snippet,
            rating=None,
            evidence_ids=evidence_ids,
        ))

    return flagged
