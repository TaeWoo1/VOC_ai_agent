<<<<<<< HEAD
# VOC_ai_agent
building an ai agent that collects and analyze VOC(voice of customer)
=======
# VOC Intelligence API

FastAPI backend for multi-channel Voice of Customer ingestion, retrieval, and insight generation. Korean-first, English-compatible.

Collects customer feedback from pluggable channel connectors, normalizes into a canonical schema with language-aware deduplication, splits into evidence units, embeds and indexes into a vector store, retrieves relevant evidence for user queries, and generates structured insights grounded in cited evidence.

## Current Scope

This is a **backend-first MVP** — an operational AI workflow service, not a UI demo.

**Implemented:**
- Full ingestion pipeline: collect → normalize → dedup → evidence split → chunk → embed → index
- Evidence retrieval: query embedding → ChromaDB cosine similarity search → ranked results
- LLM-based insight generation: evidence-grounded VOCInsight with themes, pain points, recommendations, and citations
- Language-aware processing (Korean date parsing, Hangul detection, NFC normalization, sentence splitting)
- Content fingerprint deduplication
- Per-run tracking with `run_id`, stage statuses, timing, and error capture
- Pluggable connector architecture (mock connector included)
- Structured JSON logging with per-run `run_id` context
- Docker-ready with Render deployment config

**Not yet implemented:**
- Team handoff message generation
- Advanced retrieval strategies (filtered + reranked)
- Evaluation framework runner (eval dataset and gold references exist as frozen baseline assets)
- Real data connectors (Naver API, CSV loader are interface-only)
- Streamlit or other UI

## Architecture

```
POST /v1/pipeline/run                    POST /v1/query
        │                                       │
   ┌────▼─────┐                           ┌────▼─────┐
   │  Route    │                           │  Route    │
   └────┬──────┘                           └────┬──────┘
        │                                       │
   ┌────▼──────────────────────────────────────▼──────────┐
   │                    Orchestrator                       │
   │  tracks run_id, per-stage timing, errors              │
   └────┬──────────────────────────────────────┬──────────┘
        │                                       │
   ┌────▼─────────────────────┐   ┌────────────▼──────────┐
   │  Ingestion Pipeline      │   │  Query Pipeline        │
   │  collect → normalize     │   │  embed query           │
   │  → dedup → split         │   │  → retrieve top-K      │
   │  → chunk → embed → index │   │  → generate VOCInsight │
   └──────────────────────────┘   └────────────┬──────────┘
                                                │
                                           ┌────▼─────┐
                                           │ RunStore  │
                                           └───────────┘
                                    GET /v1/runs/{run_id}
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/health/ready` | Readiness check |
| POST | `/v1/pipeline/run` | Run ingestion pipeline for a keyword |
| POST | `/v1/query` | Query for VOC insights with retrieval + generation |
| GET | `/v1/runs/{run_id}` | Retrieve a stored run result (ingest or query) |

## Examples

### Ingest

```bash
curl -X POST http://localhost:8000/v1/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{"keyword": "에어팟 프로"}'
```

```json
{
  "run_id": "pipe_20260408_063947_8c097a",
  "overall_status": "completed",
  "stages": [
    {"name": "collected", "status": "ok", "count": 23, "duration_ms": 0.96},
    {"name": "normalized", "status": "ok", "count": 23, "duration_ms": 0.38},
    {"name": "deduplicated", "status": "ok", "count": 1, "duration_ms": 0.05},
    {"name": "evidence_units", "status": "ok", "count": 42, "duration_ms": 0.2},
    {"name": "chunks", "status": "ok", "count": 22, "duration_ms": 0.17},
    {"name": "indexed", "status": "ok", "count": 22, "duration_ms": 850.0}
  ],
  "counts": {"collected": 23, "normalized": 23, "deduplicated": 1, "evidence_units": 42, "chunks": 22, "indexed": 22}
}
```

### Query

```bash
curl -X POST http://localhost:8000/v1/query \
  -H "Content-Type: application/json" \
  -d '{"question": "배터리 관련 불만사항은?"}'
```

```json
{
  "run_id": "qry_20260408_084500_a1b2c3",
  "status": "completed",
  "question": "배터리 관련 불만사항은?",
  "insight": {
    "query": "배터리 관련 불만사항은?",
    "query_language": "ko",
    "response_language": "ko",
    "summary": "배터리 소모에 대한 불만이 다수 확인됩니다...",
    "themes": [{"label": "배터리 소모", "sentiment": "negative", "evidence_ids": ["..."]}],
    "pain_points": [{"description": "...", "severity": "critical", "evidence_ids": ["..."]}],
    "recommendations": [{"action": "...", "rationale": "...", "evidence_ids": ["..."]}],
    "evidence_used": ["..."],
    "evidence_available": 10,
    "caveats": []
  },
  "retrieved_evidence": [
    {"chunk_id": "...", "text": "...", "evidence_ids": ["..."], "score": 0.87, "rank": 1}
  ],
  "retrieval_meta": {"chunks_retrieved": 10, "top_score": 0.87, "generation_ms": 2100.0}
}
```

### Look Up a Run

```bash
curl http://localhost:8000/v1/runs/pipe_20260408_063947_8c097a
```

Returns the full stored result for any ingest or query run.

## Local Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env  # add your OPENAI_API_KEY

# Run
python -m src.voc.api
```

## Docker

```bash
docker build -t voc-api .
docker run --rm -e OPENAI_API_KEY=your-key -p 8000:8000 voc-api
```

## Deploy to Render

1. Push repo to GitHub
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
3. Connect the repo — Render detects `render.yaml`
4. Set `OPENAI_API_KEY` in the dashboard
5. Click **Apply**

The service binds to Render's `PORT` automatically via `pydantic-settings`.

## Tech Stack

- **Python 3.11** / FastAPI / Uvicorn
- **Pydantic v2** for all schemas and config
- **ChromaDB** (embedded) for vector indexing and retrieval
- **OpenAI API** for embeddings (`text-embedding-3-small`) and generation (`gpt-4o-mini`)
- Structured JSON logging with per-run `run_id` context
>>>>>>> 685d85b (Finalize VOC Intelligence API MVP)
