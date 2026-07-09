# Current State — Action Window Runtime

<!-- Update this file when starting or changing the active slice. Fixed top section below. -->

- **updated at:** 2026-07-09
- **baseline main SHA:** `8d61d2f` (`origin/main`; incl. **PR #221 R4-groundwork channel-neutral downstream engine** merged, on top of PR #220 R4-preparation docs and PR #219 R3)
- **current branch:** `feat/r4-supervised-channel-runtime` (at merged `origin/main` `8d61d2f` + local docs commit `203bf77`; the fixture-download-ladder code/tests + this docs pass are uncommitted, commit/PR pending)
- **current worktree:** `sellerops-r4-runtime` (dedicated BE writer worktree, owner file `.claude-worktree-owner`, scope runtime-only)
- **branch base SHA:** `c3cd276` (`origin/main` at branch creation)
- **shared contract version/path:** **`contracts/action-window/v1/` (`ACTION_WINDOW_PROTOCOL_VERSION = 1`, `ACTION_WINDOW_TRANSPORT_VERSION = 1`) — UNCHANGED** (this slice consumes the already-reserved `DOWNLOAD_DETECTED` event and `DOWNLOAD_TIMEOUT`/`ARTIFACT_INVALID` blocker codes; no contract-dir edit, no version bump). Runtime persistence record bumped to **`OPERATION_RUN_SCHEMA_VERSION = 2`** (stage vocabulary changed; stale dev v1 records **fail closed** as `WRONG_SCHEMA_VERSION` and may be deleted locally — dev-only store, deliberately not migrated).
- **current slice:** **R4 groundwork — fixture download ladder, VERIFIED (offline + headless + headed operator proofs; uncommitted).** Real read-only browser download detection proven against the synthetic fixture: the user's click on an `<a download>` fixture control natively fires a REAL synthetic-blob download; the Runtime observes it, reports a **nonce-hardened opaque 16-hex `artifactRef`** (detection-local nonce — the filename is never read and never influences the ref), and **cancels/discards** the download (never saved/read/ingested); no filename/path/URL/content crosses the wire or persistence; **validation/ingest remain synthetic in this slice**. Evidence: [`checklist.md`](checklist.md) row 14d. Prior merged milestone in this workstream (below): channel-neutral downstream engine (PR #221, merge `8d61d2f`). The dummy downstream stage was replaced by the real chain `DETECT_DOWNLOAD → VALIDATE_ARTIFACT → INGEST_HANDOFF` (read-only detection, opaque 16-hex `artifactRef` only, fail-closed `DOWNLOAD_TIMEOUT`/`ARTIFACT_INVALID`, downstream failure never completes the run); `ProbeDriver`/synthetic/fixture drivers extended; restore policy re-enters downstream resumes at `DETECT_DOWNLOAD` (a `DOWNLOAD_TIMEOUT`/`ARTIFACT_INVALID` failure resumes through the human checkpoint — the export must happen again). **No channel adapter yet. No live marketplace contact.** FE coordination needed: step-3 copy key changed `actionWindow.step.dummyDownstream` → **`actionWindow.step.downstream`** (FE worktree owns the copy mapping).
- **last completed item:** the fixture download ladder is **fully verified** — offline, headless RUN_INTEGRATION, and BOTH headed operator proofs with real human clicks (R4 download proof; isolated R2A normal proof — the single earlier headed failure was an operator-visibility/sequencing miss, fixed by test-only window banners/titles and a 240s headed wait, not an observer defect). Evidence in [`checklist.md`](checklist.md) row 14d. Prior: channel-neutral downstream engine merged (row 14g, PR #221).
- **last verified tests:** collector `typecheck` green; `npm test` offline **2455 passed / 16 skipped** (the 16 = RUN_INTEGRATION-gated browser suites); RUN_INTEGRATION headless `session-browser.test.ts` **5/5 automated** + `fixture-browser.test.ts` **8/8**; headed proofs both PASSED (2026-07-09); `git diff --check` clean; `package.json`/`package-lock.json` unchanged.
- **current blocker:** unchanged — the pilot channel cannot be selected from repository evidence alone; **§2 criterion 1 (pilot company's actual channel usage) is an unresolved product-owner input** and is decisive ([`r4-preparation.md`](r4-preparation.md) §9). The channel adapter remains blocked on channel ratification (G1) and the §3 internal gate.
- **next single action:** product owner resolves [`r4-preparation.md`](r4-preparation.md) §9 items 1–2 (pilot company channel mix → channel ratification G1). **The channel adapter stays blocked** on that ratification and the §3 internal gate; no adapter code before the gate is signed.
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
- **R4 groundwork (channel-neutral downstream engine) is MERGED** (commit `143d257`, PR #221,
  merge `8d61d2f`): the engine's downstream is now the real chain
  `DETECT_DOWNLOAD → VALIDATE_ARTIFACT → INGEST_HANDOFF` (synthetic drivers only), using only
  already-reserved contract codes; Operation Run schema is **v2** (v1 dev records fail closed).
  FE coordination pending: step-3 copy key is now `actionWindow.step.downstream`. **No channel
  adapter, no live marketplace contact, no real download** — the channel-specific adapter is
  blocked on `r4-preparation.md` §3 gate (G1 channel ratification first).
- **The fixture download ladder is VERIFIED (uncommitted):** real read-only browser download
  detection against the synthetic fixture — the user's click natively fires a real synthetic-blob
  download; the Runtime observes, reports a nonce-hardened opaque 16-hex `artifactRef`, and
  cancels/discards it (never saved/read/ingested); wire/store carry no filename/path/URL/content;
  validation/ingest stay synthetic. Verified offline + headless + **both headed operator proofs
  (real human clicks, 2026-07-09)**. The channel adapter remains blocked (G1/§3); the ingest-specific
  blocker code remains a deferred contract question. Evidence: `checklist.md` row 14d.

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
