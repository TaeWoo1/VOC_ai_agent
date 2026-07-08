# Implementation Plan — Action Window Runtime (R0–R4)

Referenced canonical intent:
[`../slices/action-window-v1.md`](../slices/action-window-v1.md) (AW slices),
[`../product-scope-v1.md`](../product-scope-v1.md) §1.7 (OperationRun domain,
implementation gated). Slices below are the **Runtime execution** projection of
that intent. Synthetic-first throughout; no live channel until R4 and only after
platform-policy clarification + PO approval.

---

## R0 — Contract baseline

**Seller-visible capability:** none yet (foundation).
**Scope:** define the shared Action Window contract — states, commands, events,
View Model, blocker codes, versioning — extending/versioning alongside the
existing Bridge protocol; ship contract fixtures for both sides.
**Reused implementation:** `collector/src/bridge/protocol.ts`,
`frontend/src/lib/bridge/bridgeProtocol.ts`, command-ledger pattern in
`collector/src/work/types.ts`.
**Out of scope:** any engine behavior, any live surface, Projection input path.
**Verification:** shape/enum tests both sides; version-negotiation test;
sanitization test proving no prohibited payload (see
[`contract-boundary.md`](contract-boundary.md) §3).
**Required evidence:** contract file path + version recorded in
[`current-state.md`](current-state.md) and
[`contract-boundary.md`](contract-boundary.md) §1.
**Merge gate:** contract reviewed by FE + Runtime; fixtures green; no prohibited
payload representable.
**Status note:** currently a **blocking dependency** — does not exist yet.

## R1 — Synthetic Action Window engine

**Seller-visible capability:** internal demo of the full observe → user-click →
verify → resume loop on a fixture.
**Scope:** channel-neutral state engine driving `PREPARE_SESSION →
OPEN_TARGET_SURFACE → LOCATE_TARGET → HIGHLIGHT_TARGET → WAIT_FOR_USER_ACTION →
VERIFY_TRANSITION → RUN_DUMMY_DOWNSTREAM → COMPLETE`; fixture Chrome; overlay;
user-click observation; transition verification; fail-closed exits; one dummy
downstream; sanitized events.
**Reused implementation:** `esm-candidate-signature.ts`, `esm-frame-scan.ts`,
`esm-capture-gate.ts`, `esm-sentinel.ts`; reconnect/session precondition seams;
Bridge event emission.
**Out of scope:** live market, real ingestion volume, Projection, backend
persistence, auto-click, scheduling.
**Verification:** unit tests for engine transitions + every fail-closed exit;
synthetic-fixture browser QA; privacy test (no frames/input/secrets logged).
**Required evidence:** passing tests + fixture run notes; acceptance checklist
from `../slices/action-window-v1.md` §14.
**Merge gate:** all ten V1 definition-of-done points (see [`goal.md`](goal.md)
§6) hold against fixtures.

## R2 — Runtime/FE synthetic integration

**Seller-visible capability:** FE renders live Action Window state from the
Runtime over the real Bridge, on synthetic fixtures.
**Scope:** real Bridge adapter wiring; contract conformance to R0; reconnect
handling; command idempotency + stale-revision rejection; synthetic end-to-end.
**Reused implementation:** `collector/src/agent/agent-bridge.ts`, Bridge
protocol, FE `frontend/src/lib/bridge/*` (FE owns its side).
**Out of scope:** live channel, Projection production wiring, persistence.
**Verification:** contract-conformance tests; idempotency/stale-revision tests;
reconnect test; synthetic E2E.
**Required evidence:** E2E run log (sanitized) + conformance test results.
**Merge gate:** FE consumes only sanitized View Models + blocker codes; no
prohibited payload observed on the wire.
**Depends on:** R0 (blocking), R1.

## R3 — Operation Run persistence

**Seller-visible capability:** a run survives reload/interruption and resumes at
the last safe step; run history visible.
**Scope:** wire the currently caller-less `CollectionRunService` to record
ordered steps + human checkpoints; refresh-recovery; interruption/resume; audit
trail. Respect `../product-scope-v1.md` §1.7 — implement the runtime persistence,
not new product semantics.
**Reused implementation:** `collector/src/work/*` (ledger, `AuditEvent`,
`WorkItemPhase`, verification gate), backend `CollectionRunService` / `SyncJob`.
**Out of scope:** live channel, Projection, new backend capability surface.
**Verification:** resume/idempotency/interruption tests; audit-trail assertions.
**Required evidence:** persistence tests + resume demo notes.
**Merge gate:** resume restores only **verified safe** semantic progress; audit
trail complete.
**Depends on:** R1, R2.

## R4 — One supervised real-channel adapter

**Seller-visible capability:** end-to-end pilot — operator performs the real
platform selection/download in the Action Window; Runtime detects completion,
validates, hands off downstream.
**Scope:** one channel adapter; **user-direct** platform selection + download;
read-only download detection (no trigger click); artifact validation; downstream
continuation via existing ingestion.
**Reused implementation:** read-only `export-target-readiness*.ts`,
`sniff`/xlsx validation, `collector/src/upload.ts` → `/api/uploads` →
`IngestionService`.
**Out of scope:** other channels, auto-relogin, scheduling, Projection.
**Verification:** **explicit per-run PO approval + platform-policy clarification
first**; synthetic ladder green before any live step; 0-rows vs failure
distinguished; privacy invariants enforced.
**Required evidence:** approval record + supervised run notes (sanitized).
**Merge gate:** live step approved in the dispatching turn; fail-closed proven;
no prohibited payload.
**Depends on:** R1, R2, R3.

### Channel selection note

Do **not** hard-select a final live channel here. **ESM+ review** is recorded as
the **strongest current technical candidate** (existing profile resolver,
candidate-signature, download-readiness, and upload seams) — **not an
irreversible decision**. The first pilot channel is confirmed by the product
owner, not by this document. See
[`../channel-capability-registration-matrix.md`](../channel-capability-registration-matrix.md).

## Related

- Per-item status → [`checklist.md`](checklist.md)
- Current active slice → [`current-state.md`](current-state.md)
