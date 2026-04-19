"""Sync service — owns refresh execution, bookkeeping, and snapshot capture.

This service is execution-agnostic: it exposes execute_refresh() as a plain
async method. The route layer dispatches it (via BackgroundTasks today,
via a queue later). SyncService never imports FastAPI.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

from src.voc.api.schemas import generate_run_id
from src.voc.app.monitoring import MonitoringService
from src.voc.app.orchestrator import VOCPipeline
from src.voc.connectors.base import CollectParams
from src.voc.logging import run_id_var
from src.voc.persistence.repository import (
    EntityRepository,
    SnapshotRepository,
    SourceConnectionRepository,
    SyncJobRepository,
)

logger = logging.getLogger(__name__)


class SyncService:
    """Business logic for entity refresh and snapshot capture."""

    def __init__(
        self,
        pipeline: VOCPipeline,
        entity_repo: EntityRepository,
        job_repo: SyncJobRepository,
        snapshot_repo: SnapshotRepository,
        source_repo: SourceConnectionRepository,
        monitoring: MonitoringService,
    ):
        self._pipeline = pipeline
        self._entity_repo = entity_repo
        self._job_repo = job_repo
        self._snapshot_repo = snapshot_repo
        self._source_repo = source_repo
        self._monitoring = monitoring

    async def execute_refresh(
        self,
        entity_id: str,
        job_id: str,
        max_results: int = 100,
    ) -> dict:
        """Run the full refresh cycle for an entity.

        If the entity has active source connections, iterate those.
        Otherwise, fall back to entity.connector (backward compat).
        """
        entity = self._entity_repo.get(entity_id)
        if entity is None:
            self._job_repo.complete(
                job_id, status="failed",
                errors_json=json.dumps([f"Entity '{entity_id}' not found"]),
            )
            return self._job_repo.get(job_id)

        self._job_repo.start(job_id)
        run_id_var.set(job_id)

        # Determine what to ingest: source connections or legacy entity.connector
        all_sources = self._source_repo.list_by_entity(entity_id)
        sources = [s for s in all_sources if s.get("status") == "active"]
        skipped = [s for s in all_sources if s.get("status") != "active"]
        source_summary: list[dict] = []
        skipped_summary: list[dict] = []

        for s in skipped:
            skipped_summary.append({
                "connection_id": s["connection_id"],
                "connector_type": s["connector_type"],
                "display_name": s["display_name"],
                "reason": f"status={s.get('status', 'unknown')}",
            })

        if sources:
            total_collected, total_indexed, succeeded, failed, all_stages, all_errors, source_summary = (
                await self._ingest_from_sources(entity, sources, max_results)
            )
            ingest_mode = "source_connections"
        else:
            # Backward compat: use entity.connector for all keywords
            connector = entity.get("connector", "mock")
            total_collected, total_indexed, succeeded, failed, all_stages, all_errors = (
                await self._ingest_legacy(entity, max_results)
            )
            ingest_mode = "legacy_fallback"
            legacy_status = "completed" if failed == 0 else ("partial" if succeeded > 0 else "failed")
            source_summary = [{
                "connection_id": None,
                "connector_type": connector,
                "display_name": f"레거시 커넥터 ({connector})",
                "collected": total_collected,
                "indexed": total_indexed,
                "status": legacy_status,
                "errors": all_errors[:5],
                "error_summary": self._build_error_summary(
                    legacy_status, total_collected, succeeded, failed, all_errors,
                ),
            }]

        if failed == 0:
            status = "completed"
        elif succeeded == 0:
            status = "failed"
        else:
            status = "partial"

        job_metadata = {
            "ingest_mode": ingest_mode,
            "source_summary": source_summary,
            "skipped_sources": skipped_summary,
        }

        self._job_repo.complete(
            job_id,
            status=status,
            total_collected=total_collected,
            total_indexed=total_indexed,
            stages_json=json.dumps(all_stages),
            errors_json=json.dumps(all_errors),
        )
        # Write metadata separately — complete() doesn't accept it
        self._job_repo._conn.execute(
            "UPDATE sync_jobs SET metadata_json = ? WHERE job_id = ?",
            (json.dumps(job_metadata, ensure_ascii=False), job_id),
        )
        self._job_repo._conn.commit()

        if succeeded > 0:
            self._entity_repo.update(entity_id, {
                "last_refreshed_at": datetime.now(timezone.utc).isoformat(),
                "refresh_count": entity.get("refresh_count", 0) + 1,
            })
            await self._capture_snapshot(entity_id, entity, job_id)

        # Update last_synced_at on source connections that were used
        now_iso = datetime.now(timezone.utc).isoformat()
        for src in sources:
            self._source_repo.update(src["connection_id"], {"last_synced_at": now_iso})

        logger.info(
            "Entity refresh completed",
            extra={
                "entity_id": entity_id,
                "job_id": job_id,
                "status": status,
                "total_collected": total_collected,
                "total_indexed": total_indexed,
                "source_count": len(sources),
            },
        )

        return self._job_repo.get(job_id)

    async def _ingest_from_sources(
        self, entity: dict, sources: list[dict], max_results: int,
    ) -> tuple[int, int, int, int, list[dict], list[str], list[dict]]:
        """Ingest using explicit source connections.

        Returns the standard tallies plus a per-source summary list.
        """
        all_stages: list[dict] = []
        all_errors: list[str] = []
        total_collected = 0
        total_indexed = 0
        succeeded = 0
        failed = 0
        source_summary: list[dict] = []

        for source in sources:
            connector_type = source["connector_type"]
            config = source.get("config", {})

            # Build collect_params from source connection config
            collect_params = self._build_collect_params(connector_type, config, max_results)

            src_collected = 0
            src_indexed = 0
            src_succeeded = 0
            src_failed = 0
            src_errors: list[str] = []

            for kw in entity["product_keywords"]:
                sub_rid = generate_run_id("ingest")
                try:
                    result = await self._pipeline.ingest(
                        keyword=kw,
                        run_id=sub_rid,
                        connector_name=connector_type,
                        max_results=max_results,
                        collect_params=collect_params,
                    )
                except Exception as e:
                    failed += 1
                    src_failed += 1
                    err_msg = f"keyword '{kw}': {e}"
                    all_errors.append(f"source '{source['display_name']}' {err_msg}")
                    src_errors.append(err_msg)
                    logger.error(
                        "Source ingest failed",
                        extra={"connection_id": source["connection_id"], "keyword": kw},
                        exc_info=e,
                    )
                    continue

                c, i, s, f, stages, errors = self._tally_result(result, kw, source["display_name"])
                total_collected += c
                total_indexed += i
                succeeded += s
                failed += f
                src_collected += c
                src_indexed += i
                src_succeeded += s
                src_failed += f
                all_stages.extend(stages)
                all_errors.extend(errors)
                if errors:
                    src_errors.extend(errors)

            if src_failed == 0:
                src_status = "completed"
            elif src_succeeded == 0:
                src_status = "failed"
            else:
                src_status = "partial"

            source_summary.append({
                "connection_id": source["connection_id"],
                "connector_type": connector_type,
                "display_name": source["display_name"],
                "collected": src_collected,
                "indexed": src_indexed,
                "status": src_status,
                "errors": src_errors[:5],
                "error_summary": self._build_error_summary(
                    src_status, src_collected, src_succeeded, src_failed, src_errors,
                ),
            })

        return total_collected, total_indexed, succeeded, failed, all_stages, all_errors, source_summary

    async def _ingest_legacy(
        self, entity: dict, max_results: int,
    ) -> tuple[int, int, int, int, list[dict], list[str]]:
        """Backward-compatible ingest using entity.connector."""
        connector = entity.get("connector", "mock")
        all_stages: list[dict] = []
        all_errors: list[str] = []
        total_collected = 0
        total_indexed = 0
        succeeded = 0
        failed = 0

        for kw in entity["product_keywords"]:
            sub_rid = generate_run_id("ingest")
            try:
                result = await self._pipeline.ingest(
                    keyword=kw,
                    run_id=sub_rid,
                    connector_name=connector,
                    max_results=max_results,
                )
            except Exception as e:
                failed += 1
                all_errors.append(f"keyword '{kw}': {e}")
                logger.error(
                    "Refresh keyword failed",
                    extra={"entity_id": entity.get("entity_id"), "keyword": kw},
                    exc_info=e,
                )
                continue

            c, i, s, f, stages, errors = self._tally_result(result, kw)
            total_collected += c
            total_indexed += i
            succeeded += s
            failed += f
            all_stages.extend(stages)
            all_errors.extend(errors)

        return total_collected, total_indexed, succeeded, failed, all_stages, all_errors

    @staticmethod
    def _build_error_summary(
        status: str,
        collected: int,
        succeeded: int,
        failed: int,
        errors: list[str],
    ) -> str:
        """Build a short human-readable summary for a source's refresh outcome."""
        if status == "completed":
            if collected == 0:
                return "데이터 없음 (빈 소스이거나 파일/설정 확인 필요)"
            return f"{collected}건 수집 완료"
        elif status == "partial":
            return f"{succeeded} keyword 성공, {failed} keyword 실패"
        else:
            # failed
            if errors:
                # Use first error, truncated
                first = errors[0]
                if len(first) > 120:
                    first = first[:117] + "..."
                return first
            if collected == 0:
                return "데이터 없음 (파일 또는 설정 확인 필요)"
            return "실패"

    @staticmethod
    def _build_collect_params(
        connector_type: str, config: dict, max_results: int,
    ) -> CollectParams | None:
        """Build connector-specific CollectParams from source connection config."""
        if connector_type in ("csv", "json_import"):
            file_path = config.get("file_path")
            if file_path:
                return CollectParams(max_results=max_results, language_filter=file_path)
        elif connector_type == "google_business":
            # Pass full config as JSON string — connector parses it
            return CollectParams(max_results=max_results, language_filter=json.dumps(config))
        # For mock and other connectors, use default params
        return None

    @staticmethod
    def _tally_result(
        result, kw: str, source_name: str | None = None,
    ) -> tuple[int, int, int, int, list[dict], list[str]]:
        """Extract counts and stages from an IngestResult."""
        stages = []
        errors = []

        for s in result.stages:
            stages.append({
                "name": s.name,
                "status": s.status,
                "count": s.count,
                "duration_ms": s.duration_ms,
                "errors": s.errors,
            })

        counts = result.counts
        collected = counts.get("collected", 0)
        indexed = counts.get("indexed", 0)

        label = f"source '{source_name}' keyword '{kw}'" if source_name else f"keyword '{kw}'"

        if result.status == "completed":
            return collected, indexed, 1, 0, stages, errors
        else:
            errors.append(f"{label}: {result.status}")
            return collected, indexed, 0, 1, stages, errors

    async def _capture_snapshot(
        self, entity_id: str, entity: dict, job_id: str
    ) -> None:
        """Compute stats and optionally full monitoring output, persist as snapshot."""
        try:
            stats = self._monitoring._compute_stats(entity)
        except Exception as e:
            logger.warning(
                "Snapshot stats computation failed",
                extra={"entity_id": entity_id}, exc_info=e,
            )
            return

        snapshot = {
            "snapshot_id": uuid4().hex[:16],
            "entity_id": entity_id,
            "job_id": job_id,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "total_reviews": stats.total_reviews,
            "avg_rating": stats.avg_rating,
            "negative_count": stats.negative_count,
            "low_rating_ratio": stats.low_rating_ratio,
            "channels": stats.channels,
            "summary_text": None,
            "dashboard": None,
        }

        # Attempt full dashboard capture (LLM call — optional, skip on failure)
        try:
            dashboard = await self._monitoring.get_dashboard(entity_id)
            snapshot["summary_text"] = dashboard.monitoring_summary
            snapshot["dashboard"] = {
                "action_items": [item.model_dump(mode="json") for item in dashboard.what_to_fix_first],
                "recurring_issues": [issue.model_dump(mode="json") for issue in dashboard.recurring_issues],
                "flagged_reviews": [review.model_dump(mode="json") for review in dashboard.reviews_needing_attention],
            }
        except Exception as e:
            logger.warning(
                "Snapshot dashboard capture failed (stats-only snapshot saved)",
                extra={"entity_id": entity_id}, exc_info=e,
            )

        self._snapshot_repo.save(snapshot)
        logger.info(
            "Snapshot captured",
            extra={"entity_id": entity_id, "snapshot_id": snapshot["snapshot_id"]},
        )
