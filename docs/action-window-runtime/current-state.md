# Current State — Action Window Runtime

<!-- Update this file when starting or changing the active slice. Fixed top section below. -->

- **updated at:** 2026-07-12
- **baseline main SHA:** `cf509a5` (`origin/main`; incl. **PR #242 — NAVER live action-window driver core (`NaverLiveProbeDriver`)** merged, on top of FE PR #241 (Operations UI polish), PR #229 §8 pre-live evidence/gate pack, PR #231 read-only §8-4 probe entrypoint, **PR #227 — NAVER fixture Bridge/local-agent boot wiring (D-023)**, FE PR #226, PR #225 complete fixture-only NAVER downstream handoff, PR #224 upstream stages, FE PR #223, PR #222 fixture download ladder, PR #221 channel-neutral downstream engine, PR #220 R4-preparation docs, PR #219 R3)
- **current branch:** `feat/r4-supervised-channel-runtime` — HEAD `cf509a5` (== `origin/main` after the PR #242 merge fast-forward); pending UNCOMMITTED work: the **§6 readiness-checkbox reconciliation** (docs-only) recording the live driver core against the §6 ladder
- **current worktree:** `sellerops-r4-runtime` (dedicated BE writer worktree, owner file `.claude-worktree-owner`, scope runtime-only)
- **branch base SHA:** `c3cd276` (`origin/main` at branch creation)
- **shared contract version/path:** **`contracts/action-window/v1/` (`ACTION_WINDOW_PROTOCOL_VERSION = 1`, `ACTION_WINDOW_TRANSPORT_VERSION = 1`) — UNCHANGED** (this slice consumes the already-reserved `DOWNLOAD_DETECTED` event and `DOWNLOAD_TIMEOUT`/`ARTIFACT_INVALID` blocker codes; no contract-dir edit, no version bump). Runtime persistence record bumped to **`OPERATION_RUN_SCHEMA_VERSION = 2`** (stage vocabulary changed; stale dev v1 records **fail closed** as `WRONG_SCHEMA_VERSION` and may be deleted locally — dev-only store, deliberately not migrated).
- **current slice:** **R4 pilot adapter (NAVER) — §8 PRE-LIVE EVIDENCE/GATE PACK (this UNCOMMITTED slice): the dated readiness evidence is assembled.** [`r4-evidence-pack.md`](r4-evidence-pack.md) (2026-07-11) assembles §8 items 1–7 — the §3 gate record (G1–G5 ✅ as of 2026-07-12; **G6 OPEN**, operator/PO-owned), the §6 synthetic ladder (every item green on NAVER fixtures), the **headed human-click proof (PASSED 2026-07-11, `AW_HEADED naver-browser` 3/3, real click)**, the abort drill (every fail-closed exit + a NEW NAVER operator-abort `CANCEL_RUN` drill, all recovering per §7), and the privacy sweep (wire + persisted store, 0 prohibited fields / 0 needle hits). Turns §1 **P9/P10/P11 green**; **the remaining R4 path to a live pilot is operator/PO-owned (G6 per-run approval, on top of the read-only-probe-scoped live-work pause lift), not Runtime code.** This pack authorizes NO live action. **Prior slice (MERGED, PR #227, main `3cda125`): Bridge/local-agent boot wiring (D-023)** — the ratified NAVER fixture driver is hosted over the real Bridge WS from the local-agent boot. The D-017 Bridge transport was already boot-wired end-to-end (`local-agent.ts` → `agent-bridge.ts` → endpoint → engine → session → R3 persistence) but only ever injected `SyntheticProbeDriver`; this slice adds a **driver-selection** seam, not a new transport: `resolveActionWindowChannel(args, env)` → `synthetic | naver-fixture | null` (both flags **dev-only**, never under `NODE_ENV=production`) and `buildActionWindowConfig` injects `createDriver: () => new NaverFixtureProbeDriver("normal", …)` for the NAVER channel through the SAME already-injected `AgentActionWindowConfig.createDriver` (`agent-bridge.ts` UNCHANGED). The NAVER-fixture boot stays **fixture-only** (no browser, no live NAVER): it runs the real detect + quarantine-validate chain OFFLINE over the fixture artifact (gitignored `.aw-quarantine/` via the new `defaultQuarantineDirFor`) and its **ingest stays SYNTHETIC** so the loop completes with zero network; the real `/api/uploads` ingest is **opt-in** behind a SEPARATE `--dev-action-window-ingest-local` flag (LOCAL dev backend only, dev creds from `loadConfig`). Proven over the **REAL Bridge WS via `createAgentBridge`** (the actual boot composition): full command/event/view loop → COMPLETED, and an agent **cold restart** resumes the persisted NAVER run (parked at PAUSED) and completes THROUGH downstream. A **headed operator proof** (`naver-browser.test.ts`, `RUN_INTEGRATION=1 AW_HEADED=1`; a NAVER-*shaped* synthetic review-export page via the new `fixture.ts` `naver-review-export-xlsx` mode) **PASSED 2026-07-11 with a real seated-operator human click** (3/3; `USER_ACTION_OBSERVED` received, COMPLETED progress 3/3, quarantine dir empty, privacy clean) — cited in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-3. **The full downstream + boot wiring are MERGED on main (PRs #225/#227, `3cda125`).** `NaverFixtureProbeDriver` (`collector/src/action-window/naver-driver.ts`) composes the existing READ-ONLY NAVER seams over a NAVER-*shaped* synthetic fixture (`naver-fixture.ts`, 10 modes, planted leak canaries, zero platform tokens): `prepareSurface` = pure session verdict (reconnect → `SESSION_EXPIRED`, login/auth-challenge → `LOGIN_REQUIRED` via the new additive `SurfaceProbeResult` — reserved codes only, contract dir untouched) then the export-target readiness gate (zero-rows / ambiguous halts BEFORE the checkpoint as `UNSUPPORTED_STATE`, distinction kept in a driver-local test-only diagnostic); `locate` = no-click layout planner (async affordance rejected) + pure candidate finder feeding the engine's 0/1/many fail-closed logic, single candidate one-way hashed to a deterministic opaque 16-hex sig; `verify` = post-action re-locate (vanished/changed identity ⇒ `UI_DRIFT`) + required completion signal (observation ≠ completion). **Downstream is now REAL for detect + validate (this UNCOMMITTED slice):** `downstream.real` opts the NAVER driver into consuming the fixture's byte-carrying artifact (absence models the timeout shape offline) under a nonce-seeded opaque ref, then validating through the NEW channel-neutral `quarantine.ts` — the ONLY AW fs/`saveAs` module, implementing the ratified D-021 posture (temporary save into a gitignored quarantine dir → extension check + OOXML/ZIP magic sniff → DELETE; **a failed delete fails closed as `ARTIFACT_INVALID`**; the quarantine basename derives ONLY from the opaque ref, the platform-suggested filename is reduced to one extension boolean and discarded; `sweepQuarantine` handles crash-window leftovers). `browser-driver.ts` gains the same quarantine mode over REAL Playwright downloads (retain-instead-of-cancel, dispose retained/late downloads + sweep on cleanup), proven against real Chromium headless (RUN_INTEGRATION). **Ingest is now REAL (this UNCOMMITTED slice, opt-in):** a NEW channel-neutral `ingest-handoff.ts` reduces the backend `IngestResult` to the sanitized `{ ok, processed }` the engine reads (`onIngested` reads only `ok`; `processed` is persisted nowhere) and builds the real `login → resolveChannelId → uploadReviewBytes` hookup (upload.ts gains bytes-based `uploadReviewBytes`, the single wire-filename composer) under an opaque `aw-<artifactRef>.xlsx` name — the platform's suggested filename is never uploaded. The NAVER driver's `downstream.real.ingest.upload` is an **INJECTED** callback (the driver never imports `../upload`; the source guard is unchanged); when configured, `validateArtifact` keeps the validated bytes and `ingest()` re-reads them for the upload, mapping the outcome to `{ ok, processed }`; a non-`ok` outcome fails the run closed as **`UNSUPPORTED_STATE`** (no ingest-specific code — deferred). Without the callback, ingest stays synthetic byte-identical to `fbe68e9`. Proven offline (injected fake fn: COMPLETED, fail-closed, resume-through-ingest, privacy) and via a gated real-backend test (synthetic CSV, unique `리뷰글번호`, real dedup delta). **Boundaries held: no live NAVER, no browser-path real ingest; the NAVER fixture channel is now Bridge/boot-wired but stays fixture-only + dev-only (production hosts no session); the only real backend contact is the gated local dev-backend test with synthetic rows; every saved artifact is a synthetic fixture blob in a per-test temp dir, deleted by the posture.** Channel ratification context (D-021, 2026-07-09): NAVER SmartStore review export; ESM+/Coupang later candidates; live blocked by §3 G2–G6, the NAVER live-work pause, and per-run PO approval; quarantine-save validation posture ratified and NOW IMPLEMENTED by this slice (temporary save → OOXML sniff → delete; no filename/path/URL/content on wire/store/logs). Prior merged groundwork — fixture download ladder (commit `f13fc29`, PR #222, merge `f0d57f4`; verified offline + headless + headed operator proofs): Real read-only browser download detection proven against the synthetic fixture: the user's click on an `<a download>` fixture control natively fires a REAL synthetic-blob download; the Runtime observes it, reports a **nonce-hardened opaque 16-hex `artifactRef`** (detection-local nonce — the filename is never read and never influences the ref), and **cancels/discards** the download (never saved/read/ingested); no filename/path/URL/content crosses the wire or persistence; **validation/ingest remain synthetic in this slice**. Evidence: [`checklist.md`](checklist.md) row 14d. Prior merged milestone in this workstream (below): channel-neutral downstream engine (PR #221, merge `8d61d2f`). The dummy downstream stage was replaced by the real chain `DETECT_DOWNLOAD → VALIDATE_ARTIFACT → INGEST_HANDOFF` (read-only detection, opaque 16-hex `artifactRef` only, fail-closed `DOWNLOAD_TIMEOUT`/`ARTIFACT_INVALID`, downstream failure never completes the run); `ProbeDriver`/synthetic/fixture drivers extended; restore policy re-enters downstream resumes at `DETECT_DOWNLOAD` (a `DOWNLOAD_TIMEOUT`/`ARTIFACT_INVALID` failure resumes through the human checkpoint — the export must happen again). **No channel adapter yet. No live marketplace contact.** FE coordination needed: step-3 copy key changed `actionWindow.step.dummyDownstream` → **`actionWindow.step.downstream`** (FE worktree owns the copy mapping).
- **last completed item:** the **§8 pre-live evidence pack is MERGED** (PR #229, `603189c`, 2026-07-11); the **read-only §8-4 NAVER session-precondition probe entrypoint (prep A) is MERGED** (PR #231, merge `a5d907c`, 2026-07-11 — gated, sanitized, stops at the session verdict; offline suite 2593/25); and the **§3 gate record is now recorded** (this docs-only slice, 2026-07-12): NEW [`r4-gate-record.md`](r4-gate-record.md) records **G2 self-consent** for `NAVER_DEV_SELLER_SELF_01` (operator's own dev account) and **G5 policy log** (none required), flipping §1 P7/P8 → ✅, with a G3 stable-environment checklist and a G6 per-run-approval template scaffolded ([`decisions.md`](decisions.md) D-024). **G3 is now CONFIRMED** (2026-07-12): the operator attests stable network/IP/location, dedicated profile, paired Bridge, and Operation Run persistence, and lifts the NAVER live-work pause **scoped to the first read-only session-precondition probe only** (not a general lift) — [`r4-gate-record.md`](r4-gate-record.md) §G3. **The read-only §8-4 session-precondition probe was then EXECUTED once (2026-07-12)** under a **consumed one-run G6** approval — sanitized result `ready:true` / `LOGGED_IN` / `seller-center` (no blocker); read-only guarantees held (no click/locate/highlight/export/download/quarantine/ingest/downstream/status write; nothing sent to SellerOps), result recorded in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-4. This was **NOT an export pilot** and authorizes no further live action. **Then the NAVER live action-window driver core (`NaverLiveProbeDriver`) was MERGED (PR #242, `cf509a5`, 2026-07-12)** — a shared `naver-surface.ts` decision core + the live driver over a real Playwright `Page`, proving the NAVER-specific §6 seams hermetically (`naver-surface`/`naver-live-driver`) and over a real browser on a **synthetic DOM** (`naver-live-browser`, `RUN_INTEGRATION` 2 passed / 1 `AW_HEADED` skipped); no click, no legacy capture, no upload import, no live NAVER; not yet session/Bridge-wired. **This docs-only slice then RECONCILED §6:** the stale-unchecked §6 checklist body (was 8☐/2☑) is flipped ☑ to match P9/§8-2 with dated evidence pointers (fixture / synthetic-browser green), each carrying an explicit "no live NAVER / live driver not session-wired" scope; Operation-Run persistence + Bridge/FE loop stay on fixture-driver evidence; P6/P12 stay ☐.
- **last verified tests:** collector `typecheck` green; `npm test` offline **2556 passed / 25 skipped** (was 2555; +1 NAVER operator-abort drill) — verified with the evidence-pack slice applied on top of `3cda125`; `git diff --check` clean; `contracts/`, `frontend/`, `backend/`, `package.json`/`package-lock.json` unchanged. **`naver-bridge-transport.test.ts` PASSED under `RUN_INTEGRATION=1` (3/3)** (full loop + cold-restart resume-through-downstream over the real Bridge WS via `createAgentBridge`). **`AW_HEADED naver-browser.test.ts` PASSED 3/3 with a REAL seated-operator human click (2026-07-11)** — `USER_ACTION_OBSERVED` received, COMPLETED progress 3/3, quarantine dir empty, privacy clean (Playwright Chromium installed to the user cache for the run, no repo change); cited in the evidence pack §8-3.
- **current blocker:** the fixture-only adapter, boot wiring, readiness evidence, the recordable gates, and the **read-only §8-4 session-precondition probe (EXECUTED 2026-07-12, `ready:true`/`LOGGED_IN`)** are all **complete** — **G1/G2/G3/G4/G5 ✅** ([`decisions.md`](decisions.md) D-021/D-024; [`r4-gate-record.md`](r4-gate-record.md); G3 confirmed 2026-07-12 for the read-only probe path). The one G6 approval used for that probe is **consumed** (per-run, never standing). The **live driver core (`NaverLiveProbeDriver`) is now MERGED (PR #242)** and §6 is **reconciled** (fixture / synthetic-browser green; no live NAVER). Still blocking a **live export pilot**: (Runtime, deferred, stop-and-ask) a **live entrypoint/CLI** wiring the live driver into `ActionWindowSession`/engine/Bridge/persistence; and (operator/PO-owned) **P4** environment + live-work-pause re-affirmed for an export run, **P6** supervised-pilot gate sign-off, and a **fresh per-run G6 under the full §4 boundary** — the recorded pause lift and consumed G6 were scoped to the read-only probe only.
- **next single action:** commit this §6 reconciliation docs slice on explicit instruction (this task). **The remaining R4 path to a live export pilot:** (Runtime, deferred, stop-and-ask) a **live entrypoint/CLI** wiring `NaverLiveProbeDriver` into `ActionWindowSession`/engine/Bridge/persistence, plus an optional headed synthetic operator proof (`AW_HEADED naver-live-browser`); (operator/PO-owned) a **new** per-run G6 approval in that dispatching turn under the **full §4 boundary** (real seller click + download + downstream), **P4** environment/live-work-pause posture re-affirmed for an actual export run, and **P6** sign-off. Other deferred Runtime items: **browser-driver real NAVER-driver ingest** over a real `Download`; a **dedicated `INGEST_FAILED` contract code** (governed contract + FE mapping); the gated real-backend CSV test when a local dev backend is available; FE copy mapping for `actionWindow.step.downstream` / `actionWindow.run.naver`. **Still no live export contact, no marketplace export pages.**
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
  checkpoint. Committed as `fbe68e9` (HELD).
- **The fixture-only NAVER DOWNSTREAM ingest-handoff slice is IMPLEMENTED + offline VERIFIED —
  UNCOMMITTED (this working tree, on top of `fbe68e9`):** after quarantine validation the verified
  artifact is handed to the EXISTING `/api/uploads` path so review rows are actually processed — **no
  backend change** (dedup on `리뷰글번호` = `external_id`, scoped by org+channel). New channel-neutral
  `ingest-handoff.ts` reduces the backend `IngestResult` to the sanitized `{ ok, processed }` the
  engine reads (raw status/id/error text never reaches the driver, the wire, or persistence) and
  builds the real `login → resolveChannelId → uploadReviewBytes` hookup under an opaque
  `aw-<artifactRef>.xlsx` name (the platform filename is never uploaded). The NAVER driver takes the
  upload as an **INJECTED** callback (`downstream.real.ingest.upload`) so it stays network-free and its
  source guard is unchanged; a non-`ok` outcome fails the run closed as **`UNSUPPORTED_STATE`** (the
  dedicated `INGEST_FAILED` code is a deferred governed contract change, PO-decided to keep generic).
  Proven offline: COMPLETED via injected upload, fail-closed on non-`ok`, resume-through-ingest,
  `findProhibitedFields == []` + needle-clean records (`processed` never persisted). A gated
  real-backend test (synthetic CSV, unique `리뷰글번호`, real dedup delta) exists but is offline-skipped
  (needs a local dev backend). **DEFERRED:** browser-driver real ingest; full fixture-xlsx → real-POI
  E2E (needs an xlsx-writer dep); the dedicated ingest code; Bridge wiring. **No live NAVER.**
  *(The full downstream is now MERGED — PR #225, merge `a858c0d`, 2026-07-11.)*

- **The NAVER fixture Bridge/local-agent BOOT-WIRING slice is IMPLEMENTED + offline VERIFIED —
  UNCOMMITTED (this working tree, on top of merged `a858c0d`):** the D-017 Bridge transport was already
  boot-wired end-to-end but only ever injected `SyntheticProbeDriver`; this slice adds a **driver-selection**
  seam (NOT a new transport). `local-agent.ts` gains `resolveActionWindowChannel(args, env)` →
  `synthetic | naver-fixture | null` (both flags **dev-only**, never under `NODE_ENV=production`) and
  `buildActionWindowConfig`, which injects `createDriver: () => new NaverFixtureProbeDriver("normal", …)`
  through the SAME already-injected `AgentActionWindowConfig.createDriver` — **`agent-bridge.ts` is
  unchanged**. The NAVER-fixture boot is **fixture-only** (no browser, no live NAVER): real detect +
  quarantine-validate run OFFLINE over the fixture artifact (gitignored `.aw-quarantine/` via the new
  `defaultQuarantineDirFor`) and **ingest stays SYNTHETIC** so the loop completes with zero network; the
  real `/api/uploads` ingest is **opt-in** behind a separate `--dev-action-window-ingest-local` flag
  (LOCAL dev backend only). Verified over the **REAL Bridge WS via `createAgentBridge`** (the actual boot
  composition, `RUN_INTEGRATION` 3/3): full command/event/view loop → COMPLETED with `channelCode:"naver"`,
  and an agent **cold restart** resumes the persisted NAVER run (parked at PAUSED) and completes THROUGH
  the real downstream — every frame + persisted record `findProhibitedFields == []` and needle-clean
  (no quarantine path, no fixture canary, no filename). A **headed operator proof**
  (`naver-browser.test.ts`, `RUN_INTEGRATION=1 AW_HEADED=1`; a NAVER-*shaped* synthetic review-export
  surface — new `fixture.ts` `naver-review-export-xlsx` mode) **PASSED 2026-07-11 with a real seated
  operator click** (3/3). **DEFERRED:** browser-driver real NAVER-driver ingest over a real `Download`;
  the dedicated `INGEST_FAILED` code. **No live NAVER; production hosts no Action Window session (flags
  dev-only).** *(MERGED — PR #227, `3cda125`, 2026-07-11.)*

- **The §8 pre-live evidence/gate pack is ASSEMBLED — UNCOMMITTED (this working tree, on top of merged
  `3cda125`):** [`r4-evidence-pack.md`](r4-evidence-pack.md) (dated 2026-07-11, sanitized —
  enums/booleans/counts/test-names/SHAs only) gathers §8 items 1–7: the §3 gate record (G1–G5 ✅ as of
  2026-07-12; **G6 OPEN**, operator/PO-owned), the §6 synthetic ladder (every readiness item green on NAVER
  fixtures, offline `npm test` **2556 passed / 25 skipped**), the **headed human-click proof (PASSED
  2026-07-11)**, the abort drill (all 8 fail-closed exits + a **NEW NAVER operator-abort `CANCEL_RUN`
  drill**, all recovering per §7), and the privacy sweep (wire + persisted store, 0 prohibited fields / 0
  needle hits). Turns §1 **P9/P10/P11 green**. **The pack authorizes NO live action — the remaining R4
  path to a live pilot is operator/PO-owned (G6 per-run approval; G2 consent, G3 + read-only-probe-scoped
  live-work pause lift, and G5 policy log recorded 2026-07-12), not Runtime code.**

## Existing foundations vs implemented Action Window capability

**Existing foundations (reusable, not delivered Action Window):** connection
profile resolver, candidate signature / frame scan, fail-closed gate / sentinel,
read-only download readiness, work/run/audit domain, Bridge protocol, Browser
Projection (optional renderer). *(The upload/ingestion handoff is now WIRED into the
Action Window downstream as an injected, sanitized capability — see the ingest-handoff
truth-snapshot bullet above.)*

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
