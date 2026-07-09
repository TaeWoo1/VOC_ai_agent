# Current State — Action Window Runtime

<!-- Update this file when starting or changing the active slice. Fixed top section below. -->

- **updated at:** 2026-07-09
- **baseline main SHA:** `115582a` (`origin/main`; incl. PR #212 R0, PR #214 canonical contract, PR #213 R1, PR #215 FE mock-flow, PR #216 R1.1, PR #217 R2A, and **PR #218 R2B** all merged)
- **current branch:** `feat/operation-run-persistence` (R3 — Operation Run persistence)
- **current worktree:** `sellerops-runtime` (linked worktree of the shared SellerOps repo)
- **branch base SHA:** `115582a` (`origin/main`)
- **shared contract version/path:** **`contracts/action-window/v1/` (`ACTION_WINDOW_PROTOCOL_VERSION = 1`, `ACTION_WINDOW_TRANSPORT_VERSION = 1`) — UNCHANGED by R3.** Persistence is a Runtime-internal record (`OPERATION_RUN_SCHEMA_VERSION = 1`, `collector/src/action-window/operation-run.ts`) that stores contract-valid events/views verbatim; nothing new crosses the FE↔Runtime boundary.
- **current slice:** **R3 (Operation Run persistence) — IMPLEMENTED + offline-VERIFIED** on this branch: every published (verified) transition persists an `OperationRun` (ordered `OperationTask`s, `HumanCheckpoint`, `ResumeState`, revision, command ledger, gapless ordered audit events, latest View Model, full engine restore state) to the agent-owned gitignored `.operation-runs/` store; a restarted agent restores the latest safe state and resumes through the PAUSED barrier on an explicit `RESUME_RUN`.
- **last completed item:** engine gained a full-fidelity `runState()` + `ActionWindowEngine.restore()` + the `pauseForRestore(safeStage)` barrier (refuses terminal stages); `operation-run.ts` (pure domain: record projection, resume classification, restore planning, strict allow-list parse incl. gapless-audit + prohibited-content checks); `run-store.ts` (atomic tmp+rename writes, 0700/0600 perms, sanitized error categories, prohibited-content gate on SAVE and load, safe runId filenames); `run-lifecycle.ts` (create/resume/open-or-resume composition; resumable runs parked PAUSED and the barrier itself persisted; terminal runs restore read-only and are never resumed on boot); `ActionWindowSession` gained the optional `onStatePublished` persistence hook and now continues (not restarts) over a restored engine; `agent-bridge`/`local-agent` host the synthetic run with `persistDir` so a restarted dev agent resumes its interrupted run (announced under its original runId).
- **last verified tests:** collector `operation-run-persistence.test.ts` (9) — create/load, restart→checkpoint restore→full completion, duplicate-commandId no-op ACROSS restart, stale-revision after restore, idempotent downstream resume (+ second resume rejected), failed-run resume (persistent cause fails closed again; fixed cause completes), terminal-state protection (completed/cancelled never restart; restore read-only; barrier refuses terminal), gapless audit ordering across restart (barrier event recorded), privacy boundary; `run-store.test.ts` (10) — round-trip, corrupt/tampered/schema/gap rejection, prohibited-content refusal on save AND load, unsafe runId rejection, idempotent delete. Full collector suite **2443 passed / 12 skipped**, `tsc --noEmit` clean. Backend untouched and re-verified offline: `./gradlew compileJava` + `./gradlew test` → **984 tests, 0 failed** (H2 in-memory).
- **current blocker:** none for R3 offline scope. **Reported doc-staleness conflict (not silently resolved):** the R3 plan's "wire the currently caller-less backend `CollectionRunService`" premise is stale — it is already wired for the upload path (`FileUploadConnector` → `/api/uploads`) and models only a flat `sync_jobs` row (no step/checkpoint/audit tables). Since the plan simultaneously rules "new backend capability surface" out of scope and local-agent runs must survive restarts offline, R3 persists agent-locally; mirroring Operation Runs into the backend is a **product-owner decision**, not assumed here (see D-018).
- **next single action:** after this R3 PR merges, prepare **R4** (one supervised real-channel adapter) — which starts with platform-policy clarification + PO channel confirmation, not code.
- **parked work:** ESM marketplace-attribution experiment in `sellerops-esm-live` (`5a43dcb` + 8 uncommitted files) — frozen; do not clean, commit, merge, or continue
- **forbidden work:** editing canonical product docs from this branch; touching the FE worktree; touching/cleaning `sellerops-esm-live`; launching Chrome / live commerce action; automatic marketplace selection or export click as default; wiring Projection as a V1 dependency

## Truth snapshot

- The **Action Window target architecture is accepted** (see canonical
  `../product-scope-v1.md` §1.5, `../slices/action-window-v1.md`).
- The **Action Window Runtime is not implemented yet.** Nothing here is
  live-verified.
- Existing **reconnect / profile / Bridge / candidate-signature / download**
  primitives may be **reused**, but their existence is not Action Window
  capability (see [`checklist.md`](checklist.md)).
- **Browser Projection is retained** infrastructure (State B: committed at
  `a0e4f6f`, not wired into the `local-agent` boot — confirmed: no projection
  wiring in `collector/src/cli/local-agent.ts`) and is **not a V1 dependency**.
- The **ESM auto-click marketplace-attribution work is parked**, not completed.
- **No live Action Window capture is complete.**
- **R0 (contract) is MERGED** (PR #212). **R1 (synthetic loop) is VERIFIED against
  the canonical post-#214 contract** under `collector/src/action-window/*` —
  automated tests green AND the headed operator-click QA passed end-to-end using
  `channelCode`/`copyKey` and the canonical execution modes.
- **R2A (offline FE↔Runtime integration) is VERIFIED** (`integ/action-window-v1`,
  PR #217): the FE Bridge adapter drives the real R1 engine through the
  `ActionWindowSession` over a loopback transport — full command/event/View-Model
  loop, reconnect resync, idempotency/revision/ordering, and a privacy scan, all
  green offline AND against real Chromium with a **headed operator (real human)
  click**.
- **R2B (live Bridge-WS passthrough) is IMPLEMENTED + offline-VERIFIED** on
  `feat/action-window-bridge-transport`: the same session runs behind the REAL
  Bridge WebSocket — real pairing (request→local confirm→poll), single-use
  ticket, origin allow-list — with Action Window frames as opaque `{type:"aw"}`
  carriers and an `aw_session` run announcement. Verified over a real loopback
  WS with the synthetic driver (10 tests). Still **no live channel**, and
  production hosts no Action Window session.
- **R3 (Operation Run persistence) is IMPLEMENTED + offline-VERIFIED** on
  `feat/operation-run-persistence`: runs persist after every verified transition
  (record incl. ordered tasks, human checkpoint, resume state, command ledger,
  gapless audit event log, latest View Model, full restore state) and survive a
  process restart — restored runs park at the PAUSED barrier until an explicit
  `RESUME_RUN`; completed/cancelled runs are terminal-protected; failed runs
  resume through the same fail-closed probes. Agent-local file store only —
  **no backend Operation Run tables/endpoints** (reported as a PO decision, see
  D-018). Still **no live channel**.

## Existing foundations vs implemented Action Window capability

**Existing foundations (reusable, not delivered Action Window):** connection
profile resolver, candidate signature / frame scan, fail-closed gate / sentinel,
read-only download readiness, upload/ingestion handoff, work/run/audit domain,
Bridge protocol, Browser Projection (optional renderer).

**Implemented Action Window capability:** R1 channel-neutral synthetic loop
(`collector/src/action-window/*`) — pure state engine, target locator, overlay,
user-action observer, transition verifier, fail-closed blockers, dummy downstream,
in-memory event sink, `ActionWindowRunView` projection, cleanup — plus the R2A
command-driven `ActionWindowSession`/FE adapter integration and the R2B Bridge-WS
passthrough (opaque `{type:"aw"}` carriers over the paired/ticketed `/bridge/ws`,
`aw_session` announcement, reconnect resync). Synthetic-only; automated + headed
operator-QA + real-loopback-WS verified. **Not live** (no real channel, no
persistence; production hosts no Action Window session).

## Baseline / branch caveat

R1 (#213) merged on top of PR #214, which had rewritten the contract shape
(breaking) — so `main` briefly failed collector typecheck in the action-window
module. This R1.1 slice (`fix/action-window-runtime-contract`, from `377a103`)
reconciles R1 to the canonical #214 contract and restores a green `main`. Lesson
recorded above: a breaking contract change must bump `ACTION_WINDOW_PROTOCOL_VERSION`
or ship an explicit migration, and Runtime changes must be re-typechecked against
the contract actually on `main` (not the branch base).
