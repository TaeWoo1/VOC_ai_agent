# SellerOps Agent Runtime Migration v1

**Status:** slices 1–2 (inquiry) merged (PR #376); the review-reply subgraph (§8) is the
second journey, coexisting via a goal router.
**Scope of this document:** the target architecture for moving SellerOps' intelligence /
orchestration layer onto LangChain + LangGraph — **whole-service**, not NAVER-only — the
first vertical slice that proves the pattern, and the second subgraph that reuses it.

This is a router-and-record document. It states the boundary and the slice; per-channel
status stays in the channel workstreams.

---

## 1. Why this exists / prior migration intent

A repo-wide audit (2026-07-30) established the starting point:

- **LangGraph already existed in exactly one place:** the collector (TypeScript/Node),
  `@langchain/langgraph`, as the **observe-only** `journey-shadow.ts` for the NAVER
  review-import journey. It carries **no LLM** and drives nothing — it shadows a
  deterministic kernel to prove it tracks reality before any cutover.
- **The only migration plan on record** —
  `docs/action-window-runtime/review-import-journey-langgraph-migration-plan.md` — is
  explicitly **NAVER-review-import-scoped** and explicitly says "LangChain LLM agent is
  out of scope." It is partial: the pure kernel + observe-only shadow exist; the cutover
  does not.
- **There was no whole-service migration plan**, and **zero live LLM calls** anywhere.
  Every intelligence seam (review reply, inquiry proposal, item analysis, issue
  extraction) ships a **rule-based** implementation with an `ai` adapter *reserved behind
  a flag but unimplemented*.

So "how far was the whole migration reflected?" — **it wasn't.** What existed was a
narrow, LLM-free LangGraph experiment on one NAVER journey and a consistent
"provider-seam-with-reserved-AI-adapter" pattern in the backend. This document defines
the whole-service target for the first time and lands slice 1 against it.

---

## 2. Target architecture

Two processes, one boundary.

### Spring backend — the system of record (unchanged responsibilities)
Keeps everything that must be transactional, durable, and auditable:
- connectors and channel I/O; the database and Flyway schema;
- transactions and the hand-rolled phase state machines (e.g.
  `InquiryWorkItemPhase`: OPEN → PROPOSED → APPROVED/ACTION_PENDING → EXECUTED →
  COMPLETED …);
- **idempotency** (commandId + UNIQUE audit constraints, dispatch-key, natural-key
  dedup);
- **policy + the fail-closed external-write gate** (the only external write — the inquiry
  reply POST — is flag-gated *off* by default, with no channel adapter registered =
  structurally cannot send);
- **audit** (append-only `inquiry_work_item_audit`, `VERIFICATION_RECORDED`, actor tags).

None of this is re-implemented in the runtime. The domain logic is reused as-is, exposed
over the existing REST endpoints.

### Agent runtime — orchestration (new, `agent-runtime/`, Node/TypeScript)
A standalone service (sidecar to the backend; **not** the collector) that owns:
- **goal parsing** — map an operator request to a supported intent (deterministic table
  this slice; an LLM planner drops in behind the same `parseGoal` seam later);
- **context assembly** — pull the queue, prioritize, load detail;
- **tool routing** — call capabilities exposed as LangChain Tools;
- **the human checkpoint** — LangGraph `interrupt`, which pauses the graph until a human
  resumes it with a decision;
- **resume** — continue a paused run via `Command({ resume })`, checkpointed.

Why a separate Node service and not Java: LangChain/LangGraph do not run on the JVM, and
the only existing LangGraph usage is already TypeScript. Why not the collector: the
collector is a per-seller local acquisition agent; central operator orchestration is a
different concern and deployment.

### The boundary rule
The runtime reaches the outside world **only** through `SpringClient` (HTTP → backend
REST). It has no database, no channel API client, and — critically — **no send tool**.
An external reply can be sent only if *two independent gates* pass: (1) the graph's human
checkpoint is resumed with an approval, and (2) the backend's own fail-closed publish
gate is satisfied. This slice deliberately stops at "approval recorded"; nothing is sent.

---

## 3. Slice 1 — handle unanswered inquiries (implemented)

```
operator request
  → parse goal
  → search unanswered inquiries        (Tool → GET /api/inquiries?phase=OPEN; pages through all OPEN)
  → prioritize (oldest-waiting first)  (deterministic, in-runtime; no backend priority exists)
  → load inquiry detail                (Tool → GET /api/inquiries/{id})
  → generate reply draft (rule-based)  (local draft seam — NO backend write yet)
  → HUMAN CHECKPOINT                    (LangGraph interrupt — pause for approve/edit/reject)
  → record approval result             (ONLY on approve, and only now touching the backend:
                                          Tool → POST /proposal → PUT /draft → POST /confirm-publish)
```

- **Nothing is written to the backend before the human checkpoint.** Search/detail are
  reads; the draft is generated locally. The first backend mutation (OPEN → PROPOSED via
  `/proposal`) happens only inside the approve branch — so a **reject leaves the item
  exactly OPEN**, and it resurfaces on the next run (no limbo, no orphaned PROPOSED state,
  no backend write). This is deliberately stronger than "reject doesn't send."
- **Search pages through all OPEN items** before ranking. The backend queue is sorted
  newest-first and paged; ranking a single page would defeat "oldest-first". A safety cap
  (10 pages / 1000 items) is logged loudly rather than silently truncating.
- **Prioritization** is new orchestration logic (the backend has no per-inquiry priority)
  — pure, deterministic, oldest-`receivedAt` first, stable tie-break. Not a domain rule
  rewrite.
- **Draft generation** uses a `DraftModelProvider` seam with a **rule-based** impl and
  **no live LLM** (product decision for this slice). Inquiry title/body is PII; a real
  model egresses nothing until its own gate + privacy review. Mirrors the backend's
  reserved-AI-adapter pattern.
- **Human checkpoint** surfaces the starter draft; the operator may **approve, edit, or
  reject** (the resumed decision is zod-validated, failing closed to reject). On approve,
  the (possibly edited) draft is saved and the approval is recorded through the backend —
  `APPROVAL_GRANTED` audit + `ACTION_PENDING` intent — which, fail closed, **dispatches
  nothing**. A backend reject/withdraw event is a noted follow-up.
- **The no-send guarantee is a backend-configuration property**, not a runtime one:
  `/confirm-publish` is the same endpoint that would dispatch if live execution were
  enabled and a channel adapter registered. The runtime never enables that; a test proves
  the send path is real (it fires when an adapter is present) and that the default fails
  closed. Asserting execution-disabled at the boundary is a **hard gate before live
  cross-process integration** (see §6).
- **Idempotency** rides the backend's contract: the approval `commandId` is deterministic
  (`agent:<threadId>:approve:<workItemId>`), so a replay is a no-op (one bind, one audit)
  and a different command for an already-approved item is a 409.

### Files (`agent-runtime/src/`)
| Concern | File |
|---|---|
| Goal parsing | `goal/parseGoal.ts` |
| Prioritization | `prioritize/prioritizeInquiries.ts` |
| Draft-model seam (no live LLM) | `provider/DraftModelSeam.ts` |
| LangChain Tools (backend adapters) | `tools/inquiryTools.ts` |
| Tool registry | `tools/ToolRegistry.ts` |
| Backend boundary | `spring/SpringClient.ts`, `spring/types.ts` |
| Graph state | `state/AgentState.ts` |
| Checkpoint/resume contract | `checkpoint/CheckpointContract.ts` |
| The graph (vertical slice) | `graph/inquiryGraph.ts` |
| Runner façade | `runtime.ts` |
| Sanitized logger | `log.ts` |

### Sanitization
Seller-owned content (title/body/reply) lives only in memory and in the interrupt payload
a human must read. It never reaches a log line: `log.ts` drops content-ish and
secret-ish keys and collapses non-scalars, and a no-leak sweep proves a full run logs no
title/body/phone/email.

---

## 4. Responsibilities: kept in Spring vs moved to LangChain/LangGraph

| Responsibility | Owner |
|---|---|
| Connectors, DB, transactions | **Spring** (unchanged) |
| Phase state machines, idempotency, audit | **Spring** (unchanged) |
| Policy + fail-closed external-write gate | **Spring** (unchanged) |
| Domain rules (proposal, draft persistence, approval binding) | **Spring** (reused via REST) |
| Goal parsing / intent | **LangGraph runtime** (new) |
| Context assembly + prioritization | **LangGraph runtime** (new) |
| Tool routing | **LangGraph runtime** (LangChain Tools) |
| Human checkpoint + resume | **LangGraph runtime** (interrupt/Command) |
| Draft-model seam | **LangGraph runtime** (rule-based; AI reserved) |

---

## 5. How Review and Issue Memory attach next

The slice-1 shape generalizes without reopening the backend:

1. **New Tools, same adapter pattern.** Wrap the existing endpoints as LangChain Tools:
   - Review reply: `ReviewReplyService.view/saveDraft/decideApproval/startSubmissionRun`
     (`/api/seller-accounts/{id}/attention/items/{ref}/reply`). Note the review reply path
     is *hermetic by design* (clipboard/operator-reported, **no** external adapter), so its
     "record" tool is the approval decision + submission-run mint, never a send.
   - Issue Memory: `ReviewIssueQueryService.list/detail`, `ReviewIssueExtractionService`,
     `ReviewIssueRefreshService.refresh`, `ReviewIssueLifecycleService` transitions.
2. **New graphs, same primitives.** A review-triage-and-reply graph and an
   issue-memory-refresh graph reuse `AgentState` channels, the `ToolRegistry`, the
   checkpoint contract, and the sanitized logger. Human checkpoints gate any approval.
3. **A goal router.** `parseGoal` grows from one intent to several; a top-level router
   dispatches to the right subgraph. Issue Memory's refresh, being read/derive-only, may
   run without a checkpoint; review reply keeps its approval checkpoint.
4. **Draft/summarization seam reused.** When a real model is authorized, it lands behind
   `DraftModelProvider` (and a sibling summarization seam for issues) under its own gate —
   graphs and tools do not change.

Order suggested: Review reply next (closest shape to inquiry, but hermetic — good for
proving the "no external send" boundary again), then Issue Memory (read/derive, exercises
the no-checkpoint path).

---

## 6. Out of scope for slice 1

- **No live external reply, no channel API write, no LLM call.**
- Slice 1 reused existing endpoints as-is (no backend change) and proved the graph against
  a contract-faithful fake; live cross-process integration was slice 2 (below).
- The NAVER review-import LangGraph shadow and its plan are untouched; #369/#371 untouched.

## 7. Slice 2 — real Spring integration proof

Slice 2 connected the runtime to a **real Spring backend + disposable Postgres** and proved
checkpoint / resume / idempotency end-to-end (still no LLM, no external reply, no channel
API — demo/fixture data via the offline MockApiConnector). It added the real
`HttpSpringClient` wiring + `SpringSession.login`, a fail-closed startup guard on both
`start()` and `resume()` (backed by a new read-only `GET /api/inquiry-publish/capability`),
the durable `RunStore` (see below), the shared idempotent `performRecord`, and a CLI for
cross-process start/resume. Live-verified: fail-closed capability, the OPEN pagination /
detail / proposal / draft / approval contract, reject (item stays OPEN), approve (one draft,
`ACTION_PENDING`, no send), double-resume idempotency, and a genuine cross-process
restart-resume — with a DB check showing exactly one APPROVAL_GRANTED / draft / approval per
item and **zero `EXECUTION_RECORDED` across the DB** (nothing dispatched).

### Follow-up gates (NOT done here — required before the next steps)

- **`FileRunStore` is a proof/local durable store only.** It is a JSON-file-per-thread store
  used to demonstrate restart-resume and to keep tests dependency-free. A **production run
  store** (e.g. a transactional Postgres-backed `RunStore` with retention/GC and concurrent
  access) is deliberately deferred; it drops in behind the existing `RunStore` interface with
  no graph/runtime change.
- **When a real LLM drafter is introduced, the restart path must STOP regenerating the
  draft.** Today the durable restart path re-fetches detail and *regenerates* the candidate
  via the deterministic rule-based drafter — safe only because that drafter is deterministic
  (same input → same draft → same fingerprint → idempotent confirm). A non-deterministic LLM
  would produce a different draft on restart, breaking fingerprint idempotency. The gate:
  once an LLM drafter is authorized, resume/reconstruction must **pin to the backend's already
  persisted candidate/draft version** (fetch the saved draft head and reuse its fingerprint)
  and never re-invoke the model. The sanitized `RunStore` may then also need to carry the
  saved draft **version** (still not the content) to bind deterministically.
- Live wiring of the real LLM behind `DraftModelProvider` remains gated (its own privacy
  review); the send path stays fail-closed at the backend until separately authorized.

---

## 8. Second subgraph — review reply (coexists with inquiry via a goal router)

The review-reply subgraph attaches the SAME primitives (LangChain Tools → Spring, human
checkpoint via `interrupt`, sanitized durable store, sanitized logger) to a second journey:

```
review-reply request → search reviews needing reply → prioritize → review/product context
  + rule-based draft (saved) → HUMAN CHECKPOINT → record approved version + action intent
  → prepare guided reply session
```

It reuses the **existing** backend review-reply domain with **zero backend change and no
migration** — the endpoints under
`/api/seller-accounts/{accountId}/attention/items/{actionRef}/reply` (GET prep + rule-based
suggestion, `PUT /draft`, `POST /approval`, `POST /submission-run`), the account-scoped
`GET …/reply-work` worklist, and the same `GET /api/inquiry-publish/capability` fail-closed
read. The backend owns version binding, approval idempotency (`commandId`), the single-use
submission ref, and audit.

### Coexistence — the goal router

`parseGoal` now recognises a second intent, `HANDLE_REVIEW_REPLIES` (keyword table +
explicit intent), and `routeIntent` maps an intent onto a domain (`INQUIRY` | `REVIEW`). A
thin `AgentRouter` holds both runtimes — the **unchanged** `InquiryAgentRuntime` and a new
`ReviewAgentRuntime` — parses a request, and dispatches `start` to the matching one; `resume`
routes by the domain recorded for that thread. The two runtimes are otherwise independent
(separate graphs, tools, checkpoint contracts, durable stores), so neither can perturb the
other. The merged inquiry code and its `FakeSpringClient` are untouched; the review client is
a separate `ReviewSpringClient` interface that `HttpSpringClient` also implements.

### Three boundary properties — and how each is guaranteed

- **No LLM.** The starter draft is the backend's own rule-based `suggestion.body`
  (`providerKind=RULE_BASED`); the runtime adopts it and saves it. No model is reachable.
- **No send — structurally.** The review-reply surface has **no send endpoint at all**, so
  there is nothing to type a send tool against (a stronger guarantee than the inquiry config
  flag). The most powerful step mints a single-use *guided-submission ref* and stops;
  `externalSendAttempted` is a standing `false`. The fail-closed capability check remains as
  defence in depth.
- **No clipboard / Action Window execution.** The run ends at `submission-run` (minting the
  ref + deriving the privacy-safe target hint). It never starts an Action Window run and never
  records an outcome — those are separate, human-performed steps outside this subgraph.

### Two deliberate departures from the inquiry slice

1. **The draft is saved BEFORE the checkpoint.** The task fixes the checkpoint to carry only
   *review ID, draft version ID, fingerprint, phase* and requires restart to resume with the
   *same draft version*. Both are satisfied cleanly by persisting the draft first (a real
   server version + fingerprint), which also matches the flow's own ordering (draft provider
   precedes the checkpoint; "record approved version" follows).

   **What "reject 무변경" means here, precisely.** On reject the run records **no approval, no
   action intent, no submission-run (guided session), no outcome, and no external send** — it
   makes zero backend writes on the reject branch. The one thing that already exists is the
   **unapproved draft version created before the checkpoint**, which is deliberately left in
   place: it is what lets a killed-then-restarted run resume against the *same* draft version
   (restart stability), and it is a non-committal artifact — no approval binds it, nothing
   dispatches it, and the review stays exactly as approvable as before. So "무변경" is about the
   commitment (approval → guided session → outcome → send), all of which reject leaves untouched;
   it is explicitly **not** a claim that no draft row exists.
2. **The checkpoint carries NO review content.** Unlike the inquiry checkpoint (which held the
   candidate text in the in-memory MemorySaver state), the review graph state holds only
   sanitized metadata + the saved version/fingerprint. The redacted body and the suggestion
   body live only transiently inside `prepareDraft`; the operator reads the actual text via
   `GET …/reply` out-of-band. The durable snapshot holds only
   `{reviewRef, draftVersion, draftFingerprint, phase, sellerAccountId, priorityBucket, trail,
   outcome}` — no body, no reply text, no PII; `submissionRef` (opaque 16-hex, not reversible)
   and every fingerprint are one-way.

### Idempotency & restart

The approval carries a deterministic `commandId`, so a re-run replays it (no second bind, no
duplicate audit). The guided-session **mint is not idempotent at the backend** (each call
mints a fresh single-use ref); mint-once across double/restart resume is guaranteed one level
up by the **DONE-snapshot guard** — a finished run replays its stored outcome and never
re-enters the record step (and, defensively, the in-process resume fast-path also consults the
durable DONE status so two runtimes sharing one store cannot double-mint). Because the draft is
already persisted, restart-resume simply approves the stored version and mints — no re-fetch,
no regeneration — so it binds the same draft version by construction (and does not inherit the
inquiry slice's LLM-resume regeneration gate).

### Live proof (real Spring backend + disposable Postgres, torn down)

**Scope of this proof.** It is evidence of the **Agent Runtime ↔ Spring review-domain
integration** — that the subgraph drives the real review-reply endpoints (prep/draft/approval/
submission-run) correctly, idempotently, and fail-closed. It is **not** evidence of channel
acquisition: no marketplace was contacted, no channel API was called, and the review rows are
local fixtures, not collected data. Channel acquisition remains proven separately in its own
workstreams.

Proven end-to-end against a real backend on a disposable `review_subgraph_proof` DB (the
`sellerops` dev DB untouched; env torn down after). Because the mock connector does not serve
REVIEW sync (and the demo-content review seeder is unrelatedly broken on a NOT-NULL
`dedup_key_version`), the review rows were inserted directly into the disposable DB as **SQL
fixtures** and then triaged RESPONSE_NEEDED through the real endpoint — a deliberate fixture
seed, chosen so the proof exercises the integration boundary rather than any acquisition path.
Verified: fail-closed capability; the draft saved once BEFORE the
checkpoint (real backend rule provider, `providerVersion=templates-v1`); approve binds the
version + prepares a guided session (opaque 16-hex `submissionRef` + privacy-safe target hint);
reject leaves an inert draft with no approval and RESPONSE_NEEDED retained; double-resume
idempotent (one ref); in-process AND a **genuine 2-process CLI** restart both bind the SAME
draft version. DB check: exactly one approval + one submission_ref per approved review, and
**zero `review_reply_outcome` rows across the DB** (nothing executed/dispatched); the durable
snapshot carried no review body or PII. The search-node projection (below) was exercised
against the real reply-work rows, which do carry a `safePreview` excerpt.

### Independent review response

An independent adversarial review found no HIGH and did not block the PR. Fixed in-branch:
(MEDIUM-1) the search node now projects reply-work rows to only the fields the runtime needs,
so the backend's `safePreview` review excerpt never enters the (in-memory) graph checkpoint —
the fake now carries `safePreview` so the projection is exercised; (MEDIUM-2) the resume
fast-path consults the durable DONE status as above; (LOW-2) the router's resume decision type
is the inquiry superset. Documented, not changed (LOW-1): the agent selects the oldest
committed review, and a review already approved by a prior run would fail closed at the
backend's freeze guard on a re-approve (no double-approval, no send) rather than being skipped;
graceful skip-if-already-approved is a future refinement.
