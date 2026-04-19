# VOC Review Monitoring Service

Seller / store-owner-facing review monitoring backend with an operator console. Ingests customer reviews from multiple source types, indexes them into a vector store, and generates actionable monitoring reports — what to fix first, recurring issues, and flagged reviews.

Korean-first, English-compatible. Built on FastAPI + ChromaDB + OpenAI.

For architecture decisions, design rationale, and interview talking points, see [`docs/PROJECT.md`](docs/PROJECT.md).

## What This Is

A **monitoring-oriented product**, not a generic chatbot or analytics playground. The system helps a seller or store owner:

- Monitor a specific product, store, or business entity
- Ingest reviews from CSV uploads, JSON imports, or API connectors
- See what new reviews are appearing and what changed
- Identify what issues are increasing and which complaints need action first
- Understand the overall sentiment trend at a glance

## Key Capabilities

**Backend (FastAPI):**
- Entity management — register products/stores/businesses as monitoring targets
- Source connection management — connect, validate, activate/deactivate review sources
- Ingestion pipeline — collect → normalize → dedup → evidence split → chunk → embed → index
- Non-blocking refresh — dispatch via BackgroundTasks, poll via job status
- Source-aware job tracking — per-source collected/indexed/errors/skipped in job metadata
- Monitoring reports — LLM-generated summaries, action items, recurring issues, flagged reviews
- Snapshot history — persistent stats snapshots for trend tracking
- Source validation — structural readiness checks per connector type

**Operator Console (Streamlit):**
- Entity selection with status hints
- Source connection listing, validation, upload (CSV/JSON), activation/deletion
- Pre-refresh readiness summary and execution preview
- Post-refresh source-by-source result breakdown
- Refresh history with job-to-job deltas and repeated failure detection
- Snapshot history with trend deltas
- Operator action recommendations
- Action-oriented monitoring report with top-issue callout

## Source Types

| Source | Type | Status | How It Works |
|---|---|---|---|
| **CSV upload** | File import | Production-ready | Upload CSV via UI or API. Auto-creates source connection. |
| **JSON import** | File import | Production-ready | Upload JSON array of review objects. Recommended for browser-captured data. |
| **Google Business Profile** | API | Spike/scaffold | Manual OAuth token. ~1h expiry. Structural validation only. |
| **Mock** | Dev fixture | Development only | Loads from `fixtures/*.json`. Default fallback. |

CSV and JSON import are the primary real-data paths. GBP is a feasibility spike — it maps the API correctly but requires manual token management.

## Architecture

```
Streamlit (operator console)
    │
    ▼
FastAPI Routes
    │
    ├── Entity CRUD ─────────── EntityRepository (SQLite)
    ├── Source CRUD ──────────── SourceConnectionRepository (SQLite)
    ├── Upload (CSV/JSON) ───── File storage + auto source connection
    ├── Refresh (async) ─────── SyncService
    │       │
    │       ├── Source connections → ConnectorRegistry → Pipeline.ingest()
    │       └── Legacy fallback   → entity.connector  → Pipeline.ingest()
    │
    ├── Jobs / Snapshots ────── SyncJobRepository / SnapshotRepository (SQLite)
    ├── Validation ──────────── source_validation.validate_source()
    └── Monitoring ──────────── MonitoringService → LLM analysis
                                    │
                                    ▼
                        Core Engine (unchanged)
                        Orchestrator → Normalizer → Dedup
                        → Evidence Split → Chunk → Embed → ChromaDB
```

**Layer separation:**
- Routes — thin HTTP, validate input, dispatch
- Services — SyncService (refresh bookkeeping), MonitoringService (LLM analysis)
- Repositories — SQLite persistence (entities, sync_jobs, snapshots, source_connections)
- Core engine — ingestion/retrieval/generation pipeline, intentionally unchanged

## API Overview

### Entities
| Method | Path | Description |
|---|---|---|
| POST | `/v1/entities` | Register a monitoring target |
| GET | `/v1/entities` | List all entities |
| GET | `/v1/entities/{id}` | Get entity details |
| DELETE | `/v1/entities/{id}` | Remove entity |

### Refresh & Jobs
| Method | Path | Description |
|---|---|---|
| POST | `/v1/entities/{id}/refresh` | Trigger non-blocking refresh (202) |
| GET | `/v1/entities/{id}/jobs` | List sync jobs |
| GET | `/v1/entities/{id}/jobs/{job_id}` | Poll job status |

### Source Connections
| Method | Path | Description |
|---|---|---|
| POST | `/v1/entities/{id}/sources` | Add a source connection |
| GET | `/v1/entities/{id}/sources` | List sources |
| PATCH | `/v1/entities/{id}/sources/{conn_id}` | Update source (status, config) |
| DELETE | `/v1/entities/{id}/sources/{conn_id}` | Remove source |
| POST | `/v1/entities/{id}/sources/{conn_id}/validate` | Validate readiness |

### Upload
| Method | Path | Description |
|---|---|---|
| POST | `/v1/entities/{id}/upload` | Upload CSV file |
| POST | `/v1/entities/{id}/upload/json` | Upload JSON file |

### Monitoring
| Method | Path | Description |
|---|---|---|
| GET | `/v1/entities/{id}/monitoring` | Full monitoring dashboard |
| GET | `/v1/entities/{id}/summary` | Quick summary + stats |
| GET | `/v1/entities/{id}/issues` | Priority issues only |
| GET | `/v1/entities/{id}/snapshots` | Snapshot history |

### Core Pipeline (direct access)
| Method | Path | Description |
|---|---|---|
| POST | `/v1/pipeline/run` | Run ingestion for a keyword |
| POST | `/v1/query` | Free-form query with retrieval + generation |
| GET | `/v1/runs/{run_id}` | Look up a stored run result |
| GET | `/health` | Liveness check |

## Quick Start

```bash
# Install
pip install -e ".[dev]"

# Configure
cp .env.example .env   # add OPENAI_API_KEY

# Run backend
python -m src.voc.api

# Run operator console (separate terminal)
streamlit run app_demo.py

# Tests
pytest tests/
ruff check src/ tests/
```

Docker:
```bash
docker build -t voc-api .
docker run --rm -e OPENAI_API_KEY=your-key -p 8000:8000 voc-api
```

## Demo Walkthrough (5 minutes)

**Prerequisites:** Backend running at `localhost:8000`. Streamlit running.

Sample review files are provided in `examples/`:
- `examples/sample_reviews.csv` — 15 Korean reviews in CSV format
- `examples/sample_reviews.json` — 15 Korean reviews in JSON format (with `source_channel: "naver"`)

For a detailed step-by-step guide with exact field values, see [`examples/DEMO.md`](examples/DEMO.md).

### Quick version:

1. **Register entity** — sidebar → "새 모니터링 대상 등록" → name: `에어팟 프로`, keyword: `에어팟 프로`, type: product → "등록"
2. **Upload CSV** — "소스 연결 관리" → CSV → upload `examples/sample_reviews.csv`
3. **Upload JSON** — switch to JSON → upload `examples/sample_reviews.json`
4. **Validate** — click "상태 확인" on each source → both show "수동 소스 — 준비됨"
5. **Refresh** — click "리뷰 새로고침" → 30 reviews collected from 2 sources
6. **Monitor** — click "모니터링 리포트 생성" → see metrics, top issue, action items, flagged reviews
7. **History** — expand refresh/snapshot history to see deltas and trends

## Tech Stack

- **Python 3.11** / FastAPI / Uvicorn
- **Pydantic v2** for all schemas and config
- **SQLite** (stdlib sqlite3) for persistence — entities, jobs, snapshots, source connections
- **ChromaDB** (embedded) for vector indexing and retrieval
- **OpenAI API** — embeddings (`text-embedding-3-small`) + generation (`gpt-4o-mini`)
- **Streamlit** for the operator console (thin client, no business logic)
- **httpx** for async HTTP in connectors

## Limitations & Future Work

**Current limitations:**
- Single-tenant (hardcoded `tenant_id="default"`)
- No authentication or authorization
- No scheduled/automatic refresh — operator must trigger manually
- No persistent vector store — ChromaDB resets on restart
- GBP connector requires manual OAuth token (~1h expiry)
- Free-form query searches all indexed reviews, not scoped to entity
- Monitoring report regenerated from scratch each time (no caching)

**Intentionally deferred:**
- Multi-tenant isolation
- OAuth token refresh / credential management
- Scheduled monitoring with alerts
- Entity-scoped retrieval
- Advanced retrieval strategies (filtered + reranked)
- Evaluation framework runner
- Production connectors for Korean ecommerce platforms (Naver, Coupang — no public review APIs)
- Persistent ChromaDB storage

**Stubbed / skeleton code:**
- `src/voc/eval/` — eval runner, metrics, judge, failure analysis (frozen eval dataset exists)
- `src/voc/analysis/report.py` — raises NotImplementedError
- `src/voc/generation/insight_gen.py` — `generate_team_handoff()` not implemented
- `src/voc/retrieval/retriever.py` — `"filtered_reranked"` strategy not implemented
