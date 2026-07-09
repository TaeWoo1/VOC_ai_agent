# Current State — Action Window Runtime

<!-- Update this file when starting or changing the active slice. Fixed top section below. -->

- **updated at:** 2026-07-09
- **baseline main SHA:** `a2a54f0` (`origin/main`; incl. **PR #224 fixture-only NAVER adapter upstream slice** merged, on top of FE PR #223 (`feat/action-window-fe3`, FE worktree), PR #222 fixture download ladder, PR #221 channel-neutral downstream engine, PR #220 R4-preparation docs, PR #219 R3)
- **current branch:** `feat/r4-supervised-channel-runtime` (fast-forwarded to merged `origin/main` `a2a54f0`; pending UNCOMMITTED work: this post-merge docs sync riding together with the fixture-only NAVER **downstream** slice — real detect + quarantine validate)
- **current worktree:** `sellerops-r4-runtime` (dedicated BE writer worktree, owner file `.claude-worktree-owner`, scope runtime-only)
- **branch base SHA:** `c3cd276` (`origin/main` at branch creation)
- **shared contract version/path:** **`contracts/action-window/v1/` (`ACTION_WINDOW_PROTOCOL_VERSION = 1`, `ACTION_WINDOW_TRANSPORT_VERSION = 1`) — UNCHANGED** (this slice consumes the already-reserved `DOWNLOAD_DETECTED` event and `DOWNLOAD_TIMEOUT`/`ARTIFACT_INVALID` blocker codes; no contract-dir edit, no version bump). Runtime persistence record bumped to **`OPERATION_RUN_SCHEMA_VERSION = 2`** (stage vocabulary changed; stale dev v1 records **fail closed** as `WRONG_SCHEMA_VERSION` and may be deleted locally — dev-only store, deliberately not migrated).
- **current slice:** **R4 pilot adapter (NAVER) — fixture-only UPSTREAM stages MERGED (commit `8460b21`, PR #224, merge `a2a54f0`); downstream sub-slices NOT started.** `NaverFixtureProbeDriver` (`collector/src/action-window/naver-driver.ts`) composes the existing READ-ONLY NAVER seams over a NAVER-*shaped* synthetic fixture (`naver-fixture.ts`, 10 modes, planted leak canaries, zero platform tokens): `prepareSurface` = pure session verdict (reconnect → `SESSION_EXPIRED`, login/auth-challenge → `LOGIN_REQUIRED` via the new additive `SurfaceProbeResult` — reserved codes only, contract dir untouched) then the export-target readiness gate (zero-rows / ambiguous halts BEFORE the checkpoint as `UNSUPPORTED_STATE`, distinction kept in a driver-local test-only diagnostic); `locate` = no-click layout planner (async affordance rejected) + pure candidate finder feeding the engine's 0/1/many fail-closed logic, single candidate one-way hashed to a deterministic opaque 16-hex sig; `verify` = post-action re-locate (vanished/changed identity ⇒ `UI_DRIFT`) + required completion signal (observation ≠ completion). **Downstream is now REAL for detect + validate (this UNCOMMITTED slice):** `downstream.real` opts the NAVER driver into consuming the fixture's byte-carrying artifact (absence models the timeout shape offline) under a nonce-seeded opaque ref, then validating through the NEW channel-neutral `quarantine.ts` — the ONLY AW fs/`saveAs` module, implementing the ratified D-021 posture (temporary save into a gitignored quarantine dir → extension check + OOXML/ZIP magic sniff → DELETE; **a failed delete fails closed as `ARTIFACT_INVALID`**; the quarantine basename derives ONLY from the opaque ref, the platform-suggested filename is reduced to one extension boolean and discarded; `sweepQuarantine` handles crash-window leftovers). `browser-driver.ts` gains the same quarantine mode over REAL Playwright downloads (retain-instead-of-cancel, dispose retained/late downloads + sweep on cleanup), proven against real Chromium headless (RUN_INTEGRATION). **Ingest REMAINS SYNTHETIC** with call counters proving downstream never runs without a verified transition. **Boundaries held: no live NAVER, no real ingest, no Bridge wiring; every saved artifact is a synthetic fixture blob in a per-test temp dir, deleted by the posture.** Channel ratification context (D-021, 2026-07-09): NAVER SmartStore review export; ESM+/Coupang later candidates; live blocked by §3 G2–G6, the NAVER live-work pause, and per-run PO approval; quarantine-save validation posture ratified and NOW IMPLEMENTED by this slice (temporary save → OOXML sniff → delete; no filename/path/URL/content on wire/store/logs). Prior merged groundwork — fixture download ladder (commit `f13fc29`, PR #222, merge `f0d57f4`; verified offline + headless + headed operator proofs): Real read-only browser download detection proven against the synthetic fixture: the user's click on an `<a download>` fixture control natively fires a REAL synthetic-blob download; the Runtime observes it, reports a **nonce-hardened opaque 16-hex `artifactRef`** (detection-local nonce — the filename is never read and never influences the ref), and **cancels/discards** the download (never saved/read/ingested); no filename/path/URL/content crosses the wire or persistence; **validation/ingest remain synthetic in this slice**. Evidence: [`checklist.md`](checklist.md) row 14d. Prior merged milestone in this workstream (below): channel-neutral downstream engine (PR #221, merge `8d61d2f`). The dummy downstream stage was replaced by the real chain `DETECT_DOWNLOAD → VALIDATE_ARTIFACT → INGEST_HANDOFF` (read-only detection, opaque 16-hex `artifactRef` only, fail-closed `DOWNLOAD_TIMEOUT`/`ARTIFACT_INVALID`, downstream failure never completes the run); `ProbeDriver`/synthetic/fixture drivers extended; restore policy re-enters downstream resumes at `DETECT_DOWNLOAD` (a `DOWNLOAD_TIMEOUT`/`ARTIFACT_INVALID` failure resumes through the human checkpoint — the export must happen again). **No channel adapter yet. No live marketplace contact.** FE coordination needed: step-3 copy key changed `actionWindow.step.dummyDownstream` → **`actionWindow.step.downstream`** (FE worktree owns the copy mapping).
- **last completed item:** the **fixture-only NAVER adapter upstream slice is MERGED** (commit `8460b21`, PR #224, merge `a2a54f0`; the PR also carried docs commits `445c6f8`/`cbc596e`): NAVER-shaped synthetic fixture + `NaverFixtureProbeDriver` upstream stages (prepare/locate/highlight/observe/verify), 35 new tests incl. hostile fail-closed shapes, `channelCode: naver` persistence/resume, source guard, and canary privacy scans. Evidence in [`checklist.md`](checklist.md) row 14. Prior merged: fixture download ladder (row 14d, PR #222), channel-neutral downstream engine (row 14g, PR #221).
- **last verified tests:** collector `typecheck` green; `npm test` offline **2522 passed / 18 skipped** (the 18 = RUN_INTEGRATION-gated browser suites, incl. the two new quarantine cases) — verified with the downstream slice applied; `git diff --check` clean; `package.json`/`package-lock.json` unchanged; RUN_INTEGRATION headless local-fixture Chromium — `session-browser.test.ts` + `fixture-browser.test.ts` **15 passed / 2 skipped** (skips = headed-only operator proofs, previously PASSED 2026-07-09) incl. the REAL-Chromium D-021 quarantine proof (real download → temporary save → OOXML sniff → delete, dir empty after; bad magic → `ARTIFACT_INVALID`).
- **current blocker:** **G1 RESOLVED** ([`decisions.md`](decisions.md) D-021 — NAVER SmartStore review export); fixture-only adapter code is **unblocked**. Still blocking **live**: §3 G2–G6 (incl. pilot seller identity for G2 consent), the NAVER live-work pause lift ([`r4-preparation.md`](r4-preparation.md) §9 item 3), and per-run PO approval in the dispatching turn.
- **next single action:** commit this combined slice on explicit instruction (post-merge docs sync + NAVER downstream detect/quarantine-validate — one commit, one PR); the sub-slice after: **real ingest handoff** (raises the deferred ingest-specific blocker-code contract question); Bridge wiring only if/when needed. **Still no live contact, no marketplace pages.**
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
  adapter, no live marketplace contact, no real download** — the channel-specific adapter was
  blocked on G1 channel ratification, now resolved (D-021, NAVER; fixture-only work unblocked).
- **The fixture download ladder is MERGED** (commit `f13fc29`, PR #222, merge `f0d57f4`): real read-only browser download
  detection against the synthetic fixture — the user's click natively fires a real synthetic-blob
  download; the Runtime observes, reports a nonce-hardened opaque 16-hex `artifactRef`, and
  cancels/discards it (never saved/read/ingested); wire/store carry no filename/path/URL/content;
  validation/ingest stay synthetic. Verified offline + headless + **both headed operator proofs
  (real human clicks, 2026-07-09)**. The ingest-specific
  blocker code remains a deferred contract question. Evidence: `checklist.md` row 14d.
- **G1 is RATIFIED (D-021, 2026-07-09): the first R4 supervised pilot channel is NAVER
  SmartStore review export** (why: strongest existing review-export evidence — live-confirmed
  visible+enabled export control, existing validate/upload diagnostic precedent; ESM+ and
  Coupang remain later candidates). Fixture-only adapter work is authorized; live NAVER contact
  stays blocked (§3 G2–G6, live-work pause, per-run approval). Quarantine-save validation
  posture ratified: temporary quarantine save → OOXML sniff → delete, validation only; no
  filename/path/URL/content on wire, store, or logs. Evidence: `checklist.md` row 14.
- **The fixture-only NAVER adapter UPSTREAM slice is MERGED (commit `8460b21`, PR #224,
  merge `a2a54f0`, 2026-07-09):** `NaverFixtureProbeDriver` composes the read-only seams (session
  verdict → export-target readiness → no-click layout planner → pure candidate finder) over a
  NAVER-shaped synthetic fixture; hostile shapes fail closed with reserved codes only
  (reconnect → `SESSION_EXPIRED`, login → `LOGIN_REQUIRED`, empty/ambiguous readiness →
  `UNSUPPORTED_STATE`, 0/many → `TARGET_NOT_FOUND`/`TARGET_AMBIGUOUS`, post-action identity
  change → `UI_DRIFT`); downstream provably never runs without a verified transition. Privacy:
  planted fixture canaries (store-like label, account-id-like token, export-filename-like string)
  never cross events, frames, or persisted records; `findProhibitedFields == []` throughout; the
  fixture itself carries zero platform tokens. Evidence: `checklist.md` row 14.
- **The fixture-only NAVER DOWNSTREAM slice (real detect + quarantine validate) is IMPLEMENTED +
  offline/headless VERIFIED — UNCOMMITTED (this working tree):** the NEW channel-neutral
  `quarantine.ts` implements the D-021 posture (temporary save → extension + OOXML magic sniff →
  DELETE; basename from the opaque nonce ref only; the suggested filename reduced to one boolean
  and discarded; **a failed delete fails closed as `ARTIFACT_INVALID`** — policy recorded in
  `checklist.md` row 14; `sweepQuarantine` for crash-window leftovers). The NAVER driver's
  `downstream.real` runs real detect (fixture artifact, absence = timeout shape) + quarantine
  validate; ingest stays synthetic with counters. `BrowserProbeDriver` gains the same quarantine
  mode over REAL Playwright downloads — proven on real Chromium headless: real download →
  quarantine save → sniff → delete (dir empty; wire free of dir/name/structure fragments), bad
  magic → `ARTIFACT_INVALID`. Hostile shapes covered offline: no download → `DOWNLOAD_TIMEOUT`,
  wrong extension / bad magic / locked-delete → `ARTIFACT_INVALID`; restart-resume completes
  THROUGH the real downstream, and an `ARTIFACT_INVALID` failure resumes through the human
  checkpoint. **No live NAVER, no real ingest, no Bridge wiring.**

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
