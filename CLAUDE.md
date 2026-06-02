# CLAUDE.md

Working instructions for Claude Code in this repository. Read this before
proposing changes. Sections are ordered by how often you'll need them.

---

## 1. Project Overview

A **seller / store-owner-facing review monitoring backend**. Korean-first,
English-compatible. FastAPI + SQLite + ChromaDB + OpenAI.

The unit of value is *one company → one product → full review history → one
sendable PDF report*. NOT a generic chatbot, NOT a free-form analytics
playground, NOT a portfolio-of-products dashboard.

Active workstream is **Phase 2E**: OliveYoung (and Coupang) cosmetics reviews
→ attribute-level signals → priority-scored PDF report for product improvement
review. Earlier Phase 1 work (lexicon-driven cautionary signal calibration)
remains in tree and is still maintained.

SaaS multi-tenant scaffolding (`scheduler/`, `queue/`, `workers/`,
`persistence/migrations`) exists but is paused. Don't extend it without
explicit ask.

---

## 2. Current Pipeline Stages

End-to-end flow for Phase 2E:

### Stage 1 — Collection
- Source: OliveYoung mobile review API + Coupang CSV. Multi-sort scrape per
  product: `DATETIME_DESC` is the primary corpus (cap=all); 4 signal sorts
  (`RATING_ASC`, etc.) capped at 50 each.
- Persisted via `INSERT OR IGNORE` then post-merge `raw_metadata` UPDATE so
  `oy_observed_sort_types` / `oy_signal_sort_types` / `oy_sort_ranks` /
  `oy_is_primary_corpus` accumulate across passes.
- Modules: `src/voc/connectors/oliveyoung_browser_api.py`,
  `coupang_csv.py`, scripts under `scripts/ingest_*` and
  `scripts/run_oy_collection_batch.py`.

### Stage 2 — Analysis (deterministic + LLM polarity)
- `src/voc/reporting/phase2e/stage1.py` — deterministic attribute detection
  (12 canonical keys: `pigmentation`, `persistence`, `application_blending`,
  `adhesion_base_interaction`, `finish_texture`, `dryness_skin_texture`,
  `color_tone_matching`, `packaging_container`, `applicator_tool`,
  `value_price`, `multi_use_lip_cheek_compatibility`,
  `transfer_resistance`).
- `stage2.py` — LLM polarity judgment per attribute hit.
- Output: per-review `(attribute, polarity, span)` tuples.

### Stage 3 — Aggregation & Scoring
- `aggregate.py` — group by attribute, compute frequency / negative count /
  evidence score.
- `insights.py` — synthesize per-attribute Korean insight sentences.
- `impact.py` — frequency-aware, confidence-aware impact bonus and Korean
  business-impact phrase. Risk categories:
  `재구매율 저하 / 클레임 증가 / 경쟁사 이탈 / 부정 리뷰 누적 / 가격 저항 / 신뢰도 하락`.
- `recommendations.py` — 12 attribute → action phrase + execution category
  (`즉시 실행 / 중기 개선 / 실험·검증`).
- `executive_summary.py` — verdict + top priority items with full KPI framing.

Priority score combines: frequency (×25) + evidence weight + severity (×2)
+ tier bonus + impact bonus (severity-graded 3/2/1, attribute-modifier
clamped to ±0.75, frequency-scaled, confidence-blended via
`0.5×log(n_reviews+1)/log(1000) + 0.5×log(n_negative+1)/log(100)`).

### Stage 4 — Reporting (PDF + cardnews)
- `scripts/generate_phase2e_pdf_v2.py` — file holds **two renderers**:
  legacy `render_pdf_v2` and the ship layout
  `render_seller_business_report_v3`. The pipeline and
  `scripts/republish_run.py` both call **v3**. If you edit "the report"
  without specifying which, you almost certainly mean v3 — pass-12
  shipped layout fixes into v2 by mistake and they did not land in the
  PDF that operators received.
- `analysis_report.json` is the canonical adapter output and the
  single source of truth that both the PDF renderer and the cardnews
  generator consume. Make changes at the adapter
  (`src/voc/content/adapters/from_phase2e.py`) so the JSON itself is
  clean; never paper over degraded JSON in render-time helpers.
- Phase 1 PDFs go through `src/voc/reporting/phase1/pipeline.py`.
- Cardnews infrastructure lives in `cardnews/` (templates + render.py
  + safety_validator). It reads the same `analysis_report.json` and
  produces Instagram-format narrative cards.

**Why each stage exists** — collection without multi-sort hides negative
signals; analysis without attributes collapses back to a single sentiment
number; scoring without impact/confidence treats all complaints equally;
reporting without a sendable PDF leaves results stranded in a notebook.

---

## 3. Commands

```bash
# Install
pip install -e ".[dev]"

# API server (reads HOST/PORT/LOG_LEVEL from .env)
python -m src.voc.api

# Demo UI (requires backend running)
streamlit run app_demo.py

# Phase 2E pipeline + PDF
python scripts/run_phase2e_pipeline.py
python scripts/generate_phase2e_pdf_v2.py

# Phase 1 baseline eval (authoritative — never hand-roll scope flags)
bash scripts/eval_phase1_baseline.sh

# Tests
pytest tests/
pytest tests/test_reporting/test_phase2e/ -v

# Single test file or single test by name
pytest tests/test_content/test_quote_summary_normalizer.py -v
pytest tests/test_content/test_quote_summary_normalizer.py::TestPredicates::test_clean_summary_not_truncated -v

# Inspect a finished run (quote/coverage warnings, sort coverage, etc.)
PYTHONPATH=. python3 scripts/inspect_run_quality.py --run-dir outputs/<run-dir>

# Re-render PDF + cardnews from an existing run without re-collecting
PYTHONPATH=. python3 scripts/republish_run.py --run-dir outputs/<run-dir>

# Lint
ruff check src/ tests/
```

Run artifacts land in `outputs/<date>_product-<hash>_run-<NNN>/` —
each contains `analysis_report.json` (canonical, clean per pass-17),
`manifest.json`, `collection_summary.json`, `seller_report_ko.pdf`,
and a `cardnews/` subdir. Design notes for past work live in `docs/`
(phase2_*.md, oliveyoung_*.md). Re-grounding in those before
proposing changes is usually faster than re-deriving.

---

## 4. Architecture

FastAPI-based VOC backend. Two pipeline paths through one orchestrator
(`src/voc/app/orchestrator.py`):

- **Ingest** (`POST /v1/pipeline/run`): connector → normalizer → dedup →
  evidence split → chunk → embed → ChromaDB index
- **Query** (`POST /v1/query`): embed question → ChromaDB retrieve → LLM
  generate VOCInsight

Data chain:
`RawReview → CanonicalReview → EvidenceUnit → Chunk → ChromaDB → RetrievedChunk → VOCInsight`

Schemas live in `src/voc/schemas/`. Key invariant:
`EvidenceUnit.text == parent_review.text[char_start:char_end]`.

**Layer separation:**
- `src/voc/api/routes/` — thin FastAPI, validate input, generate `run_id`,
  call orchestrator
- `src/voc/app/orchestrator.py` — chains stages with per-step timing/error
  tracking
- `src/voc/ingestion/`, `processing/`, `retrieval/`, `generation/`,
  `reporting/` — domain logic, no FastAPI dependency

**DI:** Singletons created in `src/voc/api/main.py` lifespan; accessed via
`Request.app.state` through `src/voc/api/dependencies.py`.

**Run tracking:** every call gets `run_id = {prefix}_{YYYYMMDD}_{HHMMSS}_{uuid6}`,
threaded through logs via `contextvars` (`src/voc/logging.py`).

---

## 5. Non-Negotiable Rules

1. **Detector logic does not change without explicit instruction.** The
   Phase 2E Stage 1 detector and Phase 1 lexicons are calibrated and
   covered by precision/recall tests. Improving "phrasing" by editing
   patterns silently breaks the eval.
2. **Aggregation does not change without explicit instruction.** Same
   reason — downstream scoring stability depends on it.
3. **Corpus filtering is fixed**: `fetch_reviews(oy_sort_type=DATETIME_DESC)`
   is the canonical primary corpus. Signal sorts are membership-only
   metadata, not corpus members.
4. **Naming separation is non-negotiable.** Human concern tags (in
   `phase1_signals_golden.json`) and pipeline signal IDs (in
   `cautionary.json`) are separate namespaces bridged by
   `phase1_signal_map.json`. Every mapping must have an explicit signal_map
   entry, even when 1:1 and even when the strings happen to match.
5. **Metrics are hypotheses, not pass/fail targets.** Plans state expected
   direction-of-movement; acceptance is qualitative (precision floor +
   no-regression). Never lock a numeric recall target as the gate.
6. **Re-ground from source before pattern design.** Read the current golden
   file or DB sample fresh; don't rely on prior-turn survey memory.
7. **Polarity safety on every new pattern.** Before adding any cautionary
   pattern, grep the full corpus for 5★/positive-construct hits; discard
   patterns with non-zero unlabeled positive hits.
8. **Backend owns business logic.** Streamlit and PDF renderers are thin
   shells. Don't push domain logic into the frontend or the report script.
9. **Imports are absolute.** Always
   `from src.voc.schemas.canonical import CanonicalReview`.
10. **Quote-quality predicates are shared, not copied.** The
    inspector, the adapter, and the renderer must import from
    `src/voc/content/quote_summary_normalizer.py`. Drift between
    local copies has produced false "no clean summary" warnings
    before — when in doubt, import the public name and move on.
11. **Normalize at the adapter, not the renderer.** When report
    output looks degraded, fix it in the JSON-write path
    (`adapters/from_phase2e.py`) so `analysis_report.json` is
    already clean at rest. Render-time fallbacks mask the problem
    for the PDF but leave cardnews and downstream consumers broken.

---

## 6. Protected Areas

Do not modify these without an explicit, scoped request:

- `src/voc/reporting/phase2e/stage1.py` — attribute detector logic.
- `src/voc/reporting/phase2e/stage2.py` — LLM polarity prompts.
- `src/voc/reporting/phase2e/aggregate.py` — aggregation math.
- `src/voc/reporting/phase1/signals.py` — Phase 1 detection.
- `data/phase1_lexicons/*.json` — versioned. Version bumps require
  paired test updates.
- `eval_data/phase1/phase1_signals_golden.json` and
  `phase1_signal_map.json` — golden labels and the bridge.
- `eval_data/phase1/baseline.md` — authoritative; regenerate via
  `scripts/eval_phase1_baseline.sh`, never hand-roll.
- `IMPACTS_KO`, `RECOMMENDATIONS_KO`, `BUSINESS_IMPACT_KO`, verdict
  templates — phrase changes are stakeholder-visible. Pair every edit
  with the corresponding test in
  `tests/test_reporting/test_phase2e/`.
- Any priority-scoring formula in `impact.py` /
  `executive_summary.py` — currently paused; resume only on request.
- SaaS scaffolding (`scheduler/`, `queue/`, `workers/`,
  `persistence/migrations`) — paused, do not extend.
- `src/voc/content/quote_summary_normalizer.py` — the **single shared
  source of truth** for quote-quality predicates
  (`is_degraded_quote_summary`, `looks_dangling`, `looks_truncated`,
  `looks_too_generic`) and profile-aware fallback resolution
  (`attribute_specific_summary`, `normalize_display_quote_summary`).
  The adapter (`from_phase2e.py`), the v3 PDF renderer, and
  `scripts/inspect_run_quality.py` ALL import from this module — do
  not re-implement local copies of these predicates. The
  `_NOMINAL_TAIL_SUFFIXES` allow-list (의견 / 언급 / 느낌 / etc.) is
  load-bearing: curated fallback summaries end in those tails and
  must not register as dangling.
- `src/voc/content/product_name_normalizer.py` — splits raw merch
  headlines into `raw_product_name / display_product_name /
  offer_context / promo_context / report_title`. The PDF cover and
  the cardnews surface use the **display** name, never the raw.
- The 7 cosmetics profiles
  (`skincare_pad`, `skincare_general`, `base_makeup`, `lip_makeup`,
  `sunscreen`, `cleansing`, `fallback_generic`) drive trade-off
  templates and per-attribute fallback summaries. The active profile
  flows from the analysis report's `product.selected_profile_id`
  through both the renderer and the adapter — keep it threaded; do
  not hardcode `skincare_pad`.

---

## 7. Testing Requirements

- **Run before declaring done.** `pytest tests/` for broad changes;
  `pytest tests/test_reporting/test_phase2e/ -v` for Phase 2E work;
  `bash scripts/eval_phase1_baseline.sh` after Phase 1 lexicon changes.
- **Lexicon version assertions track exact versions.** Bumping
  `cautionary.json` or `positive.json` requires matching updates in
  `tests/test_reporting/test_phase1/test_signals.py` and
  `test_pipeline.py`.
- **Phrase-locked tests are intentional.** Tests like
  `test_user_example_transfer_resistance_phrase_locked` and
  `test_every_phrase_ends_in_hedged_candidate_form` enforce wording
  contracts. If a phrase change is requested, update both the source
  dict and the locked test in the same change.
- **No test deletion to make a build pass.** If a test fails, fix the
  code or the test reasoning — don't delete the assertion.
- **No regression on previously stabilized signals.** Tone_mismatch,
  pigment_complaint, application_issue, persistence, value, and the
  three gap rules must not drop on precision *or* recall.

---

## 8. PDF / Report Wording Rules

The Phase 2E report goes to brand operators who do not share their
formulation, QA, or cost data with us. Wording must reflect that.

- **Hypothesis-framed, not directive.** Recommendation phrases must end
  in one of `{후보, 가능성, 검토, 권장, 확인}`. Never `필요`, `해야 함`,
  `원인은`, `개선 필요`. The contract is enforced by
  `test_every_phrase_ends_in_hedged_candidate_form` and
  `test_no_phrase_uses_directive_imperative_wording`.
- **Impact phrases hedge with `이어질 수 있습니다`.** Stronger language
  (`발생합니다`) overstates the correlational evidence VOC carries.
- **Verdict templates use `우선 검토 후보로 보입니다`**, not
  `우선 개선이 필요합니다`.
- **Korean grammar safety.** Use `{label} 관련 부정 의견` to avoid
  batchim/particle agreement bugs across attribute names.
- **Methodology disclaimer must remain on the PDF.** The "해석 안내"
  paragraph below the methodology footer is required — it states that
  the report proposes candidates, not prescriptions, and that real
  causes/manufacturing changes need internal review.
- **Action categories are visible chips**: `즉시 실행 / 중기 개선 /
  실험·검증`. The mapping in `ACTION_CATEGORY_KO` is the source of
  truth — do not invent new categories ad hoc.

---

## 9. Scraping / Collection Safety Rules

- **Multi-sort is the design, not a hack.** `DATETIME_DESC` is the only
  primary corpus. Signal sorts (`RATING_ASC`, etc.) contribute
  membership metadata to existing rows via `raw_metadata` UPDATEs;
  they do not add new corpus rows.
- **Anti-bot signals must escalate, not retry.** False-empty review
  pages and other soft blocks trigger stepped backoff + page recreate.
  Don't shorten the backoff or remove the page-recreate path to "speed
  things up."
- **Persistence is `INSERT OR IGNORE` then merge.** Re-running collection
  must be idempotent. Sidecars (per-sort review_id files) are the
  source of truth for membership/rank reconstruction.
- **Rank metadata is additive.** `oy_sort_ranks` accumulates per-sort
  rank info. Never overwrite the dict; merge new sort keys in.
- **Don't add new scraping channels casually.** Each channel is a
  separate compliance + UA + rate-limit problem. Naver, Instagram,
  TikTok scrapes are out of scope unless explicitly requested.
- **No new scraping under the Phase 1 plan.** Phase 1's constraint set
  is "no LLM, no new scraping, no schema changes."

---

## 10. Evidence Handling Rules

- **Span fidelity invariant:**
  `EvidenceUnit.text == parent_review.text[char_start:char_end]`.
  Never paraphrase, never strip whitespace, never normalize case in a
  way that breaks this.
- **Evidence score drives PDF selection**, not raw rating.
  `oy_evidence_score = rating_tier × sort_multiplier × rank_tier`.
  Tie-breakers in the order: polarity, rating, span length, date.
- **Evidence quotes in the PDF must be verbatim.** Do not edit or
  truncate review text shown to operators except by ellipsis with
  preserved char boundaries.
- **Per-attribute evidence is paired with its source review_id.** The
  PDF must be auditable back to a single review row.
- **Deterministic IDs.** `evidence_id = f"{review_id}_{unit_index:03d}"`,
  `chunk_id = sha256(sorted(evidence_ids))[:16]`. Stable across
  re-ingestion when the splitter is unchanged.
- **Content fingerprint is single-path:** `sha256(NFC + lowercase +
  strip + collapse_whitespace)` — language-agnostic, do not branch
  per language.

---

## 11. Key Conventions

- **Language field is load-bearing.** `language` on
  CanonicalReview/EvidenceUnit/Chunk is `"ko" | "en" | "unknown"` and
  drives sentence splitting, chunk token targets, and eval rubric.
- **Review ID:** source-stable when `source_id` exists
  (`sha256(channel::source_id)[:16]`), content-addressed fallback
  (`sha256(channel::fingerprint)[:16]`).
- **ChromaDB metadata:** `evidence_ids` stored as comma-joined string
  (Chroma doesn't support list values). `rating_normalized` uses
  `-1.0` as sentinel for None.

---

## 12. Stubbed / Not Yet Implemented

- `src/voc/eval/` — runner, metrics, judge, failure_analysis are
  skeletons. Eval datasets are frozen JSON in `eval_data/`.
- `src/voc/retrieval/retriever.py` — `"filtered_reranked"` raises
  `NotImplementedError`.
- `src/voc/generation/insight_gen.py::generate_team_handoff` —
  `NotImplementedError`.
- `src/voc/analysis/report.py` — both functions raise
  `NotImplementedError`.
- `src/voc/connectors/google_business.py` — spike. Naver not
  scaffolded.
- Scheduled refresh, alerting, multi-tenant isolation, auth — not
  implemented.

---

## 13. How to Summarize Completed Work

Keep summaries short, factual, and grounded in artifacts. Reuse the
template below for end-of-task reports:

```
## What changed
- <file:line> — one-line change summary
- <file:line> — one-line change summary

## Why
<1–2 sentences linking the change to the user's stated goal.>

## Verification
- Tests run: <command(s)> — N passed, M skipped, 0 failed
- Manual checks: <PDF generated at /tmp/..., visual inspection note, etc.>

## Risks / follow-ups (if any)
- <One-line item, optional.>
```

Rules for these summaries:

- **No hype, no adjectives.** "Refactored" not "successfully refactored."
- **Cite file:line for every code change.** Reviewer should be able to
  click straight to the diff.
- **Distinguish hypothesis from result.** If the task was to verify a
  metric direction-of-movement, report the actual delta — do not defend
  the hypothesis.
- **Note skipped tests explicitly.** "1053 passed, 1 skipped" not
  "all green."
- **No memory writes for completed-task summaries.** Conversation log
  is enough; only save memory for guidance that crosses conversations.
- **No cleanup PR offers for routine tasks.** Bug fixes, doc edits,
  test updates don't need a follow-up scheduled agent.

---

## 14. Environment

Requires `OPENAI_API_KEY` in `.env` or environment. Without it the app
crashes at startup (pydantic-settings validation). Health endpoints
work only after successful startup.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
