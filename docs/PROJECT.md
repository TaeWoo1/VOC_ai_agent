# Project Overview

## One-line summary

A seller-facing review monitoring service that ingests customer reviews from multiple source types, generates actionable monitoring reports, and provides an operator console for source management, refresh observability, and trend tracking.

## The problem

Korean ecommerce sellers manage reviews across multiple platforms (Naver Smart Store, Coupang, Google Business Profile) with no unified monitoring tool. Current options are either manual spreadsheet tracking or generic sentiment analysis chatbots that require the seller to know what to ask.

The core insight: **sellers don't need a question-answering tool — they need a monitoring tool that tells them what to look at first.** The product should surface "your battery complaints increased 40% this week" without the seller having to ask "are there battery complaints?"

## What I built

**Backend (FastAPI + SQLite + ChromaDB):**
- Entity-centered monitoring — register products/stores as monitoring targets, not keywords
- Source connection management — connect, validate, activate/deactivate review sources with lifecycle tracking
- Ingestion pipeline — collect → normalize → dedup → evidence split → chunk → embed → index (Korean-first, language-aware throughout)
- Non-blocking refresh with source-aware job tracking — per-source collected/indexed/errors/skipped recorded in job metadata
- LLM-powered monitoring reports — prioritized action items, recurring issues, flagged reviews
- Snapshot persistence for trend comparison
- Source validation — structural readiness checks per connector type (file existence, config completeness, credential presence)

**Operator console (Streamlit):**
- Source management — upload CSV/JSON, create API sources, validate, activate/deactivate, delete
- Pre-refresh readiness summary + execution preview
- Post-refresh source-by-source result breakdown with error context
- Operator action recommendations (heuristic-based, not LLM)
- Monitoring report with top-issue callout, priority badges, why_urgent, flagged reviews with ratings
- Refresh and snapshot history with deltas and repeated-failure detection
- Multi-entity overview with status hints

**Source types:**
| Source | Status | Notes |
|---|---|---|
| CSV upload | Production-ready | Auto-creates source connection on upload |
| JSON import | Production-ready | Recommended for browser-captured data |
| Google Business Profile | Spike/scaffold | Correct API mapping, manual OAuth token required |
| Mock | Dev fixture | Loads from fixture JSON files |

**Test coverage:** 92 tests covering repositories, connectors (CSV, JSON, GBP), and source validation. All deterministic, no network calls.

## What I deliberately did not build

| Decision | Reasoning |
|---|---|
| No scheduled/automatic refresh | Priority was source management and observability. Scheduling is mechanical — the operator workflow had to be right first. |
| No multi-tenant auth | Single-operator MVP. Auth adds complexity without validating the core product hypothesis. |
| No Postgres/Redis | SQLite (stdlib) is zero-dependency, single-file, sufficient for MVP scale. Migration path is straightforward if needed. |
| No production Korean ecommerce connectors | Naver/Coupang/11번가 have no public review APIs. Built JSON import as a bridge for browser-captured data instead of pretending automated scraping is viable. |
| No full-stack frontend | Streamlit is a thin operator console. Business logic stays in the backend. A React/Next.js frontend would be premature before the product flow is validated. |
| No evaluation framework integration | Eval dataset and gold references exist as frozen assets. Runner is scaffolded. The priority was getting the product loop working, not tuning retrieval metrics. |
| No advanced retrieval (filtered + reranked) | Naive embedding similarity is sufficient at current scale. The interface is ready for reranking when needed. |

## Key technical decisions

**1. Source connections as a separate relation, not a field on entity**

The entity table has a legacy `connector` string field. Source connections are a separate `source_connections` table with config, capabilities, and lifecycle state. This allows multiple sources per entity, independent validation, and activation/deactivation without losing config.

**2. SyncService as execution-agnostic coordinator**

`SyncService.execute_refresh()` is a plain async method — no FastAPI dependency. The route layer dispatches it via `BackgroundTasks`. This separation means the same refresh logic can be called from a queue worker, a CLI, or a scheduler without code changes.

**3. Validation is structural, not live**

Source validation checks config completeness and file existence — no network calls. This is fast, deterministic, and always available. Live connectivity checks (e.g., testing a GBP OAuth token) are intentionally omitted because they're unreliable (token expiry, rate limits) and create false confidence.

**4. CollectParams.language_filter as config transport**

The `ChannelConnector` protocol is `collect(keyword, params)` — keyword-first, designed for search connectors. CSV/JSON/GBP need entity-scoped config (file paths, API credentials), not keywords. Rather than redesigning the protocol, `language_filter` is repurposed as a config transport: CSV gets a file path, GBP gets a JSON-serialized config blob. Documented as a bridge pattern, not a permanent design.

**5. Source channel (review origin) vs connector type (ingestion mechanism)**

`RawReview.source_channel` records what platform the review came from (naver, google_business). `connector_type` on the source connection records how the data entered the system (csv, json_import). A Naver review captured via browser and uploaded as JSON has `source_channel="naver"` and `connector_type="json_import"`. This distinction keeps downstream normalization (domain mapping, rating scales) correct.

**6. Job metadata over schema expansion**

Refresh results include per-source summaries, error details, and skipped-source info. Rather than adding columns to the `sync_jobs` table, this data goes into the existing `metadata_json` column. No migrations needed, backward compatible, and the structured data is still queryable via the API.

## Project scope honesty

This is a **backend-first MVP with a working operator console**, not a production SaaS.

What works end-to-end:
- Register entity → upload reviews → validate sources → refresh → generate monitoring report → inspect history

What is a spike or scaffold:
- GBP connector (correct API mapping, but requires manual token management)
- Browser-capture bridge (JSON import works, Playwright MCP is documented but not integrated)

What is intentionally deferred:
- Auth, multi-tenant, scheduling, persistent vector store, production connectors, evaluation framework

## Repository structure

```
src/voc/
  api/           Routes, schemas, dependencies, middleware
  app/           Services (SyncService, MonitoringService, source_validation)
  connectors/    CSV, JSON import, GBP, Mock
  ingestion/     Normalizer, dedup, evidence splitter
  processing/    Embedder, chunker, indexer
  retrieval/     ChromaDB retriever
  generation/    LLM insight generator, prompts
  persistence/   SQLite repositories, migrations
  schemas/       Pydantic models (RawReview, CanonicalReview, Entity, etc.)
  config.py      pydantic-settings configuration

app_demo.py      Streamlit operator console
examples/        Sample review files + demo guide
tests/           92 tests (repositories, connectors, validation)
```

## Talking points for interviews

1. **Product thinking:** "I started with a RAG pipeline and deliberately pivoted to a monitoring product. The insight was that sellers need proactive alerts, not a question-answering interface."

2. **Architecture layering:** "Routes are thin HTTP, services own business logic, repositories are pure data access, core engine is untouched. I can swap the scheduler, the frontend, or the persistence layer without touching the pipeline."

3. **Source management as a product surface:** "Most AI projects treat data ingestion as plumbing. I made it a first-class user-facing feature — source connections have lifecycle, validation, and observability."

4. **Honest scope control:** "I built CSV and JSON import as real flows, kept GBP as an honest spike, and documented Korean ecommerce platform constraints instead of building unreliable scrapers."

5. **Observability over features:** "I spent time on per-source refresh results, skipped-source tracking, error summaries, and trend deltas rather than adding more AI capabilities. Operators need to trust the system before they use it."

6. **Korean language handling:** "The pipeline is Korean-first — NFC normalization, Hangul-aware sentence splitting, Korean date parsing, language detection. Not just an English pipeline with Korean text passed through."
