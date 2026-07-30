# SellerOps Agent Runtime Migration v1

**Status:** slice 1 implemented offline (this branch), not merged, not live.
**Scope of this document:** the target architecture for moving SellerOps' intelligence /
orchestration layer onto LangChain + LangGraph — **whole-service**, not NAVER-only — and
the first vertical slice that proves the pattern.

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

## 6. Out of scope / not done

- **No live external reply, no channel API write, no LLM call.** No push / PR / merge.
- **No backend change.** Slice 1 reuses existing endpoints as-is.
- **Live cross-process integration** (runtime → a running backend over HTTP) is the next
  step; slice 1 proves the graph against a contract-faithful fake, and ships the real
  `HttpSpringClient` adapter unused by the test suite.
- The NAVER review-import LangGraph shadow and its plan are untouched; #369/#371 untouched.
