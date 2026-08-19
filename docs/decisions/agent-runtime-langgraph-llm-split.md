# ADR — the LangGraph runtime and the LLM are two disjoint subsystems

> **Status: OPEN — recorded, not decided.** Raised 2026-08-19 by the repository simplification audit
> (`main` `4b84bf2e`). **No migration in either direction is planned, in progress, or authorized by this
> document.** It exists so the question stops being re-discovered from scratch, and so no refactor
> quietly resolves it as a side effect.
>
> This ADR owns **one question**. Capability truth stays `docs/multi-channel-connector-roadmap.md` §4.1;
> the AI triage pilot's canonical home stays `docs/workstreams/review_ai_triage_demo.md`; the migration
> narrative stays `docs/sellerops_agent_runtime_migration.md`.

## Context — what is actually in the repo

Re-derived from code at `4b84bf2e`, not from documents.

### A LangGraph service that ships, and contains no model

`agent-runtime/` is a real deployable, not an experiment:

- `@langchain/core ^1.1.48` + `@langchain/langgraph ^1.4.8` (`agent-runtime/package.json:18-19`).
- **Four compiled `StateGraph`s** — `graph/inquiryGraph.ts:185-198` (`search, prioritize, loadDetail,
  generateDraft, humanCheckpoint, record`), `graph/inquiryDraftGraph.ts:119-125`,
  `graph/issueGraph.ts:201-210`, `graph/reviewGraph.ts`. Real `Annotation.Root` state channels
  (`src/state/*`), real `.compile()`.
- **Real human-in-the-loop** — `interrupt(...)` at `inquiryGraph.ts:154` and `reviewGraph.ts:208`;
  `new Command({ resume })` at `runtime.ts:15,112` and `reviewRuntime.ts:19,128`.
- Deployed: `agent-runtime/Dockerfile`; `docker-compose.yml:52-70` runs it as service `agent-runtime`
  (`APP_ENV=production`, port 8787, gated on backend health, `frontend depends_on` it).
- Guarded: `.github/workflows/agent-runtime-ci.yml` is a named branch-protection status check.
- Reached: route `/agent` is registered unconditionally (`frontend/src/App.tsx:151`) and linked from
  `frontend/src/components/home/TodayInbox.tsx:27`; client `lib/agentRuntime/agentClient.ts:20`.
- Durable: run state is backend-owned (`V33__agent_run_store.sql`, `agentrun/AgentRunStoreController`).

And yet **there is no model call anywhere inside it**:

- `goal/parseGoal.ts:1-8` — *"Goal parsing — deterministic, no LLM… A real LLM planner can replace this
  later behind the same `parseGoal` seam."* Intents are a keyword table.
- `provider/DraftModelSeam.ts:1-13` — *"there is **no live LLM call**: the only implementation is
  deterministic and local"*; the drafts are a Korean template table at `:56-87`.
- `graph/reviewGraph.ts:15` — *"The draft body comes from the backend's own rule-based suggestion
  (no LLM)."*
- The LangChain tools are real `StructuredTool`s with zod schemas (`tools/inquiryTools.ts:10-11` etc.),
  but **nothing binds them to a model**: `bindTools`, `withStructuredOutput`, `ChatOpenAI`,
  `ChatAnthropic`, `createReactAgent`, `MessagesAnnotation` → **zero occurrences repo-wide**.
- Checkpointing is `MemorySaver` only (`checkpoint/CheckpointContract.ts:13,71`). There is no
  `PostgresSaver` / `SqliteSaver`; cross-restart durability is a deliberately separate, hand-written,
  PII-stripped store (`checkpoint/RunStore.ts:1-15`).

### A model that ships, and touches no graph

The repository's **only** LLM egress is in Spring:
`backend/.../review/triage/llm/ApiTriageClassifier.java:32-33` posts to `api.anthropic.com/v1/messages`
or `api.openai.com/v1/chat/completions` over the plain JDK client `JdkLlmHttpClient.java:22-48` — no
SDK, no Spring AI, no `langchain4j` (zero occurrences). Prompt in `TriagePrompt.java`
(`PROMPT_VERSION = "triage-prompt/v4"`); the payload is **rating + body only**, asserted against the
serialized request by `TriagePayloadFloorTest.java:51-73`; `ClassifierBoundaryTest.java:142-166` fails
the build if anything but `ReviewTriageChannelGate` constructs the classifier. Off by default behind
four gates.

### And one shadow

`collector/src/action-window/initial-import/journey-shadow.ts:30` is a single-node `StateGraph` that
runs the pure kernel `contracts/review-import-journey/v1/journey.ts` beside the real deterministic
engine, to prove it tracks reality. **No `collector/src` file imports it** — only three tests do. It
fails closed if LangSmith tracing env is set (`:109-118,148`).

## The question

The repository has **a graph runtime with no model, and a model with no graph.** LangGraph is production
infrastructure for a deterministic, human-checkpointed workflow engine; LangChain is present only for
its tool wrapper's shape. Both halves work. Neither is wrong. But the seams each was built for
(`parseGoal`, `DraftModelSeam`) are still empty, and the intelligence that did arrive arrived somewhere
else entirely.

So the answer to "how far did the LangChain/LangGraph migration get?" is **partially adopted** — not
"experiment only", because it ships and is guarded by CI; and not "production AI runtime", because it
has no model.

## Options — recorded, none selected

1. **Leave it.** Two subsystems, two jobs, no coupling. Cheapest; the honest cost is that
   `parseGoal`/`DraftModelSeam` read as scaffolding for a thing that may never come.
2. **Fill the seams.** Put a model behind `parseGoal` and `DraftModelSeam` inside the graphs. This is
   what the seams were designed for — and it moves LLM output into a human-checkpointed flow that
   already has `interrupt`/resume. It also newly puts seller inquiry/review content in front of a
   vendor, which is a data-minimization decision, not a wiring one (compare the triage pilot's
   rating + body floor).
3. **Retire the graphs.** Drop `agent-runtime/` and keep the deterministic reducers. Would remove
   ~10.4k LOC and a compose service — but it deletes four live graphs, a shipped `/agent` route, HITL
   resume, and `V33`. Under the repository's standing principles this is a capability deletion.
4. **Move the triage classifier behind a graph.** Keep one orchestration story. But the classifier's
   value is precisely its narrowness (four gates, a payload floor asserted on bytes, a structural
   boundary test), and a graph would have to preserve all of it.

## Decision

**None.** Deliberately deferred by product-owner instruction during the 2026-08-19 simplification
refactor: *report the facts, change nothing.* No PR in that refactor migrates, deletes, or rewires any
of the above.

## Consequences of deferring

- `agent-runtime/` stays deployed, CI-guarded, and reachable — and stays LLM-free.
- Anyone reading "LangGraph orchestration runtime" in `agent-runtime/package.json:4` should read this
  ADR before assuming a model is involved.
- **`agent-runtime/` was missing from `CLAUDE.md` §"Active source ownership"** despite being a compose
  service with its own status check and a live route. Added 2026-08-19; that omission is part of why the
  split went unexamined for so long.
