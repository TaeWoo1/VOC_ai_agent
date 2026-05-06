"""Canonical content-engine schemas.

The JSON schemas under this directory are the source of truth for
contracts the content engine reads or writes. Each run directory
gets a *copy* of `analysis_report.schema.json` placed under
`shared/` at run-allocation time so a re-render against a stale
analysis report fails fast against the schema version it was
authored under.

Phase C adds `consumer_insight_brief.schema.json` — the buyer-facing
crystallization layer that the LLM polish layer (Phase D+) reads.
"""
from __future__ import annotations

from pathlib import Path

SCHEMAS_DIR = Path(__file__).resolve().parent
ANALYSIS_REPORT_SCHEMA_PATH = SCHEMAS_DIR / "analysis_report.schema.json"
CONSUMER_INSIGHT_BRIEF_SCHEMA_PATH = SCHEMAS_DIR / "consumer_insight_brief.schema.json"
EDITORIAL_CARDNEWS_SCHEMA_PATH = SCHEMAS_DIR / "editorial_cardnews.schema.json"
UNIQUE_PRODUCT_INSIGHTS_SCHEMA_PATH = SCHEMAS_DIR / "unique_product_insights.schema.json"
