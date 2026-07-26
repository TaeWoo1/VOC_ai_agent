# Acquisition Supervisor — runtime integration (offline proof record)

> **Scope:** wiring the Acquisition Supervisor seam (contract `contracts/acquisition/v1`, collector
> `acquisition-supervisor.ts`) into the **live import boot**, and proving it **offline**. This record grants no
> live authorization. Standing safety (root + `collector/CLAUDE.md` §4), sanitization, and the §1.7 residual
> locks are unchanged.
> **Date:** 2026-07-27 · **Mode:** offline (no browser, no NAVER, no backend, no socket-to-marketplace).

## What this slice did

The supervisor seam existed but the live import runtime called nothing in it (the prior slice's deliberate
"not yet wired" boundary). This slice connects it, at the four session-readiness probe moments, without changing
what the existing NAVER import path does.

- **Adapter binding.** `cli/local-agent.ts` → `buildInitialImportConfig` now binds the supervisor's
  `NAVER_ACTION_WINDOW_IMPORT` id to the concrete engine via `createNaverActionWindowImportDriver(proven, opts)`
  — replacing the direct `new NaverLiveImportDriver(...)`. The engine (`NaverLiveProbeDriver` +
  `NaverLiveImportDriver`) is composed unchanged; no export/consent/session logic moved.
- **`ImportAcquisitionCoordinator`** (new, `initial-import/`) owns a `SessionReadinessProjector` + the
  `AcquisitionSupervisor`. It is a thin Adapter-layer coordinator — no durable state, no pure state.
  - **AGENT_START** — fired once at boot (`runImportOnlyBoot`, after `markAgentStarted`). No marketplace tab
    exists yet, so the channel is recorded `UNOBSERVED_EXTERNAL`, never a guessed READY.
  - **BEFORE_WORK** — `ImportSegmentHost` consults `admitSegment()` immediately before it assembles a run
    (new optional `admit` dep; absent → the host is byte-identical to before). Admission is **probe-permissive**:
    it refuses only when `adapterId === "NONE"` (`HOLD_UNSUPPORTED`) — the `adapterId=NONE` execution block — and
    never on a stale not-ready readiness, which would deadlock recovery.
  - **SESSION_FAILURE / MANUAL_RECHECK** — a transparent `ReadinessObservingImportDriver` decorator feeds each
    run's `prepareSurface` reading to the coordinator. A not-usable session → `SESSION_FAILURE` with the
    readiness contract's single action (the human checkpoint); a usable reading after a prior not-ready one →
    `MANUAL_RECHECK` (the seller fixed it and retried).
- **Dispatch / single checkpoint / hold.** DISPATCH when the adapter is bound and the run's own PREPARE reads a
  usable session; the single human checkpoint is the engine's recoverable block surfacing
  `singleActionForReadiness`; HOLD_UNSUPPORTED is enforced at admission (no adapter). The session hold itself is
  enforced by the engine's fail-closed `block()` — the supervisor records it, it does not replace it.
- **Auto-resume after observed action.** Two mechanics, both offline-proven: within a run, each of the six
  barriers advances automatically once the driver reports the seller acted; across a recoverable session
  failure, the seller logs in and a fresh run's re-check reads READY and dispatches.

## Offline evidence

All green, hermetic (`npm test`, no `RUN_INTEGRATION`, no browser):

- `test/action-window/initial-import/import-acquisition-coordinator.test.ts` — surface→readiness mapping
  totality, the four probe moments, probe-permissive admission, `NONE` block, faithful reason mapping,
  sanitized log surface (enums only, no account slot, no forbidden-substring keys).
- `test/action-window/initial-import/readiness-observing-driver.test.ts` — the decorator is transparent:
  `prepareSurface` returns the inner reading unchanged, every other method delegates verbatim, an observation
  that throws never fails a run, the optional dev-badge capability is forwarded.
- `test/action-window/initial-import/import-acquisition-runtime.e2e.test.ts` — the real host + coordinator +
  decorator over the scripted driver: AGENT_START; dispatch-to-ingest with READY/BEFORE_WORK; barrier
  auto-resume; `adapterId === NONE` refusal (nothing assembled, driver untouched); recoverable session-failure
  recovery (`SESSION_FAILURE` → `MANUAL_RECHECK`); and an **equivalence** assertion that the coordinator-wired
  run drives the driver identically to a bare run.
- **Equivalence, existing suites unchanged.** `import-host.test.ts` (28) and the FE↔agent cross-stack import
  suite (`fe-import-runtime-real-bridge.test.ts`, 18) pass unchanged — both construct the host without the
  admit gate, i.e. the audited path is untouched.
- **Whole suite / typecheck / contract CI green.** collector `npm run typecheck`; `npm test` 5329 passed / 125
  skipped; `tsc -p ../contracts/tsconfig.json`; `vitest run test/contracts` (163); `check-contract-importers.sh`.
- **FE-independence.** The new modules are added to the `journey-ports.test.ts` source guard (no React / FE /
  component import).

## Boundaries (still locked; not done here)

- **No live run.** Binding the adapter id to the engine is not taking a live run. A run against a REAL
  marketplace session remains a separately-approved, single-use, in-turn step (§4.7 product-boundary check),
  never standing.
- **No backend persistence** of any supervisor/coordinator state; **no new frontend**; **no NAVER engine edit**;
  **no second channel** (`ORDER_SUMMARY`/others stay §4.1-omitted → `INTEGRATION_PENDING`); **#355 untouched.**
- The §1.7 carve-out still bounds this to the resolve/decide/coordinate seam; `OperationRun`/`CapabilityPolicy`
  bodies, live dispatch, and durable state remain locked.
