from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_DB_PATH = REPO_ROOT / "voc_data.db"


@dataclass
class ReviewRow:
    review_id: str
    text: str
    rating_raw: Optional[float]
    review_date: Optional[date]
    product_option: Optional[str]
    has_brand_reply: bool
    source_channel: str


@dataclass
class ReviewOpsInputs:
    run_dir: Path
    run_id: Optional[str]
    analysis_report: dict
    manifest: dict
    reviews: list[ReviewRow] = field(default_factory=list)
    selected_profile_id: Optional[str] = None
    quote_review_ids: set[str] = field(default_factory=set)
    db_status: str = "ok"  # "ok" | "missing" | "no_match" | "error"


def _parse_iso_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None


def _safe_json(s: Optional[str]) -> dict:
    if not s:
        return {}
    try:
        return json.loads(s)
    except (TypeError, json.JSONDecodeError):
        return {}


def _collect_quote_review_ids(report: dict) -> set[str]:
    ids: set[str] = set()

    def walk(node):
        if isinstance(node, dict):
            rid = node.get("review_id")
            if isinstance(rid, str) and rid:
                ids.add(rid)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(report)
    return ids


def _query_reviews(
    db_path: Path,
    *,
    run_id: Optional[str],
    product_keyword: Optional[str],
) -> tuple[list[ReviewRow], str]:
    """Return (rows, status). Degrades gracefully on missing DB / no match."""
    if not db_path.exists():
        return [], "missing"

    uri = f"file:{db_path}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
    except sqlite3.Error:
        return [], "error"

    try:
        conn.row_factory = sqlite3.Row
        # Prefer run_id if available; otherwise fall back to product_keyword.
        # (manifest often does not carry run_id in current pipeline output.)
        if run_id:
            cur = conn.execute(
                """
                SELECT review_id, source_channel, rating_raw, review_date,
                       text, channel_meta_json, raw_metadata_json
                FROM phase1_reviews
                WHERE run_id = ? AND is_duplicate = 0
                """,
                (run_id,),
            )
            rows = list(cur.fetchall())
        else:
            rows = []

        if not rows and product_keyword:
            cur = conn.execute(
                """
                SELECT review_id, source_channel, rating_raw, review_date,
                       text, channel_meta_json, raw_metadata_json
                FROM phase1_reviews
                WHERE product_keyword = ? AND is_duplicate = 0
                """,
                (product_keyword,),
            )
            rows = list(cur.fetchall())

        if not rows:
            return [], "no_match"

        out: list[ReviewRow] = []
        for r in rows:
            channel_meta = _safe_json(r["channel_meta_json"])
            raw_meta = _safe_json(r["raw_metadata_json"])
            # has_brand_reply: not collected for OY in the current pipeline.
            # Allow either explicit flag or vendor-specific field; default False.
            reply = (
                channel_meta.get("has_brand_reply")
                or raw_meta.get("has_brand_reply")
                or raw_meta.get("oy_has_brand_reply")
                or False
            )
            product_option = channel_meta.get("product_option_raw") or channel_meta.get(
                "product_option"
            )
            out.append(
                ReviewRow(
                    review_id=r["review_id"],
                    text=r["text"] or "",
                    rating_raw=r["rating_raw"],
                    review_date=_parse_iso_date(r["review_date"]),
                    product_option=product_option,
                    has_brand_reply=bool(reply),
                    source_channel=r["source_channel"] or "",
                )
            )
        return out, "ok"
    finally:
        conn.close()


def load_review_ops_inputs(
    run_dir: Path,
    *,
    db_path: Optional[Path] = None,
) -> ReviewOpsInputs:
    """Load all inputs needed by the review_ops pipeline.

    Reads from disk only — never writes. DB access is read-only via sqlite3
    `mode=ro` URI. Degrades gracefully when the DB is missing or no rows
    match the run_dir's product.
    """
    run_dir = Path(run_dir)
    if not run_dir.is_dir():
        raise FileNotFoundError(f"run_dir not found: {run_dir}")

    manifest_path = run_dir / "manifest.json"
    analysis_path = run_dir / "shared" / "analysis_report.json"

    manifest: dict = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    if not analysis_path.exists():
        raise FileNotFoundError(f"analysis_report.json not found at {analysis_path}")
    analysis_report = json.loads(analysis_path.read_text(encoding="utf-8"))

    run_id: Optional[str] = (
        manifest.get("run_id")
        or (manifest.get("config") or {}).get("run_id")
    )

    product = analysis_report.get("product") or {}
    manifest_product = manifest.get("product") or {}
    product_keyword = (
        product.get("source_url")
        or manifest_product.get("source_url")
    )

    db = Path(db_path) if db_path else DEFAULT_DB_PATH
    reviews, status = _query_reviews(
        db,
        run_id=run_id,
        product_keyword=product_keyword,
    )

    return ReviewOpsInputs(
        run_dir=run_dir,
        run_id=run_id,
        analysis_report=analysis_report,
        manifest=manifest,
        reviews=reviews,
        selected_profile_id=product.get("selected_profile_id"),
        quote_review_ids=_collect_quote_review_ids(analysis_report),
        db_status=status,
    )
