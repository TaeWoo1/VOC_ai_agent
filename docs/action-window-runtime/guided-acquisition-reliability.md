# Guided Acquisition Reliability

**Status:** offline-complete; **live proof PENDING** a fresh single-use in-turn approval.
**Scope:** the NAVER guided review-import journey, from the seller pressing 과거 리뷰 연동 through login, the
in-page guidance, download detection, and ingest. One PR; no new dashboard, no second channel, no DB migration.

## The problem it closes

The first live guided imports (#367 and its predecessors) could accept a run and then reach the seller in none
of the ways they were supposed to — and do it **silently**. The account-scoped window opened but the in-page
highlight never rendered; the operator pressed 계속 확인 and nothing changed; the run sat with the view still
saying WAITING_FOR_HUMAN while the page was, in fact, dead. Every one of those was a place the runtime fell
silent: a swallowed `.catch(() => {})`, a `mountOverlay` that returned having drawn nothing, a barrier loop
re-arming an observation on a closed page forever. This slice gives every one of those a **name**, a **visible
recoverable state**, and **one recovery action**.

## The pipeline and its eight failure states

The guided span is an ordered pipeline (`contracts/acquisition/v1/reliability`):

```
SELF_CHECK → SURFACE_OPEN → SESSION_PROBE → PREPARE → SURFACE_SETTLE → GUIDANCE_PACK → OVERLAY_MOUNT → OVERLAY_VISIBLE → READY
```

Instrumentation emits one sanitized marker per boundary (`aw_acquisition_stage`), so a run that goes quiet
leaves a trail whose LAST marker is where it stopped. Each stall is one of eight `AcquisitionFailureState`s,
every one **recoverable** (a 다시 확인 re-runs PREPARE — re-opening the window if it was closed):

| Failure state | Stage | Seller-facing blocker | What it was before |
|---|---|---|---|
| `SURFACE_OPEN_FAILED` | SURFACE_OPEN | `SURFACE_OPEN_FAILED` | a raw open error / stranded run |
| `SESSION_NOT_READY` | SESSION_PROBE | `LOGIN_REQUIRED` / `SESSION_EXPIRED` | already handled; now on the trail |
| `PREPARE_NOT_STARTED` | PREPARE | `PREPARE_NOT_STARTED` | "no PREPARE log, idle CPU" |
| `SURFACE_SETTLE_TIMEOUT` | SURFACE_SETTLE | `SURFACE_SETTLE_TIMEOUT` | a hung, never-rendering page |
| `GUIDANCE_PACK_REJECTED` | GUIDANCE_PACK | `GUIDANCE_PACK_REJECTED` | logged once, then dropped in silence |
| `OVERLAY_MOUNT_FAILED` | OVERLAY_MOUNT | `OVERLAY_MOUNT_FAILED` | an unhandled evaluate throw |
| `OVERLAY_NOT_VISIBLE` | OVERLAY_VISIBLE | `OVERLAY_NOT_VISIBLE` | "logged in, no highlight" |
| `SURFACE_CLOSED` | (any) | `SURFACE_CLOSED` | an indefinite park on a dead page |

`AcquisitionOutcome = OK | <one of the eight>` is the terminal classification every guided run gets — the unit
the adversarial loop requires. The eight are sanitized *categories*; the FE owns every seller-facing sentence
(Action Window §6), keyed off the projected `BlockerCode` in `frontend/src/lib/actionWindow/copy.ts`.

## What each layer does

- **Contract** (`contracts/`): the `AcquisitionFailureState` / `AcquisitionStage` vocabulary + pure maps
  (`stageForFailure`, `failureStateToBlocker`, `isRecoverable`) and the seven new recoverable Action Window
  `BLOCKER_CODES` the failures project to (`SESSION_NOT_READY` reuses the session blockers, not an eighth code).
- **Engine** (`import-engine.ts` + `import-stages.ts`): a new recoverable `SURFACE_BLOCKED` park (mirrors
  `SESSION_BLOCKED`), `reliabilityPark(code)` (idempotent per cause, never on a terminal run), and a re-check
  from `SURFACE_BLOCKED` that re-runs PREPARE on the SAME segment and ticket.
- **Session** (`import-session.ts`): catches a `ReliabilityFailure` a driver throws and parks it; projects a
  rejected guidance pack instead of dropping it; a PREPARE-start watchdog (last backstop for a prepare that
  never produces a result); a per-window surface-close watch that parks `SURFACE_CLOSED`; and every remaining
  `.catch(() => {})` on the reliability path replaced by a sanitized `warn` line (never truly silent).
- **Driver** (`naver-live-import-driver.ts` + `lazy-import-driver.ts`): overlay-visibility verification
  (`OVERLAY_MOUNT_FAILED` on throw, `OVERLAY_NOT_VISIBLE` on a mounted-nothing paint), a surface-settle guard
  (`SURFACE_SETTLE_TIMEOUT`), a `SURFACE_OPEN_FAILED` throw when the window will not open, and reopen-after-close
  (`markClosed` drops the cached driver so the next PREPARE re-opens a fresh page in the SAME persistent
  profile — session and cookies survive, no disk resume, credential-at-rest rule intact).
- **Boot** (`cli/local-agent.ts`): the agent-side pre-flight self-check (backend reachable, bridge allow-list
  set, the SellerOps origin actually in it — the `:5174` vs `:5173` gotcha), wired `page.once("close")`, context
  reuse across re-opens, and the managed-download hand-off — a detected download is written to a stable,
  seller-named copy under the gitignored `downloads/` dir (sanitized basename, never logged) so the operator
  gets a real, openable file instead of a GUID `playwright-artifacts-*` temp.
- **FE** (`copy.ts`, `reviewImport.ts`): real-Korean copy + one recovery action for each new blocker, on both
  the SellerOps card and the in-page panel (same wording, one source).

## The controlled adversarial root-cause loop

`adversarial-loop.ts` is the discipline for the LIVE root-cause pass (run only under approval):

- a **fixed baseline** (same account, profile, guidance pack, entry point); a variant changes exactly ONE
  `AdversarialVariable` (`TIMING | SESSION_FRESHNESS | OVERLAY_TIMING | NAVIGATION | RECHECK`);
- **run isolation** by a distinct `runId + sessionId + surfaceId`, and **one live run at a time** (an internal
  lock);
- **every run ends in one terminal `AcquisitionOutcome`**; a run that reaches none is DISCARDED, never evidence;
- **attribution or nothing**: a difference is attributed to an axis only when exactly one variable's variant
  flipped the outcome; anything ambiguous is `INCONCLUSIVE` and the run is not used as proof.

The whole policy is offline-testable (the run is an injected `exec`); wiring `exec` to a real session is the
separately-approved live step.

## Offline proof

- Contract: `contracts` typecheck; v2 consistency + fixtures; `reliability.test.ts`.
- Collector: `npm run typecheck` + full suite green, including `reliability-instrumentation`, `reliability-park`,
  `import-session-reliability` (every failure state parks + recovers), `guided-preflight`, `adversarial-loop`,
  and the updated `lazy-import-driver` / `live-import-driver-frame` guards.
- Headless recovery E2E (`guided-acquisition-recovery.e2e.test.ts`, `RUN_INTEGRATION=1`): proves, on a real
  headless page, that the overlay is detected as visible with a target and as **not** visible without one (the
  real `OVERLAY_NOT_VISIBLE` signal), and that a closed page resolves the close signal and a fresh page in the
  same context recovers.
- Frontend: `tsc` + full suite; `copy.test.ts` locks the new blocker copy.

## Live proof — DONE (2026-07-27, real NAVER SmartStore, seated single-use approval)

Verified end-to-end on the real seller center via the disposable-DB backend (`sellerops_gar_live`) → FE `:5174`
→ bridge `:47620` → collector agent → headed Chrome. Export stayed human-driven (§4.7); SellerOps never logged
in or clicked.

**A root cause found live, fixed in-branch, and re-proven** (the adversarial-loop discipline in practice):

- **Two runs terminated on a not-ready surface.** The seller pressed 시작 while the NAVER window was still on the
  login / a redirect (not the 리뷰 검색 page). The surface probe returned `UNSUPPORTED_STATE`, which the guided
  engine treated as a **terminal `FAILED`** — and a terminal run **stranded the single-use ticket**, so
  "계속 가져오기" could not restart it (DB: one launch `CONSUMED`, one dangling `ISSUED`, plan stuck). That is
  exactly the *unrecoverable* state this slice exists to remove. Instrumentation made it legible: the trail
  ended at `SURFACE_SETTLE`, and the persisted stage was `FAILED` at the 2nd publish.
- **Fix:** a guided import has no permanently-unsupported review surface — an unrecognised surface means "not on
  리뷰 검색 yet". `import-engine.onSurfaceReady` now parks it **recoverably** (`SURFACE_SETTLE_TIMEOUT`, "화면이
  아직 준비되지 않았어요 — 리뷰 관리 화면이 뜬 뒤 다시 확인") instead of terminating. Offline-verified (collector
  suite green), then re-tried live.

**The clean run after the fix (`run_8409dc63ff49`), one continuous marker trail:**

- boot `aw_guided_preflight_summary {ok:true, issues:0}` — the self-check passed (backend/bridge/origin/agent);
- `PREPARE → GUIDANCE_PACK {blockers:16}` (9 + the 7 new reliability codes) `→ SURFACE_OPEN → SESSION_PROBE →
  SURFACE_SETTLE` → **`aw_acquisition_failure {SURFACE_SETTLE_TIMEOUT, recoverable:true}`** — the not-ready
  surface now parks recoverably (was the terminal strand);
- seller opens 리뷰 검색, presses **다시 확인** → **`PREPARE` re-runs on the SAME ticket** → `aw_import_surface_facts
  {dateInputCount:2}` → **`OVERLAY_MOUNT → OVERLAY_VISIBLE`** — the guided overlay rendered and was verified
  visible (the #367 silent-overlay gap, closed) → **`READY`**;
- seller sets dates → `scope_verdict {match:MATCH}` → export highlighted → download detected →
  **`aw_naver_managed_copy_saved {saved:true}`** → run store `stage: COMPLETED, artifactDetected:true`.
- Backend: **`reviews: 59`** ingested, segment **`COMPLETED | COVERED`**, attempt **`SUCCEEDED`**; the managed
  copy on disk is a real **`review_<dd>_<t>.xlsx`** (seller-named, not a GUID temp — the #367 artifact problem,
  fixed); the after-ingest issue-memory refresh fired (`review_issue_unknown_units: 84`). No-silent-catch was
  live too: `aw_import_panel_render_failed {reason:"Error"}` was logged (not swallowed) when the panel could not
  draw on the login page.

**Sanitized throughout:** every marker carried enums/booleans/coarse counts only — no account id, slot, cookie,
token, URL, or filename in any log. Test env torn down after: disposable DB dropped (name-guarded), agent/FE/
backend stopped, export file + profile are gitignored.
