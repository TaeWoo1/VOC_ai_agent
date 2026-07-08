# Current State — Action Window Runtime

<!-- Update this file when starting or changing the active slice. Fixed top section below. -->

- **updated at:** 2026-07-09
- **baseline main SHA:** `377a103` (`origin/main`; incl. PR #212 R0, **PR #214 canonical-contract copy-ownership**, and PR #213 R1 all merged)
- **current branch:** `fix/action-window-runtime-contract` (R1.1 — align R1 to the post-#214 canonical contract)
- **current worktree:** `sellerops-runtime` (linked worktree of the shared SellerOps repo)
- **branch base SHA:** `377a103` (`origin/main`, merged)
- **shared contract version/path:** **`contracts/action-window/v1/` (`ACTION_WINDOW_PROTOCOL_VERSION = 1`).** Canonical shape set by **PR #214** (modes `AUTOMATIC_OPERATION`/`ACTION_WINDOW`/`FILE_IMPORT`/`INTEGRATION_PENDING`; `channelCode`; run/step `copyKey`+`copyParams`; `title`/`instruction` prohibited). **Governance:** #214 changed the shape *without* bumping the protocol version — treated as the final pre-release v1 reconciliation; future breaking changes MUST bump the version or ship an explicit migration.
- **current slice:** R1.1 (contract reconciliation) — **VERIFIED** against the canonical post-#214 contract; PR open
- **last completed item:** reconciled R1 Runtime/fixture/CLI/tests to the canonical contract (new modes, `channelCode`, `copyKey`/`copyParams`; removed Runtime prose); added a canonical-contract regression test
- **last verified tests:** `engine.test.ts` (20, offline incl. 3 regression) + `fixture-browser.test.ts` (8, `RUN_INTEGRATION=1`); full collector suite **2406 passed / 9 skipped**; `tsc --noEmit` clean. **Headed operator QA (against canonical contract):** `normal` → real human click → COMPLETED (13-event loop; view uses `channelCode`/`runCopyKey`/`copyKey`, `executionMode` `ACTION_WINDOW`→`AUTOMATIC_OPERATION`, no prose); `multi-candidate` → failed closed `TARGET_AMBIGUOUS`, no click.
- **current blocker:** R2 prerequisite — **no FE Action Window mock-flow exists yet** (the FE mock adapter + screen that R2 replaces with a Bridge adapter). Runtime side is green on `main` after this fix merges.
- **next single action:** land this R1.1 fix (restores a green `main`), then build/land the **FE Action Window mock-flow**; only then dispatch **R2** (FE↔Runtime over the Bridge)
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
  `channelCode`/`copyKey` and the canonical execution modes. No live channel,
  Bridge transport, or FE screen yet.

## Existing foundations vs implemented Action Window capability

**Existing foundations (reusable, not delivered Action Window):** connection
profile resolver, candidate signature / frame scan, fail-closed gate / sentinel,
read-only download readiness, upload/ingestion handoff, work/run/audit domain,
Bridge protocol, Browser Projection (optional renderer).

**Implemented Action Window capability:** R1 channel-neutral synthetic loop
(`collector/src/action-window/*`) — pure state engine, target locator, overlay,
user-action observer, transition verifier, fail-closed blockers, dummy downstream,
in-memory event sink, `ActionWindowRunView` projection, cleanup. Synthetic-only;
automated + headed-operator-QA verified. Not live, not FE-integrated.

## Baseline / branch caveat

R1 (#213) merged on top of PR #214, which had rewritten the contract shape
(breaking) — so `main` briefly failed collector typecheck in the action-window
module. This R1.1 slice (`fix/action-window-runtime-contract`, from `377a103`)
reconciles R1 to the canonical #214 contract and restores a green `main`. Lesson
recorded above: a breaking contract change must bump `ACTION_WINDOW_PROTOCOL_VERSION`
or ship an explicit migration, and Runtime changes must be re-typechecked against
the contract actually on `main` (not the branch base).
