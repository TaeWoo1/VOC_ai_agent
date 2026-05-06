"""Adapters that convert seller-side analysis artifacts into the
v3.0 `analysis_report.json` schema the content engine consumes.

Phase 2E's pipeline produces `ProductReportData` (Python dataclass)
and renders it directly to PDF; it does not yet emit
`analysis_report.json`. The adapter in `from_phase2e` closes that
gap so a single `run_all.py` can chain seller + buyer surfaces.

Adapters are pure consumers of analysis artifacts — no DB access,
no LLM call, no analysis-logic changes. Bookkeeping only:
re-shaping fields the analysis layer already produced.
"""
from __future__ import annotations
