# CLAUDE.md

This repository currently contains a deployable backend MVP for VOC ingestion, retrieval, and insight generation, and is being repositioned toward a seller/store-owner-facing review monitoring service.

## Commands

```bash
# Install
pip install -e ".[dev]"

# Run API server
python -m src.voc.api                    # reads HOST/PORT/LOG_LEVEL from .env

# Run demo UI (requires backend running)
streamlit run app_demo.py

# Run offline ingestion inspection (no API key needed)
PYTHONPATH=. python3 scripts/inspect_ingestion.py

# Tests
pytest tests/
pytest tests/test_ingestion/test_normalizer.py -v

# Lint
ruff check src/ tests/

# Docker
docker build -t voc-api .
docker run --rm -e OPENAI_API_KEY=... -p 8000:8000 voc-api
```

## Architecture

This is a FastAPI-based VOC (Voice of Customer) intelligence backend. Korean-first, English-compatible.

**Two pipeline paths through a single orchestrator (`src/voc/app/orchestrator.py`):**

- **Ingest** (`POST /v1/pipeline/run`): connector → normalizer → dedup → evidence split → chunk → embed → ChromaDB index
- **Query** (`POST /v1/query`): embed question → ChromaDB retrieve → LLM generate VOCInsight

**Data transformation chain:**
```
RawReview → CanonicalReview → EvidenceUnit → Chunk → (ChromaDB) → RetrievedChunk → VOCInsight
```

Each schema is in `src/voc/schemas/`. Key invariant: `EvidenceUnit.text == parent_review.text[char_start:char_end]`.

**Layer separation:**
- `src/voc/api/routes/` — thin FastAPI routes, validate input, generate run_id, call orchestrator
- `src/voc/app/orchestrator.py` — `VOCPipeline` class, chains stages with per-step timing/error tracking
- `src/voc/ingestion/`, `processing/`, `retrieval/`, `generation/` — core domain logic, no FastAPI dependency

**Dependency injection:** Singletons (Embedder, ChunkIndexer, InsightGenerator, VOCPipeline, RunStore) created in `src/voc/api/main.py` lifespan, accessed via `Request.app.state` through `src/voc/api/dependencies.py`.

**Run tracking:** Every pipeline/query call gets a `run_id` (format: `{prefix}_{YYYYMMDD}_{HHMMSS}_{uuid6}`). Results stored in `RunStore` (in-memory dict), queryable via `GET /v1/runs/{run_id}`. The `run_id` is threaded through logs via `contextvars` (`src/voc/logging.py`).

## Current Product Direction

This repository currently contains a working backend MVP for VOC ingestion, retrieval, and insight generation.

However, the intended product direction is **not** a generic free-form analysis tool.
The target direction is a **seller-facing / store-owner-facing review monitoring service**.

### Product framing to preserve

Think of this system as:

- a monitoring backend for a specific product, store, or business entity
- a service that helps an operator quickly understand:
  - what new reviews are appearing
  - what issues are increasing
  - what the overall sentiment trend looks like
  - which complaints require action first

Do **not** reframe it as a general chatbot or open-ended analytics playground unless explicitly asked.

### What the current implementation is

The current implementation should be treated as:

- a reusable backend engine / baseline
- a deployable API MVP
- a foundation for a future monitoring-oriented product flow

The current query flow is useful, but it is **not yet the final product surface**.
Future planning should prioritize a monitoring-oriented UX and entity-centered flow over adding more generic AI features.

### Current product state

The system is now entity-driven monitoring with:
- entity/product/store management
- source connection lifecycle
- operator-facing monitoring reports
- refresh/snapshot history with trend tracking
- Streamlit operator console

### Guidance for future planning

When proposing next steps, prefer these directions:

1. operational reliability over new AI features
2. scheduled refresh / alerting over more analysis complexity
3. small UX improvements over architectural expansion
4. reuse of the existing backend logic over redesign

Avoid jumping into:
- multi-agent orchestration
- heavy frontend frameworks
- advanced infra
- major refactors
unless explicitly requested.

## Working Rules

### Preserve backend-first architecture

- FastAPI backend remains the core product artifact
- Streamlit is only a thin demo shell
- frontend should never own business logic
- all domain logic belongs in backend/core modules

### Treat current implementation status honestly

Implemented:
- ingest pipeline
- chunking
- embedding/indexing
- retrieval
- generation
- run tracking
- Docker / Render deployment
- SQLite persistence (entities, sync jobs, snapshots, source connections)
- source connection CRUD, validation, lifecycle management
- CSV upload as first-class source flow
- JSON import for browser-captured data
- Google Business Profile connector (spike/scaffold)
- SyncService with source-aware refresh, job metadata, skipped/executed tracking
- monitoring-oriented Streamlit operator console
- demo assets (examples/)

Not yet implemented / not finalized:
- team handoff generation
- advanced retrieval strategy (filtered + reranked)
- evaluation runner integration
- scheduled/automatic refresh
- multi-tenant isolation
- authentication / authorization

### Planning preference

If asked to plan next work, prefer:
- smallest practical product pivot
- minimal changes
- reuse of current engine
- clarity of boundaries
- portfolio-friendly operational framing

Do not expand scope unnecessarily.

## Key Conventions

- **Imports are absolute:** always `from src.voc.schemas.canonical import CanonicalReview`, never relative.
- **Language field is load-bearing:** `language` on CanonicalReview/EvidenceUnit/Chunk is `"ko" | "en" | "unknown"` and drives sentence splitting, chunk token targets, and eval rubric selection.
- **Content fingerprint:** `sha256(NFC + lowercase + strip + collapse whitespace)` — language-agnostic, single path.
- **Review ID:** source-stable when `source_id` exists (`sha256(channel::source_id)[:16]`), content-addressed fallback (`sha256(channel::fingerprint)[:16]`).
- **Evidence IDs:** `f"{review_id}_{unit_index:03d}"` — deterministic, stable across re-ingestion if splitter is unchanged.
- **Chunk IDs:** `sha256(sorted(evidence_ids))[:16]`.
- **ChromaDB metadata:** `evidence_ids` stored as comma-joined string (ChromaDB doesn't support list values). `rating_normalized` uses `-1.0` as sentinel for None.

## Stubbed / Not Yet Implemented

- `src/voc/eval/` — all files are skeletons (runner, metrics, judge, failure_analysis). Eval dataset exists as frozen JSON in `eval_data/`.
- `src/voc/retrieval/retriever.py` — `"filtered_reranked"` strategy raises `NotImplementedError`.
- `src/voc/generation/insight_gen.py` — `generate_team_handoff()` raises `NotImplementedError`.
- `src/voc/analysis/report.py` — both functions raise `NotImplementedError`.
- `src/voc/connectors/` — `mock.py`, `csv.py`, `json_import.py` are implemented. `google_business.py` is a spike. Naver is not scaffolded.

## Environment

Requires `OPENAI_API_KEY` in `.env` or environment. Without it, the app crashes at startup (pydantic-settings validation). Health endpoints work only after successful startup.
