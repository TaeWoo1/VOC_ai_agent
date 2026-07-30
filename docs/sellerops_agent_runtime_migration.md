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

## 9. Third subgraph — issue memory (read-only operations brief, no checkpoint)

The third journey answers "what operations issues should I look at first, and why" — e.g.
*최근 악화된 상품 문제 알려줘*, *반복되는 고객 불만 보여줘*, *지금 먼저 확인할 운영 이슈는 뭐야*. It
coexists with the inquiry and review subgraphs through the same goal router.

```
issue request → goal router → search active issues → prioritize (deterministic)
             → assemble per-issue context/evidence/trend → compose structured brief → DONE
```

Unlike the first two, this subgraph **only reads and derives**: it never changes an issue's
state, starts an action, or writes feedback. So there is **no human checkpoint, no interrupt,
no resume, and no backend mutation** — it runs straight to a DONE brief.

### Coexistence — one more intent, one more domain
`parseGoal` gains `HANDLE_OPERATIONS_ISSUES` (keywords 운영 이슈/이슈/악화/반복/불만/상품 문제/먼저
확인/…, listed so they never shadow — or get shadowed by — the review/inquiry rows), `routeIntent`
gains the `ISSUE` domain, and `AgentRouter` holds a third `IssueAgentRuntime`. `router.start`
dispatches an issue goal to `issue.run` (which finishes at DONE, since nothing pauses);
`router.resume` on an issue thread is a caller error, not a silent no-op — there is no checkpoint
to resume.

### Reuse, not re-implementation
The backend owns all extraction, the severity/trend/concentration judgements, and the lifecycle;
the subgraph must never re-derive any of them. The four required tools
(`search_review_issues`, `get_review_issue_detail`, `get_review_issue_evidence_summary`,
`get_review_issue_trend`) are thin adapters onto `/api/review-issues` reads. The existing list
endpoint already served the working set; three **new read-only** endpoints were added only because
the shapes an agent needs did not exist quote-free:
`GET /{id}/context` (identity + note-free lifecycle history), `GET /{id}/evidence-summary`
(a sanitized roll-up: total, per-product split, rating distribution, span — no evidence rows),
and `GET /{id}/trend` (the current severity/change/concentration signal). All three delegate to
`ReviewIssueQueryService`; no migration, no mutation. Prioritization is a deterministic total
order over already-computed signals (severity → fired-vs-quiet → high-surge → surge count →
recency → volume → id), mirroring the backend's own worst-first list — not a re-judgement.

### Privacy — quote-free by construction
No review/inquiry body ever crosses the boundary. Issue `title`/`aspect`/`problem` are
closed-vocabulary labels (never a body); the drill-downs the subgraph calls carry no masked quote
and no operator note (the human `detail`/`IssueStateEventView` surface keeps those; the agent
surface — `context`/`IssueTransitionView` and `evidence-summary` — does not). As defence in depth
the search node projects each row to the typed fields, so even an unexpected backend field cannot
ride into the graph state. The composed brief holds only the allowlisted fields: issue id, product
id, category (vocabulary), severity, counts, trend, and the sanitized evidence summary. There is
no interrupt payload; the durable `IssueRunStore` persists the brief itself, which is already
sanitized.

### Determinism & restart (no checkpoint needed)
For a fixed (backend state, `referenceDate`) the search order, prioritization, and every read are
deterministic, so the brief is reproducible. `referenceDate` is the backend's own reproducibility
anchor; pinning it makes the result clock-independent. "Same request → same brief after a restart"
is therefore not a resume: a fresh process re-runs and produces a byte-identical brief, checked
against the one the durable store holds.

### Live proof (real Spring backend + disposable Postgres, torn down)
Booted the real backend on a disposable `issue_subgraph_proof` DB (baseline seed; `sellerops`
untouched). Seeded 12 reviews via SQL and built the issue memory through the human endpoints
(`/extract` + `/lifecycle-pass` @2026-07-25) → four issues spanning severities and trends
(포장 파손 HIGH, 배송 파손 HIGH, 배송 지연 NORMAL NEW+CONCENTRATED, 설치 난이도 LOW NEW). Driving the
real `HttpSpringClient`: the run finished DONE with trail `searched→prioritized→assembled→composed`
(no checkpoint); the brief ordered the two quiet HIGH issues **above** the surging NORMAL/LOW
(severity beats trend); the restart `verify` produced a byte-identical brief; the issue-list
fingerprint was **identical before and after** (zero mutation); and the brief carried only
ids/labels/severity/counts/trend/rating-distribution — no review text (the gated integration test
asserts all of this, plus three-intent routing to three distinct domains). Backend stopped, DB
dropped, run store cleaned. This is Agent-Runtime↔Spring issue-memory integration evidence, not
channel-acquisition evidence — no channel/marketplace API is contacted on this path.

### Independent review response
An independent adversarial architecture + security review found **no HIGH and no MEDIUM** and did
not block the PR; every hard boundary held under scrutiny (read-only, zero subgraph mutation, no
re-implementation, quote-free/note-free at the source, deterministic + restart-stable, three
distinct domains, org-scoped absence). Folded in from the LOW/advisory notes: the `assemble` node
now projects the `change` object and each `byProduct`/`ratingDistribution` sub-object field-by-field
(symmetry with the search-node hardening, so a future text field added *inside* those shapes still
cannot ride into the brief); and the `parseGoal` keyword-table comment was updated for the
three-row table. Documented, not changed: the required tool name `get_review_issue_detail` maps to
the quote-free `/context` read (not the human `/{id}` detail surface) — the name is fixed by the
task's tool contract, and the tool doc states the safe mapping; the brief carries product *names*
alongside product ids (seller-catalog data, not customer text/PII, consistent with the human list
surface); and the CLI `extract` subcommand issues the mutating `/extract` + `/lifecycle-pass` seed
calls — that is the proof harness, explicitly separate from the read-only `runtime.run` subgraph
path.

## 10. Product integration — HTTP service + frontend command surface

Slices 1–3 shipped the three subgraphs as a library driven by CLIs and tests. This step makes the
runtime a **central HTTP service the real frontend calls**, so a seller can drive all three
journeys from the product UI — without moving any responsibility across the boundary rule (§2): the
runtime still holds no DB and no channel credential, and the backend stays the system of record.

### The HTTP surface (`agent-runtime/src/http/`)
A dependency-free Node `http` server (no framework — one auditable transport file) over an
`AgentRunService`:

- `POST /api/agent-runs` — start a run. Body: `{ goalText | intent, accountId?, referenceDate?,
  threadId?, size? }`. Routes via the existing `parseGoal`/`routeIntent` and drives the matching
  runtime. `threadId` is minted when absent and returned.
- `POST /api/agent-runs/{threadId}/resume` — resume at a checkpoint. Body: the checkpoint decision
  `{ approved, approvedBy?, editedComments? }`.
- `GET /api/agent-runs/{threadId}` — the sanitized run status (from the durable store).
- `GET /health` — liveness (public). `GET /capabilities` — static service metadata (public): the
  three intents, whether each has a checkpoint / needs an account scope, the run-store mode, and the
  structural `externalSend: "disabled"`.

### Stateless per request, org-safe by construction
Each request builds fresh runtimes bound to (a) an `HttpSpringClient` carrying the operator's
**forwarded** bearer token and (b) the process-shared durable stores. The service never sees, sets,
or can spoof an org — the backend derives it from the JWT (`principal.orgId()`), and a foreign
account scope fails closed there (403/404), surfaced as-is. Because the runtimes are fresh, every
resume takes the durable reconstruction path, which is already idempotent (deterministic commandId +
DONE-snapshot guard): a double resume replays the recorded outcome, and a cross-process restart
resumes correctly. Resume/GET resolve the owning domain by probing the three stores.

### Privacy at the boundary
No response carries raw customer 원문. The inquiry checkpoint exposes only the **templated reply
draft** (`candidate.comments` — a closed-vocabulary template) plus coarse locating metadata, and
deliberately DROPS `candidate.title`, which echoes the customer subject; the review checkpoint
carries no body and no reply text at all (a version + fingerprint + coarse aids — the operator reads
the actual draft on the authorized review screen); the issue brief is quote-free. The durable GET
view never includes draft content (the store never persists it). Errors surface a status + coarse
code only (never a backend body). The metadata-only logger is reused unchanged.

### Fail-closed guards
The execution-capability check runs inside every inquiry/review start & resume (a backend
round-trip); an enabled send path aborts before any mutation (`409 EXECUTION_ENABLED`). An
unrecognized intent (`400`), a review run with no account scope (`400`), and resuming an
issue-memory run (`409 NO_CHECKPOINT`) are all rejected. The server enforces a bearer token on every
`/api/*` route and answers browser CORS preflight for the configured frontend origin only.

### Production readiness
A dedicated CI workflow (`agent-runtime-ci.yml`, path-filtered) runs install + typecheck + the
hermetic suite; `RUN_REAL_INTEGRATION` is pinned blank so no live-backend run can arm in CI. A
`Dockerfile` + `.env.example` document the env knobs and healthcheck. The run-store provider cleanly
separates local/proof stores (file, memory) from a future production store, and **fails closed at
boot** if `APP_ENV=production` is set on a single-instance store — a multi-instance durable store is
explicitly future work, not a silent single-instance deployment.

### Frontend command surface (`frontend/src/pages/Agent.tsx`, route `/agent`)
A 운영 에이전트 page: a plain-language command input, the run phase/tool trail, checkpoint
approve/reject controls for inquiry (edit the templated reply) and review (approve the saved
version), and the issue operations brief. It calls the Agent Runtime through a separate-origin
client (`src/lib/agentRuntime/`, reading `VITE_AGENT_RUNTIME_URL`, reusing the same operator JWT via
`getToken()`) — never the shared axios backend instance, and never re-implementing a domain
endpoint. Raw customer 원문 is shown only on the existing authorized detail screens (문의 응답 /
리뷰 운영 / 상품 이슈), which the page links to.

### Live proof (real Spring backend + disposable Postgres, torn down)
Booted the real backend on a disposable `agent_http_proof` DB (org/user/channels seeded; demo
content off; `sellerops` untouched) and the Agent Runtime HTTP service against it, then drove the
frontend→runtime→Spring path (minus the browser) over real HTTP with a real operator JWT. Seed: the
mock connector synced 23 OPEN inquiry work items; 8 reviews inserted via SQL built three issues
through `/extract` + `/lifecycle-pass` (포장 파손 HIGH, 배송 파손 HIGH, 배송 지연 NORMAL); two reviews
triaged 대응 필요. A 30-check curl script + the gated vitest integration suite (5/5) proved, all
green:
- **backend send path fail-closed** throughout (`executionEnabled=false`, no reply adapters);
- **ISSUE** — start ran read-only to a DONE brief (3 issues, quote-free — no customer text); resume
  was rejected `409 NO_CHECKPOINT`; the issue-list fingerprint was **identical before and after**
  (zero mutation);
- **INQUIRY** — start parked at a checkpoint carrying only the templated reply (no customer subject/
  body); approve → DONE APPROVED with `externalSendAttempted=false`; a **double resume replayed**
  DONE (idempotent); a second thread rejected → DONE REJECTED, no send;
- **REVIEW** — start parked with a version + fingerprint and **no body/reply text**; approve → DONE
  with the guided session prepared and `externalSendAttempted=false`; double resume idempotent;
- **cross-process restart** — a parked inquiry, resumed in a FRESH server process (killed + rebooted
  on the same durable store), reconstructed from the sanitized snapshot and completed APPROVED
  (trail `…drafted → resumed_after_restart → recorded_approved`);
- **tenant isolation** — every start/resume/get resolves the caller's org via the backend `whoami`
  (which also verifies the token) and scopes the store to a one-way org fingerprint; on disk the run
  store nested under `…/<scope-hash>/{inquiry,review,issue}` (verified), so a run is only ever
  visible to the same org, and a client-supplied `threadId` cannot collide across orgs;
- **rejection paths** — bad intent `400`, review-without-account `400 MISSING_ACCOUNT_SCOPE`, no
  bearer `401`, unknown thread `404`;
- **no leak** — the durable snapshots hold only ids/phase/priority/category/trail (a review snapshot
  carries a one-way `bodyFingerprint`, not a body); a precise sweep for the actual review bodies,
  the reply template, and PII tokens across the whole run store and the agent log found **zero**
  hits. Backend + service stopped, disposable DB dropped, `sellerops` verified present and
  untouched. This is Agent-Runtime↔Spring product-integration evidence over real HTTP, not a
  channel-acquisition or a browser-e2e proof. The whole 30-check + 5/5 suite was **re-run after the
  independent-review fixes** on the tenant-scoped build, all green.

### Independent review response
Two independent adversarial reviews ran in parallel — architecture + security over the runtime/HTTP
layer, and frontend + privacy over the Agent page. **Neither found a HIGH.** Both privacy intents
held (no customer 원문 in any response/log/store; inquiry title dropped; review body-free; brief
quote-free), org spoofing was impossible on every mutating path, and the fail-closed guards fired on
both start and resume. Three MEDIUMs were folded in:
- **Cross-tenant read + unauthenticated GET** (security F1): `GET` verified no token and the run
  store was a process-global key space, so a caller with any/forged token could read another org's
  sanitized run/brief by `threadId`. Fixed at the root: every start/resume/get now resolves the org
  via the backend `whoami` (verifying the token → forged tokens 401) and the store is **tenant-scoped
  by a one-way org fingerprint**, so a foreign `threadId` resolves to absent (404).
- **Client-`threadId` collision/shadowing across tenants** (security F2): the per-tenant scope makes
  a shared `threadId` land in different subtrees (no collision), and the `threadId` charset is now
  restricted to `[A-Za-z0-9._-]` so no two ids can alias to one file. A dedicated tenant-isolation
  contract test pins this.
- **Stale inquiry draft across sequential runs** (frontend): the checkpoint card kept its edited
  draft when one AWAITING inquiry run was replaced by another, risking recording run A's text against
  run B. Fixed by keying the run view on `threadId` (remount re-seeds the draft), with a regression
  test.
Also folded from LOW/advisory: `.dockerignore` now lists `.env`; a malformed `%`-escape in a path
returns `400` (not `500`); an advisory comment marks `approvedBy` as non-authoritative (the backend
JWT principal is the record). Documented, not changed: the GET review view returns coarse nulls for
the non-persisted locating aids (a status view, not the live checkpoint); product *names* in the
brief/review view are seller-catalog data, not customer text.
