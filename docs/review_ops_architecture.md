# Architecture Plan — Industrial Review-Ops Workspace

**Status:** Architecture reference, not an implementation task list. Docs-only.
Nothing here is scheduled work; each future slice is approved individually.

## Context

The industrial review-ops workspace (wire-molding / industrial-materials commerce
testbed) is a working CEO/testbed demo: Streamlit UI + Notion DB export, with
repeated-issue discovery stabilized (deterministic risky-wording sanitizer, cache
key / serialization, SQLite `issue_cache` table, app wiring). This document maps the
current architecture and sequences how the codebase can later migrate to a real web
app and grow the review Q&A from weak RAG into a query-agent — **without** doing any
of it yet.

Key standing decisions, stated up front:
- **Streamlit remains the validation UI for now** — a disposable shell over the
  service layer, not the long-term product UI.
- **Notion remains export / operating record, not the system of record** — the
  SQLite store (later Postgres) stays the source of truth.
- **Web migration is deferred until after CEO/testbed feedback.** Demo readiness is
  the priority.
- **Query-agent direction starts with allowlisted SQL templates + keyword/BM25 +
  vector/RAG + stateful session** — **no free-form Text2SQL first**.
- **No LangGraph yet. No new dependencies.**

Grounding finding: the service layer is already migration-ready. `rag.py`,
`store.py`, `issue_cache.py`, `issue_discovery.py`, `notion_export.py`, and
`schema.py` have zero Streamlit imports and isolate network calls behind lazy OpenAI
imports / injectable transports. `generate()` (`app_industrial_review_ops.py:987`)
is a pure orchestration function (fail-soft on IO). Coupling is concentrated in the
`_render_*` callbacks. Migration is mostly **extraction + a thin API shell**, not a
rewrite.

---

## 1. Current architecture summary

**What lives in Streamlit (`app_industrial_review_ops.py`, ~1855 lines):**
- The whole UI: sidebar (`_render_sidebar`), four tabs (`_render_summary_tab`,
  `_render_review_check_tab`, `_render_ask_tab`, plus issue cards / editors), Notion
  button (`_render_notion_export`).
- One pure orchestrator, `generate()` — ingest → dedup → scope-filter →
  build_report → optional refine → optional cluster/discovery (cache-aware) →
  classify → store → returns a flat result dict (the single contract every surface
  consumes, incl. Notion export).
- A large body of **pure** helpers already free of `st.`: `load_upload`,
  `compute_rating_summary`, `compute_product_summaries`, `compute_product_groups`,
  `expand_group_selection`, `_resolve_scope`, `filter_review_items`,
  `issue_display_item`, `_run_repeated_issues`, `_resolve_repeated_issues`,
  `compute_new_review_summary`.

**Already reusable (no UI coupling — confirmed):**
- `src/voc/review_ops/industrial/rag.py` — in-memory vector index + tag-boost
  ranking + optional grounded LLM answer. Stateless per query.
- `store.py` — stdlib sqlite3; tables: `uploads`, `reviews`, `review_status`,
  `issue_status`, `chat_messages`, `issue_cache`. Embeddings **never** persisted.
- `issue_cache.py` — pure cache key + serialize/deserialize (+ sanitize hook).
- `issue_discovery.py` — 2-stage discover→verify LLM engine (PROTECTED internals).
- `notion_export.py` — pure payload builders; network/env isolated behind an
  injectable transport.
- `schema.py` — Pydantic models (`IndustrialReview`, `WorklistRow`, `IssueCluster`,
  `IndustrialReport`); self-contained, no K-beauty reuse.

**Too tightly coupled to Streamlit (migration friction points):**
- Upload→run→rerun loop lives inside `_render_sidebar`: file parse, `generate()`
  call, `st.session_state` mutation, `st.rerun()` interleaved.
- Status persistence: `_render_review_editors` calls `store.set_review_status`
  directly from a button click — no read-state → command → execute seam.
- Ask flow: `_process_ask_query` mixes embed + rank + LLM + session-state write;
  index build is a session-scoped UI gate, not a service call.
- Notion export glue: mode-resolve + payload-build + POST + result-render all in one
  callback. The pieces are pure; only the glue is Streamlit.

**What Notion does well:** clean, shareable operating record — 운영 요약 callout,
반복 이슈 toggles, 운영 판단 checklist, 적용 범위 toggle; block-budget capped; one row
per analysis run with intra-day uniqueness. Good as an *export / audit log*.

**What Notion should NOT become:** the system of record, the query backend, the
issue-status store, or the multi-user app surface. It is write-mostly export.

---

## 2. Immediate product stance

- **Keep Streamlit + Notion for validation.** They are the demo; do not destabilize.
- **Do not begin web migration before the CEO/testbed response.** Migration is
  sequenced *after* signal.
- **Notion = export / operating record, not system of record.** All state that must
  be queried or mutated lives in the store.
- **Streamlit = validation UI, not the long-term product UI.** Treat it as a
  disposable shell over the service layer.

---

## 3. Web-migration-ready internal structure (target service boundaries)

Principle: the result dict from `generate()` is already a de-facto API response.
Migration = name the seams that exist, not invent new ones. Proposed package:
`src/voc/review_ops/industrial/services/`.

| Service | Current source of logic | Future module | Refactor now / later | Migration risk |
|---|---|---|---|---|
| Ingest | `load_upload`/`read_xlsx`/`read_csv`/`canonicalize`, `ingest.py`, `normalize.py` | `services/ingest.py` | **Later** (post-demo) | Low — already pure |
| Normalize/dedup | `normalize.py`, `dedup.py` | fold into `services/ingest.py` | Later | Low |
| Analysis (report) | `report_model.build_report`, `compute_rating_summary`, `compute_product_summaries` | `services/analysis.py` | Later | Low |
| Repeated-issue | `_run_repeated_issues`, `_resolve_repeated_issues` + `issue_discovery.py` + `issue_cache.py` + `issue_sanitize.py` | `services/issues.py` (thin wrapper; **engine stays PROTECTED**) | **Soon** (extract wrapper from app) | Medium — must preserve cache key & no-key behavior |
| Query/search | `rag.py` + `_process_ask_query` | `services/query.py` (router added later — §5) | Soon (extract query fn out of the callback) | Medium — see §5/§6 |
| Report/export | `notion_export.py` builders | already a service; keep | No change | Low |
| Issue decision/status | `store.review_status` / `issue_status` + `_render_review_editors` | `services/status.py` (read-state→command→execute) | Soon | Medium — UI currently writes directly |
| Notion exporter | `notion_export.py` transport | keep | No change | Low |
| Chat/session | none yet (Streamlit `st.session_state`) | `services/session.py` (`QuerySessionState` — §6) | Later | Medium — new state model |
| Scope/orchestration | `generate()` | `services/pipeline.py` (`run_analysis(...) -> result`) | Soon | Low — already pure |

"Soon" = the first post-demo extraction wave (status, issues wrapper, query fn,
pipeline). "Later" = when the web app actually needs them.

---

## 4. Future web app architecture (MVP-oriented, not overbuilt)

- **Backend: FastAPI** (house framework). Wrap the services from §3; thin routes
  that validate input + call a service + return JSON.
- **Frontend: Next.js + React** — only after demo signal. Until then Streamlit stays.
  Single-page: upload → scope → issues → evidence → decisions → export.
- **DB: SQLite now → Postgres later.** Keep `store.py`'s stdlib-sqlite seam; the
  migration trigger is multi-user / concurrent writes, not before. No ORM until then.
- **Worker/job queue: deferred.** Discovery is synchronous + cached; a queue is only
  warranted once runs are long or concurrent. Note it, don't build it.
- **Notion stays an export target**, called from a backend route, never the store.
- **Minimum API endpoints** (map 1:1 onto services):
  - `POST /uploads` (parse + persist + dedup) → upload summary
  - `POST /analyses` (run pipeline for corpus+scope) → result dict
  - `GET /analyses/{id}` (cached result)
  - `GET /issues?scope=…` / `GET /reviews?filter=…`
  - `POST /reviews/{id}/status` (status/memo)
  - `POST /query` (review Q&A — §5)
  - `POST /exports/notion` (build payload + POST)
- **No** auth/billing/org model/scheduling/auto-collection/scraping in the MVP shell.

---

## 5. Review query / chatbot architecture

Current: `리뷰에게 물어보기` (`rag.py` + `_process_ask_query`) is pure vector RAG —
embed query → cosine + tag-boost rank → optional grounded answer. It keeps **no**
scope/filter/result-set/chat state and has **no** SQL/keyword path. That's the
weakness: "몇 건이야?" / "평점 평균은?" / date-product comparisons are answered by
vector search, which it's bad at.

**Target multi-path query system with a router** (allowlisted, evidence-first):

- **SQL/template path** — counts, averages, filters, rankings, date/product/channel
  comparisons. **Allowlisted parameterized templates only** (e.g.
  `count_reviews(scope, date_range, rating_lt)`, `avg_rating(scope)`,
  `top_products_by_low_rating(n)`). **Not free-form Text2SQL.**
- **Keyword/BM25 path** — exact words, product terms, known phrases (e.g. "접착력", a
  specific SKU). Cheap, exact, no embedding.
- **Vector/RAG path** — meaning, customer language, "보여줘"-style evidence retrieval
  (today's `rag.py`).
- **Hybrid path** — "몇 건이고 실제 표현도 보여줘": SQL template for the count + vector
  retrieval for the example quotes, fused into one answer.
- **Router** — classify intent → choose path(s). Start rules/keyword-based (cheap,
  local-capable — §7), upgrade to a small LLM classifier later. Default to
  evidence-returning paths; SQL templates must be on the allowlist or the router
  falls back to retrieval.
- **Stateful chat memory** — persist current scope/filters + last result_ids + last
  tool outputs so follow-ups ("그중 평점 낮은 건?") resolve against the prior result
  set. Backed by `store.chat_messages` (exists) + a session state object.

Router policy: SQL→aggregations/comparisons; keyword→exact terms;
vector→meaning/examples/evidence; hybrid→number-plus-evidence questions.

---

## 6. Agent-ready design (without LangGraph yet)

Introduce small typed seams (plain dataclasses/Pydantic) so the query system is
agent-shaped before any framework. **No LangChain/LangGraph, no new deps.**

- `QueryIntent` — parsed question: kind (count/avg/compare/find/evidence/followup),
  entities (product/channel/date/rating), raw text.
- `QueryPlan` — ordered tool calls chosen by the router (which paths, with args).
- `ToolResult` — uniform return from each path (rows / scores / snippets + provenance).
- `QuerySessionState` — current scope/filters, `result_ids`, last tool outputs,
  transcript pointer. Persisted via `store.chat_messages` + a scope blob.
- `AnswerComposer` — fuse `ToolResult`s into a grounded Korean answer with evidence
  (reuse `rag.generate_answer` style; cite review_ids).

These map later, 1:1, onto LangGraph nodes if/when adopted:
`parse_intent → resolve_context → choose_tools → run_sql / run_keyword_search /
run_vector_search → fuse_results → answer_with_evidence → update_state →
export_to_notion`. Building the dataclasses first means LangGraph (or not) is a
backend swap, not a rewrite.

---

## 7. Local LLM / quantization direction (plan only)

Can move to local lightweight/quantized models later (latency + cost, low quality
bar): **query routing / intent parse, filter extraction, keyword expansion, simple
summarization, follow-up detection, state updates.** Short, structured, forgiving
tasks — good fit for a small local model behind the router.

Stay API-backed for now (quality-critical, operator/CEO-facing): **repeated-issue
discovery + verification (the PROTECTED 2-stage engine), the final evidence-based
answer, and nuanced report/Notion wording.** Local models here would regress the
exact quality the demo sells. This only marks the seam (the router and the answer
composer are the natural future split points).

---

## 8. DESIGN.md plan

Introduce a small `docs/DESIGN.md` (planning artifact, not code) so future Streamlit
polish and the eventual web UI stay visually consistent. Define:
- Product tone (operating record, calm, hedged — matches the sanitizer's voice).
- Layout principles; spacing/density; issue-card style; priority labels
  (🔴 이번 주 반영 검토 / 🟡 내부 확인 / ⚪ 모니터링 — already used in Notion compact).
- Colors, typography, table/filter style, evidence-quote style (verbatim, cited).
- Notion/export consistency rules (mirror the compact-body grouping).
- Web dashboard direction.

References used *conceptually only* (do not copy any product): Notion-like operating
record, Linear-like issue status, Airtable-like table/filter, Vercel-like clean SaaS
dashboard.

---

## 9. What to do now vs later

**Now (priority = demo):** finish CEO demo rehearsal; keep Streamlit + Notion; avoid
broad web migration; optionally add planning docs only (this doc, later DESIGN.md).

**Soon after demo:** extract service boundaries (§3 "Soon" rows: pipeline, issues
wrapper, query fn, status); design the query engine (§5); improve chatbot state (§6
dataclasses); add DESIGN.md.

**Later:** web app MVP (§4); issue board; real account/org model; scheduling;
auto-collection; local-model routing (§7).

---

## 10. Recommended next slices (reference only — do NOT implement from this doc)

**A. Docs-only architecture plan** *(this document)*
- Goal: lock the migration sequencing + service boundaries as a reference.
- Files: `docs/review_ops_architecture.md`.
- Risk: none (docs only).

**B. DESIGN.md draft**
- Goal: visual + tone contract for Streamlit polish and future web UI.
- Files: `docs/DESIGN.md` (new).
- Risk: none (docs only).
- When: soon after demo, before any new UI work.

**C. Query-agent architecture doc**
- Goal: spec the router + SQL-template allowlist + QueryIntent/Plan/SessionState
  (§5/§6) before code.
- Files: `docs/review_ops_query_agent.md` (new).
- Risk: none (docs only).
- When: soon after demo; precedes slice D.

**D. Query engine service skeleton**
- Goal: extract the ask path out of `_process_ask_query` into `services/query.py`;
  add the typed seams + a rules-based router + one allowlisted SQL template
  (`count_reviews`) + reuse `rag.py` for the vector path. No LangGraph, no new deps.
- Files: `services/query.py` (new), small edits to the app (call the service), tests.
- Risk: medium — must not change `rag.py` ranking behavior or add network in tests;
  keep the existing answer quality.
- When: after C; first real post-demo code slice.

**E. Chatbot state improvement inside Streamlit**
- Goal: persist scope/filters + last result_ids so follow-ups resolve against the
  prior result set (uses `store.chat_messages`, already present).
- Files: the app (`_render_ask_tab` / `_process_ask_query`), optionally
  `services/session.py`, tests.
- Risk: medium — session-state correctness; no engine changes.
- When: alongside or just after D, while still on Streamlit.
