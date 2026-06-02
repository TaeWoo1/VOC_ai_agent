"""Content engine package — consumer-only of analysis_report.json.

This package owns the buyer-facing content generation pipeline (Instagram
cardnews, Threads, X) and the run-directory + manifest layer that groups
seller PDF, buyer content, shared analysis, and provenance under a single
human-readable run directory.

Hard rules (CLAUDE.md non-negotiables that this package must respect):

- analysis_report.json is the single source of truth. Modules under
  src.voc.content/* must NOT import from src.voc.reporting.phase2e.stage1,
  stage2, or aggregate. They read already-aggregated artifacts only.
- No DB writes, no scraping, no LLM call from this Phase A scaffold.
- All artifacts live under outputs/{YYYY-MM-DD}_{slug}_run-{NNN}/. Nothing
  is written to docs/, /tmp, or repo root.

Phase A (this slice) ships:

- paths.py — slugify + allocate_run_dir
- manifest.py — manifest writer with relative paths + sha256

Phase B+ (later) will add:

- skeleton.py — deterministic slot-fill from analysis_report.json
- validators.py — ban-list, length, confidence gating, safety_report.json
- channels/{instagram,threads,x}.py — per-channel renderers
"""
from __future__ import annotations
