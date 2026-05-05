from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .loaders import load_review_ops_inputs
from .render_html import render_to_file
from .report_model import build, dump_json
from .safety import OperatorReportSafetyError, validate_operator


@dataclass
class ProcessResult:
    run_dir: Path
    status: str  # "success" | "failed" | "skipped"
    reviews_loaded: int = 0
    total_reviews: int = 0
    asset_counts: dict = field(default_factory=dict)
    emergent_cluster_count: int = 0
    html_path: Optional[Path] = None
    json_path: Optional[Path] = None
    error_message: Optional[str] = None
    db_status: Optional[str] = None
    safety_violations: list[str] = field(default_factory=list)


def process_run_dir(
    run_dir: Path,
    *,
    db_path: Optional[Path] = None,
) -> ProcessResult:
    """Run the full review_ops pipeline for one run_dir, never raising.

    Skips when shared/analysis_report.json is missing. Marks "failed" on
    any load/build/safety/write error and returns the recorded reason —
    callers can iterate without try/except.
    """
    run_dir = Path(run_dir)
    if not (run_dir / "shared" / "analysis_report.json").exists():
        return ProcessResult(
            run_dir=run_dir,
            status="skipped",
            error_message="missing shared/analysis_report.json",
        )

    try:
        inputs = load_review_ops_inputs(run_dir, db_path=db_path)
    except Exception as exc:
        return ProcessResult(
            run_dir=run_dir,
            status="failed",
            error_message=f"load failed: {exc}",
        )

    try:
        report = build(inputs)
    except Exception as exc:
        return ProcessResult(
            run_dir=run_dir,
            status="failed",
            reviews_loaded=len(inputs.reviews),
            db_status=inputs.db_status,
            error_message=f"build failed: {exc}",
        )

    try:
        validate_operator(report)
    except OperatorReportSafetyError as exc:
        return ProcessResult(
            run_dir=run_dir,
            status="failed",
            reviews_loaded=len(inputs.reviews),
            db_status=inputs.db_status,
            error_message=f"safety validation failed: {len(exc.violations)} violation(s)",
            safety_violations=list(exc.violations),
        )

    try:
        json_path = dump_json(
            report, run_dir / "shared" / "review_ops_analysis.json"
        )
        html_path = render_to_file(report, run_dir / "review_ops")
    except Exception as exc:
        return ProcessResult(
            run_dir=run_dir,
            status="failed",
            reviews_loaded=len(inputs.reviews),
            db_status=inputs.db_status,
            error_message=f"write failed: {exc}",
        )

    return ProcessResult(
        run_dir=run_dir,
        status="success",
        reviews_loaded=len(inputs.reviews),
        total_reviews=report.metrics.total_reviews,
        asset_counts={
            "usable": report.asset_counts.usable,
            "stale": report.asset_counts.stale,
            "risk": report.asset_counts.risk,
            "insight": report.asset_counts.insight,
        },
        emergent_cluster_count=len(report.emergent_clusters),
        html_path=html_path,
        json_path=json_path,
        db_status=inputs.db_status,
    )
