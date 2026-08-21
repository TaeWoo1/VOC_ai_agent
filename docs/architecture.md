# SellerOps architecture — the map

> **What this is.** The one page that answers "what are the moving parts, and which document owns each
> one." It is a **pointer**: it owns no truth of its own. If it disagrees with anything it links to, the
> linked document wins and this page is stale — fix it, don't cite it.
>
> **Why it exists.** Until 2026-08-19 the repository had no single answer to "what is the architecture."
> The pieces were correctly documented in five places, and `agent-runtime/` — a docker-compose service
> with its own CI status check and a live frontend route — was in none of them, nor in `CLAUDE.md`'s
> source-ownership list.
>
> Product identity/strategy: `docs/sellerops_canonical_reference.md`. Scope: `docs/product-scope-v1.md`.
> IA: `docs/product_assembly_ia_v1.md`. Capability truth:
> `docs/multi-channel-connector-roadmap.md` §4.1. Conflict priority: `CLAUDE.md`.

## The five runtimes

| # | Runtime | What it is | Owns | Canonical document |
|---|---|---|---|---|
| 1 | **`backend/`** | Spring Boot (Java 17, Gradle, Postgres/Flyway, JWT) | The system of record: connectors, ingest, dedupe, work queues, scheduling, auth — **and the only LLM egress in the repository** | `docs/multi-channel-connector-roadmap.md` (connectors) · `docs/self_pilot_runtime_v1.md` (scheduling) · `docs/workstreams/review_ai_triage_demo.md` (AI triage) · `docs/service_readiness_v1.md` |
| 2 | **`frontend/`** | React + Vite operations UI | 홈 · 리뷰 · 문의 · 주문 · 채널 연결 (+ `/settings`, `/agent`, `/memory`, `/reports`) | `docs/product_assembly_ia_v1.md` (IA, screens, visible channels) · `docs/sellerops_frontend_spec.md` (states, language, a11y) |
| 3 | **`collector/`** | TypeScript local agent (Node + Playwright), run on the seller's own machine | Channel acquisition and the **Action Window**: the resident helper, the bridge, and the per-carrier guided walks | `docs/sellerops_local_agent_runtime_adr.md` (boundaries) · `docs/resident_helper_on_demand_carrier_v1.md` (the on-demand carrier seam) |
| 4 | **`agent-runtime/`** | Standalone Node/TypeScript LangGraph orchestration service (port 8787) — **SellerOps의 AI Operator 실행 구조** (2026-08-21) | The `OperatorGraph` (goal → **LLM plan** → plan validation → specialists → evidence judge → answer, bounded) over the four checkpointed `StateGraph`s; tools are thin adapters onto Spring, and the Operator's own catalogue is READ-only. **Agent chat has no deterministic planner** — no plan, no run; a button's `intent` runs without one | **`docs/sellerops_operator_graph_v2.md`** (제품 행동 계약 · Planner · Product Knowledge) · `docs/sellerops_operator_graph_v1.md` (구성·tool·evidence 계약 · 구현 기록) · `docs/sellerops_agent_runtime_migration.md` · `docs/decisions/agent-runtime-langgraph-llm-split.md` |
| 5 | **`contracts/`** | Hand-written ESM TypeScript + JSON fixtures + golden vectors | The shared shapes: Action Window v1/v2, acquisition, session readiness, review-import journey, fingerprints, triage rubrics | the per-family `README.md` / `SPEC.md` / `CONTRACT.md` beside each |

Plus `tools/` — operator harnesses, validation scripts, and calibration instruments — and `docs/`.

## How they connect

```
                    seller's browser
                          │
                    frontend (Vite)
              ┌───────────┼───────────────┬─────────────────┐
              │ REST      │ WebSocket     │ REST            │
              ▼           ▼               ▼                 │
          backend      collector      agent-runtime         │
         (Spring)   (local agent)     (LangGraph)           │
              │           │               │                 │
              │           │  tools call ──┘                 │
              │           │  back into Spring               │
              ▼           ▼                                 │
          Postgres    Chrome (Playwright) ──► marketplace ◄──┘
          + Flyway     one carrier slot        (seller clicks,
                                                never the agent)
```

- **frontend → backend**: `lib/apiClient.ts`, ~90 REST endpoints. `VITE_USE_MOCKS` swaps in `lib/mocks.ts`.
- **frontend → collector**: an authenticated WebSocket (`/bridge/ws`) carrying opaque Action Window
  frames. Origin allow-list + single-use ticket + human-approved pairing, all three, before any frame.
- **frontend → agent-runtime**: REST on a *different* origin (`VITE_AGENT_RUNTIME_URL`, default
  `127.0.0.1:8787`); the CSP must allow it (`docs/service_readiness_v1.md`).
- **agent-runtime → backend**: its LangChain tools are HTTP adapters onto Spring; durable run state is
  backend-owned (`V33__agent_run_store.sql`).
- **collector → backend**: ingest and session/readiness reporting over REST.
- **collector → marketplace**: one screened navigation per carrier. **The seller performs every click,
  type and submit.**

## The two facts most often mis-remembered

1. **`agent-runtime/` holds no credential, and the backend is still the only LLM egress.** This line
   used to read "`agent-runtime/` contains no LLM call", and that stopped being true on 2026-08-20:
   `provider/SpringDraftProvider.ts` produces a real inquiry draft. It does so by calling the BACKEND
   (`POST /api/agent/inquiry-draft`) with the operator's forwarded bearer — the model, the key, the
   prompt, the per-org flag and the payload floor all live in Spring (`agent/llm/**`), and this service
   still holds no vendor key of any kind. That — not "no model is involved" — is the property to check
   when reading it. `docs/decisions/agent-runtime-langgraph-llm-split.md` records the decision;
   `docs/sellerops_operator_graph_v1.md` (and v2) extends the same rule to the Operator planner and evidence
   judge (their own flags, their own prompts, their own payload floors, all in Spring).
2. **A channel in the connector layer is not a channel on screen.** The seller-visible set is exactly
   NAVER / Coupang / Cafe24 (`ProductChannels.java`, `frontend/src/lib/productChannels.ts`). ESM/Gmarket,
   11번가, SSG, 오늘의집 and the FILE_UPLOAD meta-channel stay in the catalog and the connector layer by
   the 2026-08-17 product-owner decision, and are never returned to product surfaces.

## Safety architecture

Not a layer — a set of gates, each in code, each fail-closed. The fences themselves are stated once, in
`CLAUDE.md`; the approval lifecycle is `docs/sellerops_live_approval_contract.md`.

| Gate | Where | What it refuses |
|---|---|---|
| Production fixture gate | every `resolve*Channel` in `collector/src/cli/local-agent.ts` | any `--dev-*` synthetic driver when `NODE_ENV=production` (which the installed launchd plist forces) |
| One-carrier slot | `collector/src/agent/agent-bridge.ts` | more than one Action Window carrier per agent process |
| `--bridge-only` gate | `collector/src/cli/bridge-only-gate.ts` | any flag-selected carrier alongside the resident helper |
| Import mode gate | `collector/src/cli/import-mode-gate.ts` | the live import boot in CI / scheduled / headless contexts |
| Live-walk refusal | `coupangLiveWalkRefusal` in `local-agent.ts` | a CLI-launched WING walk without phase + `apr-…` id + commit + repo identity |
| Live-call interlock | `backend/.../connector/coupang/CoupangLiveCallGuard.java` | an unapproved marketplace WRITE |
| Triage channel gate | `backend/.../review/triage/llm/ReviewTriageChannelGate.java` | any channel outside NAVER/Cafe24/Coupang, before egress |
| Triage payload floor | `TriagePrompt` + `TriagePayloadFloorTest` | anything beyond rating + body leaving for a vendor |
| Classifier boundary | `ClassifierBoundaryTest` | any class but the gate constructing the classifier (build fails) |
| LLM capability doors | `AgentDraftBoundaryTest` | any class but a capability's own service constructing its generator, or anything but a generator calling the transport (three capabilities: draft · plan · judge) |
| Operator WRITE fence | `OperatorToolRegistry` + `operatorToolRegistry.test.ts` | a WRITE-classed tool at registry construction; a tool outside the run's plan; the whole privileged plane (credentials, Action Window, guided-submission mint) from the Operator catalogue |
| Evidence digest floor | `EvidenceDigestFloor` + `AgentOperatorPayloadFloorTest` | any judge request whose evidence digest is not `key=value` metadata — prose is refused before the vendor call, not masked |

## Verification architecture

Four hermetic CI workflows — no database, no Docker, no browser, **no secrets** — so every one runs
identically on a fork PR. Live suites are gated on an env var being exactly `"1"`, and CI pins those
blank rather than merely leaving them unset. Full detail, including what is deliberately *not* covered
(notably: **CI does not validate Flyway migrations**): `docs/ci-coverage.md`.
