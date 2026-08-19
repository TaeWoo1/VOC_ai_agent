# ADR — the LangGraph runtime and the LLM are two disjoint subsystems

> **Status: DECIDED (2026-08-20) — Option 2, for ONE seam.** Raised 2026-08-19 by the repository
> simplification audit (`main` `4b84bf2e`) and left open by product-owner instruction; resolved by
> product-owner instruction on 2026-08-20 (Full Product Integration v1): *connect a real LLM at the
> agent workflow's model seam, keep the four StateGraphs / tools / `interrupt` / resume / durable
> RunStore unchanged, and do NOT migrate review triage.*
>
> **What changed:** `DraftModelSeam` is filled — see "Decision" below. **What did not:** `parseGoal`
> is still the deterministic keyword table; `ApiTriageClassifier` still owns review triage and was not
> moved behind a graph; no graph was added, removed, or restructured.
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

And yet — **at `4b84bf2e`, when this was written** — there was no model call anywhere inside it:

- `goal/parseGoal.ts:1-8` — *"Goal parsing — deterministic, no LLM… A real LLM planner can replace this
  later behind the same `parseGoal` seam."* Intents are a keyword table.
- `provider/DraftModelSeam.ts:1-13` — *"there is **no live LLM call**: the only implementation is
  deterministic and local"*; the drafts are a Korean template table at `:56-87`.
  **(Superseded 2026-08-20 — this is the seam that was filled. The template table remains, as the
  fallback every failure path lands on.)**
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

## Decision (2026-08-20)

**Option 2, for the `DraftModelSeam` only — and the model is reached THROUGH the backend, not from the
runtime.**

That last clause is the whole of the design, and it is what makes Option 2 affordable. This ADR's own
statement of the option flagged the cost: *"it newly puts seller inquiry/review content in front of a
vendor, which is a data-minimization decision, not a wiring one (compare the triage pilot's rating +
body floor)."* Answering that in `agent-runtime/` would have meant putting a vendor key in a service
whose `.env.example` opens by saying it holds none, and putting the per-org privacy gate in a stateless
orchestrator that derives org membership from a token it merely forwards.

So the model lives where the other one already does:

- **Backend** — `backend/.../agent/llm/`: its own transport (`AgentLlmTransport` /
  `JdkAgentLlmTransport`), its own prompt (`AgentDraftPrompt`, `PROMPT_VERSION = "agent-draft-prompt/v1"`),
  its own validating parser, its own gate (`AgentDraftService`), its own flag and key
  (`sellerops.agent.draft.*` — off by default, keyed, opt-in per organisation), and its own payload
  floor asserted on the serialized request bytes (`AgentDraftPayloadFloorTest`): exactly the inquiry's
  own `title` and `details` leave, and nothing else. Exposed as `POST /api/agent/inquiry-draft`.
- **Runtime** — `provider/SpringDraftProvider.ts` implements the unchanged `DraftModelProvider`
  interface and calls that endpoint with the operator's forwarded bearer. `DraftModelProvider.draft`
  widened from `DraftCandidate` to `Promise<DraftCandidate>`; nothing else about the seam moved.

**Deliberately separate from the triage pilot**, in flag, key, transport and prompt. They are different
exposures — a review's rating and body vs an inquiry's title and body — and a deployment must be able to
run either without the other. `AgentDraftBoundaryTest` asserts the draft package never reads the triage
flag, transport, or classifier, and `ClassifierBoundaryTest` (unchanged) still asserts the reverse.

**Every failure is the shipped behaviour.** Capability off for the org, no endpoint, transport error,
vendor refusal, off-schema answer, partial body → the deterministic rule drafter, whose provenance the
candidate carries. `/agent` renders the label from that provenance (`draftKindLabel`) rather than
hardcoding one, so a template is never called AI and an AI draft is never called a template.

**One correctness fix the model forced into the open.** `InquiryAgentRuntime.resume()` re-derived the
draft because `RunSnapshot` stores none — free while the only drafter was a template table, and a silent
integrity failure with a model behind the seam: it would record a reply the human never read, under an
approval given to a different one. Resume now always reconstructs with the RULE drafter, and the
frontend sends the text it displayed on every approve, not only on an edit. The RunStore contract is
unchanged, which is why the fix had to go here.

### Still open, and deliberately

- **`parseGoal`** — untouched. Free-text routing is still a keyword table that fails closed on an
  unrecognized request. Filling it is the same shape of decision and has not been made.
- **Review triage** — untouched. Option 4 stays rejected for the reason recorded above: the
  classifier's value is its narrowness, and a graph would have to preserve all of it.
- **`reviewGraph`'s draft body** — still the backend's own rule-based suggestion, not this seam.

## Consequences

- `agent-runtime/` stays deployed, CI-guarded, and reachable — and **still holds no credential of any
  kind.** "The backend is the only LLM egress" (`CLAUDE.md` §"Active source ownership") is unchanged,
  and remains the property to check when reading this service.
- Anyone reading "LangGraph orchestration runtime" in `agent-runtime/package.json:4` should read this
  ADR: a model IS now involved in one node of two graphs, and in none of the others.
- **`agent-runtime/` was missing from `CLAUDE.md` §"Active source ownership"** despite being a compose
  service with its own status check and a live route. Added 2026-08-19; that omission is part of why the
  split went unexamined for so long.
