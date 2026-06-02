"""Phase E: unique product insight extraction.

E1+E2 (this slice) ships the deterministic foundation:

- `schema.py`         — frozen Python literals + dataclasses + caps mirroring
                        the JSON Schema at `schemas/unique_product_insights.schema.json`.
- `candidate_pool.py` — pure pre-pass over `analysis_report.json` that
                        produces five evidence-anchored bucket lists for
                        the LLM extractor to consume.
- `validators.py`     — substring + ban-list + structural validator that
                        the future Phase E3 LLM extractor's output must
                        pass before being written to disk.

E3+ (future) adds the LLM call (`extractor.py`) and the orchestrator
hook in `run_all.py`. Phase E1+E2 is **LLM-free**: every test runs
without network or API keys.

Hard contract carried forward:
- analysis_report.json is the single read-only source of evidence.
- No DB access, no scraping, no LLM, no detector / lexicon edits.
- Every claim emitted by the future extractor is grounded in a
  literal substring of `candidate_pool.bounded_review_excerpts`.
"""
from __future__ import annotations
