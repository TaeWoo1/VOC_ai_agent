# R4 Pre-Live Evidence Pack — NAVER SmartStore review export

**Assembled:** 2026-07-11 · **Channel:** NAVER SmartStore review export (ratified G1, [`decisions.md`](decisions.md) D-021).
**Code baseline under test:** `origin/main` `3cda125` (merge of PR #227 — the fixture-only NAVER
downstream + Bridge/local-agent boot wiring); the §8-6 NAVER operator-abort drill is added by this pack slice.
**Status:** ASSEMBLED (technical readiness); the read-only §8-4 probe result is recorded 2026-07-12.
**This pack authorizes NO live action** — it records readiness evidence only. The **read-only
session-precondition probe was completed 2026-07-12 (§8-4)** under a **consumed one-run G6** approval;
any live **export** remains blocked pending a **fresh per-run G6** in the dispatching turn under §4
(G2/G5 recorded 2026-07-12, [`r4-gate-record.md`](r4-gate-record.md), D-024) **and a fresh export-scoped
G3**. G3 and G6 are both **per-run** (D-026): the 2026-07-12 G3 affirmation was scoped to that first
read-only session-precondition probe only and is **consumed**.

**Sanitization discipline (self-applied):** every value below is an enum, boolean, coarse count, test name,
or commit SHA. No raw review/inquiry content, reviewer/seller/account identity, reference codes, exact
amounts, tokens, cookies, raw URLs/HTML/screenshots, raw timestamps, `eventTimeMs`, filenames, or local
paths appears in this document. This is the same contract the pack certifies (§8-7).

This pack satisfies [`r4-preparation.md`](r4-gate-record.md) §8 items 1–7 and P11; it is the readiness
evidence for §1 P9/P10/P11.

---

## §8-1 — Gate record (§3 supervised-pilot internal gate)

| Gate | Item | Status | Evidence / what it still needs |
|---|---|---|---|
| **G1** | Channel ratified | ✅ | **NAVER SmartStore review export** — [`decisions.md`](decisions.md) D-021 (2026-07-09); §2 selection rationale. |
| **G2** | Seller consent | ✅ | **Self-consent recorded 2026-07-12** for `NAVER_DEV_SELLER_SELF_01` (operator's own dev account) acknowledging §4 verbatim; first live run scoped to the read-only session-precondition probe — [`r4-gate-record.md`](r4-gate-record.md) §G2, [`decisions.md`](decisions.md) D-024. |
| **G3** | Environment + pause lift | ☐ per-run | Stable env (network/IP/location) + dedicated Chrome profile + paired Bridge + Operation Run persistence, **plus the §9 item 3 NAVER live-work pause lift** — all affirmed **in the dispatching turn**, scoped to that one run (D-026). **One read-only-probe instance was affirmed + consumed 2026-07-12** (result §8-4) — **never standing**; an export pilot needs a **new**, export-scoped instance under §4. CONSUMED instance in [`r4-gate-record.md`](r4-gate-record.md) §G3; operator-owned. |
| **G4** | Synthetic ladder green | ✅ | **This pack, §8-2** — every §6 adapter-readiness item green on NAVER fixtures. |
| **G5** | Policy track open | ✅ | **Logged 2026-07-12** — none required for the NAVER seller-owned export per §5; no platform "approved" — [`r4-gate-record.md`](r4-gate-record.md) §G5, §8-5. |
| **G6** | Per-run approval | ☐ per-run | Explicit product-owner approval **in the dispatching turn** (channel, seller-account owner, date, operator, run scope, §7 abort criteria). **One read-only-probe instance was approved + consumed 2026-07-12** (result §8-4) — **never standing**; an export pilot needs a **new** instance under §4. CONSUMED instance in [`r4-gate-record.md`](r4-gate-record.md) §G6. |

**Gate summary:** G1/G2/G4/G5 ✅ static (G2/G5 recorded 2026-07-12 → [`r4-gate-record.md`](r4-gate-record.md),
[`decisions.md`](decisions.md) D-024). **G3 and G6 are per-run gates** ([`decisions.md`](decisions.md)
D-026) — both affirmed fresh in the dispatching turn, scoped to that one run, and consumed with it. A
read-only-probe instance of each was affirmed and **consumed 2026-07-12** (the §8-4 probe is complete), but
neither is ever standing: an **export pilot requires a fresh export-scoped G3 and a fresh per-run G6** in
the dispatching turn, not Runtime code. This pack records no live export action.

---

## §8-2 — Synthetic ladder (every §6 item, green on NAVER fixtures)

Offline hermetic suite at the baseline: **`npm test` → 2556 passed / 25 skipped** (the 25 skips = the
`RUN_INTEGRATION` browser suites + the gated real-backend CSV ingest test + the 3 gated
`naver-bridge-transport` cases + the 3 gated `naver-browser` cases). `typecheck` clean.

| §6 readiness item | Covering test(s) | Result |
|---|---|---|
| Session precondition probe | `naver-driver.test.ts` (`SESSION_EXPIRED`/`LOGIN_REQUIRED`), `naver-session-integration.test.ts` hostile matrix + reconnect-shaped persistence | ✅ fixture |
| Surface probe | `naver-driver.test.ts` zero-rows vs ambiguous → `UNSUPPORTED_STATE` diagnostic; session matrix | ✅ fixture |
| Target locator | `naver-driver.test.ts` 0/1/many/async/drift + opaque 16-hex sig; session matrix + drift → `UI_DRIFT` | ✅ fixture |
| Overlay + observation | `naver-browser.test.ts` automated + `AW_HEADED` human proof (see §8-3); highlight never intercepts | ✅ fixture (headed = §8-3) |
| Download detection (read-only) | `naver-driver.test.ts` real detect; `naver-session-integration.test.ts` (`DOWNLOAD_TIMEOUT`); `naver-browser.test.ts` real browser download | ✅ fixture |
| Artifact validation | `quarantine.test.ts` (16 — verdict matrix incl. delete-failure policy lock); `naver-*` `ARTIFACT_INVALID` cases | ✅ fixture |
| Ingestion handoff | `ingest-handoff.test.ts` (13); injected-upload cases in `naver-driver`/`naver-session-integration`; gated real-backend CSV in `upload.test.ts` (offline-skipped) | ✅ fixture / injected; real-backend gated |
| Operation Run persistence | `naver-session-integration.test.ts` persist/resume/resume-through-downstream/-ingest/`ARTIFACT_INVALID`-through-checkpoint | ✅ fixture |
| Bridge/FE loop | `naver-bridge-transport.test.ts` **3/3** (`RUN_INTEGRATION`) — full loop + agent cold-restart resume-through-downstream over the real Bridge WS via `createAgentBridge` | ✅ real WS (gated) |
| Privacy sweep | see §8-7 | ✅ |

**Per-suite counts (baseline):** `naver-driver.test.ts` 32 · `naver-session-integration.test.ts` 23
(incl. the new operator-abort drill) · `quarantine.test.ts` 16 · `ingest-handoff.test.ts` 13 ·
`local-agent-action-window-channel.test.ts` 10 · `naver-bridge-transport.test.ts` 3 (gated) ·
`naver-browser.test.ts` 3 (gated: 2 automated + 1 `AW_HEADED`).

**Live driver core (added post-pack, PR #242 `cf509a5`, 2026-07-12).** The `NaverLiveProbeDriver`
proves the NAVER-specific §6 seams on the LIVE driver itself — still **synthetic only, no live NAVER**:
`naver-surface.test.ts` (26) + `naver-live-driver.test.ts` (11) hermetic (session precondition/surface/
locate/verify/privacy over a fake page); `naver-live-browser.test.ts` (`RUN_INTEGRATION` — 2 automated
passed) drives locate-tag → overlay → observe → real download → quarantine
validate → injected ingest over a **real Chromium page with a synthetic DOM** (no marketplace markup/
tokens/seller data). This strengthens the §6 boxes for session/surface probe, target locator, download
detection, artifact validation, ingestion handoff, and privacy sweep; it does **not** wire the live driver
into a session/engine/Bridge/persistence loop (Operation-Run persistence and Bridge/FE loop stay on their
**fixture-driver** evidence). Authorizes no live action.

**Live-driver headed synthetic operator proof (2026-07-12).** The `naver-live-browser.test.ts` **headed**
case (previously skipped) **PASSED with a REAL seated-operator human click**. Command:
`RUN_INTEGRATION=1 AW_HEADED=1 npx vitest run test/action-window/naver-live-browser.test.ts -t "headed"`
→ **1 passed / 2 skipped** (the automated cases excluded by `-t`). The operator clicked the highlighted
synthetic "엑셀 다운로드" control **once** in the visible Chromium window; the Runtime never clicked. Sanitized
outcome: `waitForUserAction` observed the real click (run advanced only on the human action), `detectDownload`
fired a real download (opaque 16-hex ref), `validateArtifact` = `valid:true` with the quarantine dir emptied,
the **injected fake** ingest returned `{ok:true, processed:1}` (no backend, no network), and the no-leak sweep
+ `findProhibitedFields == []` were clean (no synthetic page string reached any result or the ingest ref).
**Synthetic-only: no live NAVER, no marketplace, no network, no seller data.** It proves the live driver's
real-browser **observe → download-detect → quarantine-validate → fake-ingest** seams; it **does not** exercise
the live session gate (`prepareSurface`, covered hermetically), the gated CLI's loopback/session/persistence
orchestration (covered hermetically in `test/cli/run-action-window-live-naver.test.ts`), or any live export —
it **does not prove live export readiness**. The headed test now carries an explicit per-test timeout
(`HEADED_TEST_TIMEOUT_MS`) so this command works without an ad-hoc `--testTimeout` flag; it stays skipped
unless `AW_HEADED=1`.

---

## §8-3 — Channel-fixture full loop, headed with a REAL human click

**Result: ✅ PASSED (2026-07-11), seated operator, real human click.** Command:
`RUN_INTEGRATION=1 AW_HEADED=1 npx vitest run test/action-window/naver-browser.test.ts` → **3/3 passed**
(2 automated headless + 1 headed human-click). The headed case ran ~17.75s (well under the 240s wait),
against the merged, byte-identical `naver-browser.test.ts` (`b3b9f0b`/`3cda125`).

Sanitized outcome of the headed case (NAVER-shaped synthetic review-export surface — new `fixture.ts`
`naver-review-export-xlsx` mode, zero marketplace trademarks/markup/seller data):

- `USER_ACTION_OBSERVED` — **received** (real human click; the Runtime never clicked); observation ≠ completion held.
- Run **COMPLETED** through the Runtime, progress **3/3**.
- `DOWNLOAD_DETECTED` — carried an **opaque 16-hex `artifactRef`** only.
- Quarantine dir — **empty** after (temporary save → OOXML sniff → DELETE held on the real filesystem).
- Privacy — `findProhibitedFields == []` + needle scan clean across every frame.

---

## §8-4 — Session-precondition LIVE probe

**✅ COMPLETED 2026-07-12.** One human-attended read-only run, executed under a **consumed one-run G6
read-only-probe approval** (the CONSUMED §G6 instance in [`r4-gate-record.md`](r4-gate-record.md)). It is
the ONLY permitted pre-pilot live contact; it answered its one question and stopped.

**Sanitized result** (verbatim fields only): `ready: true` · `verdict: LOGGED_IN` ·
`urlCategory: seller-center` (coarse sanitized category enum — not a raw URL) · **no `blockerCode`**
(absent when ready).

**Read-only guarantee held:** a human logged in; the probe read only the session precondition and
stopped. **No** locate/highlight, click, export, download, quarantine, ingest/upload/downstream, status
write, backend start, or DB touch occurred; nothing was sent to SellerOps; no raw URL/HTML/page
content/identity/credential/cookie/token/path was emitted (the same §8-7 sanitization contract).
Post-run side-effect check clean — probe process ended, sentinel removed, no download/quarantine
artifact, no tracked-file change. Fixture-level session probing remains covered under §8-2.

**Scope guard:** this **consumed the single G6 read-only-probe approval and is NOT an export pilot**. An
export pilot performs a real seller click + download + downstream and requires a **separate per-run G6
approval under the full §4 boundary**, given in that dispatching turn — this record grants none.

---

## §8-5 — Policy-track log state (§5)

| §5 item | State |
|---|---|
| Seller-tool / provider / API-partner program + prerequisites | ☐ not logged |
| Written ToS question (seller-controlled overlay + read-only download detection on the seller's own session) | ☐ not sent |
| Platform position on third-party tools assisting (not automating) export | ☐ not recorded |
| Coupang one-seller-tool-at-a-time constraint | N/A (not the pilot channel) |
| ESM+ provider onboarding | N/A (not the pilot channel) |
| **NAVER-specific** | **None required** for the seller-owned export pilot per §5; Solution Market remains a long-term option, not a prerequisite. |

Product-owner-owned; tracked outside the repo (D-019 parallel track). No platform is marked "approved" (matrix §3 rule).
**Logged 2026-07-12** as the G5/P8 evidence — the NAVER seller-owned export pilot requires no platform grant; see the
living register [`r4-gate-record.md`](r4-gate-record.md) §G5 ([`decisions.md`](decisions.md) D-024). Logging authorizes no live action.

---

## §8-6 — Abort drill (each fail-closed exit + operator-abort; all recovering per §7)

**Automatic fail-closed exits (zero clicks; blocker code; downstream never runs; sanitized):**

| Exit (blocker code) | Fixture shape / trigger | Test |
|---|---|---|
| `SESSION_EXPIRED` | reconnect-required surface | `naver-session-integration.test.ts` matrix + reconnect-persistence case |
| `LOGIN_REQUIRED` | login-required surface | `naver-session-integration.test.ts` matrix |
| `UNSUPPORTED_STATE` | empty-target / ambiguous readiness | `naver-session-integration.test.ts` matrix |
| `TARGET_NOT_FOUND` | no-target / async-affordance | `naver-session-integration.test.ts` matrix |
| `TARGET_AMBIGUOUS` | multi-target | `naver-session-integration.test.ts` matrix |
| `UI_DRIFT` | post-action target identity change | `naver-session-integration.test.ts` drift case |
| `DOWNLOAD_TIMEOUT` | verified action fires no download | `naver-session-integration.test.ts` real-downstream `none` shape |
| `ARTIFACT_INVALID` | wrong-extension / bad-magic / delete-failure | `naver-session-integration.test.ts` + `quarantine.test.ts` policy lock |

**Operator-abort:** `naver-session-integration.test.ts` — *"an operator cancel at the human checkpoint cancels
cleanly — no click, no downstream"* (**added by this pack slice**): `CANCEL_RUN` at the checkpoint →
status `CANCELLED`, `allowedCommands == []`, no `USER_ACTION_OBSERVED`/`DOWNLOAD_DETECTED`,
`downstreamCalls == {detect:0, validate:0, ingest:0}`, sanitized. (Also proven channel-neutrally over a real
Chromium at `session-browser.test.ts` operator-cancel drill.)

**Recovery per §7:** a `FAILED` run resumes fail-closed and completes once the cause clears — proven by
`naver-session-integration.test.ts` *"an `ARTIFACT_INVALID` failure resumes THROUGH the human checkpoint; a
fixed artifact completes"* and the persistence/resume block (resume-at-checkpoint, resume-through-downstream,
resume-through-ingest). `CANCELLED`/`COMPLETED` runs are terminal-protected (restore is read-only).

---

## §8-7 — Privacy sweep output (wire + persisted store)

**Result: ✅ clean (0 prohibited fields, 0 needle hits) across wire frames and persisted Operation Run records.**

| Surface | Scan | Result |
|---|---|---|
| Wire (every FE frame: events, views, command/resync results, `aw_session` announcement) | `findProhibitedFields(frame) == []` | ✅ 0 |
| Wire | `FORBIDDEN_NEEDLES` scan (fixture canaries, marketplace tokens, `엑셀`/`다운로드`, `aw-quarantine`, `.xlsx`, `[content_types]`, tmp paths) | ✅ 0 hits |
| Persisted store (Operation Run records, incl. resumed/final) | `findProhibitedFields(record) == []` + needle scan; `processed` count never persisted | ✅ 0 |
| Source guards | `naver-driver.test.ts` (no click/live/save/network/upload imports) · `quarantine.test.ts` (ONLY AW fs/`saveAs` module; no browser/network/parser/console; retention policy locked) | ✅ enforced |

Coverage: `naver-session-integration.test.ts`, `naver-bridge-transport.test.ts`, `naver-driver.test.ts`
privacy block, `quarantine.test.ts` source guard. The scans assert on every frame/record produced during the
happy loop, every hostile shape, resume, and the operator-abort.

---

## §8-8 — Export pilot result — RUN 1 EXECUTED 2026-07-13 · FAILED (fail-closed, zero clicks)

**The first supervised NAVER export pilot ran on 2026-07-13** under the export-scoped G6 filled that
session ([`r4-export-dispatch-record.md`](r4-export-dispatch-record.md); operator (PO), one-run scope on
`NAVER_DEV_SELLER_SELF_01`). The seated operator logged in and reached the export surface, then signalled
readiness. **The run fail-closed at the session/surface precondition — before any highlight and before any
click.** Sanitized result (enums/booleans/counts/SHA only):

- ☑ **G6 instance:** export-scoped, filled 2026-07-13, operator (PO), ONE run — now **CONSUMED / spent**
  (single-use; fail-closed does not refund it).
- ☑ **Final run view:** `{ status: FAILED, progress: { completedSteps: 0, totalSteps: 3 },
  channelCode: naver, blockerCode: UNSUPPORTED_STATE }`.
- ☑ **Tasks:** `[FAILED, SKIPPED, SKIPPED]`. **Human checkpoint:** `{ reached: false, observed: false }`
  — the human barrier was never reached, so **no control was highlighted, no action observed, no click**.
- ☑ **Engine events:** `RUN_STARTED → RUN_STATUS_CHANGED → RUN_BLOCKED → RUN_FAILED` — **no
  `DOWNLOAD_DETECTED`, no observed user action.**
- ☑ **Ingest outcome:** not reached — no artifact produced (`processed: 0`).
- ☑ **Quarantine:** dir empty (0 files); `downloads/` unchanged (0) — **nothing captured, saved, or
  uploaded.**
- ☑ **No-leak:** teardown clean — process exited, sentinel removed, browser context closed; nothing on
  the wire or in the store beyond the sanitized view above.
- ☑ **Operation Run id:** `run_f81fc0b19fdd` (`resumeState: RESUME_FROM_FAILURE`, resumable per R3).

**Diagnosis (honest — not resolved here).** `UNSUPPORTED_STATE` at the precondition maps to exactly two
branches of `naverSurfaceDecision`, and the diagnostic that distinguishes them is **test-visible only,
never persisted** (`naver-surface.ts` `NaverPrepareDiagnostic`), so the persisted record cannot say which:

1. **Session verdict `UNKNOWN`** — the reached page did not classify cleanly as seller-center `LOGGED_IN`,
   yet was not a recognized reconnect/login/auth-challenge screen (those map to `SESSION_EXPIRED` /
   `LOGIN_REQUIRED`, not `UNSUPPORTED_STATE`). Ambiguous → never proceed.
2. **`LOGGED_IN` but export-target readiness `≠ READY`** — a HALT on empty (`EXPORT_TARGET_EMPTY`) or
   ambiguous/range (`EXPORT_TARGET_UNKNOWN`); the same false-positive-empty family as the Milestone-D
   hidden-SPA-placeholder finding.

Determining which requires a **separate read-only surface probe** (`probe-export-same-session` /
`probe-same-session`, no click / no download) — itself a live launch needing its **own fresh per-run G6**.
No retry was performed; the consumed G6 authorized exactly one run.

**Fix follow-up (2026-07-13, offline — commit `e2be2e0`).** The likely branch-2 cause has a fix
implemented and hermetically proven, **not yet live-verified**: `NaverLiveProbeDriver` is now
**frame-aware**. `prepareSurface` reads the session verdict from the top document (the proven §8-4 seam,
unchanged), then `resolveSurfaceFrame` scores the top document + every child frame with the same shared
`naverSurfaceDecision` / `naverLocateDecision` decisions and evaluates **readiness on the frame that hosts
the export surface** (falling back to the top document); `locate` / `highlight` / `armObserve` /
`waitForUserAction` / `verify` / the in-page tag now run against that frame, while **download detection
stays page-level**. `overlay.ts` / `observer.ts` params widened to `Page | Frame` (backward-compatible).
Six new hermetic tests over a fake multi-frame page cover: the pre-fix baseline halt, a child-frame ready
surface → `ok`, a genuinely-empty child grid → honest `EXPORT_TARGET_EMPTY` halt (no false-positive),
picking the actionable frame among several, skipping a detached frame, and binding the tag in the child
frame only. `npm test` **2646 passed / 32 skipped**, typecheck clean. **The top-document path is unchanged
(fallback), so every existing test and the synthetic browser proofs are unaffected.** This is hermetic
only — confirming it against the REAL NAVER frame structure still needs the read-only frame-aware probe
(or the export re-run) under a **fresh G3-export + G6**.

> **⚠ CORRECTION (2026-07-13, §8-10) — the frame-aware fix does NOT address Run 1.** The read-only
> frame-aware probe (§8-10) **refuted** the child-frame hypothesis: NAVER's review grid **and** the single
> visible+enabled export control render in the **top document**; the one child frame is unrelated. So the
> readiness read was on the right document all along. `e2be2e0` remains a valid **general** robustness
> improvement (multi-frame surfaces do occur), but it is **not** the fix for the Run-1 `UNSUPPORTED_STATE`.
> The actual cause is a **false-positive empty readiness verdict** — see §8-10.

---

## §8-9 — Live-entrypoint assembly integration test (DELIVERED offline; execution pending approval)

**Purpose:** close the last offline seam — `assembleLiveRun(page, deps)`, the ONLY place a real
Playwright `Page` meets the engine, previously had **zero coverage** (the entrypoint was proven only
hermetically with a `FakeProbeDriver`; the real `NaverLiveProbeDriver` only standalone, §8-2/§8-3).

**Delivered:** `collector/test/cli/run-action-window-live-naver-browser.test.ts` — drives the entrypoint's
own `assembleLiveRun` + `driveOneRun` over a REAL Chromium page (100% synthetic, route-fulfilled locally
from a synthetic `commerce.localhost` host so the §8-4 session gate's seller-center URL check passes with
**no NAVER contact, no network**). Cases: automated happy loop (session gate → observed click → detect →
quarantine-validate → injected-fake ingest → **COMPLETED**, with the Operation Run **persisted TERMINAL**
via `loadOperationRun`); a hostile login page failing closed at the gate (`LOGIN_REQUIRED`, zero clicks,
no download, persisted FAILED); a non-OOXML download failing closed (`ARTIFACT_INVALID`, not ingested,
quarantine emptied, persisted FAILED); and a headed (`AW_HEADED=1`) real-human-click case.
⏩ **Forward-pointer added 2026-07-16 (A2-B / [D-028](decisions.md)) — this dated section is NOT amended.**
The hostile-login case above **no longer persists FAILED**: `LOGIN_REQUIRED` now **parks** recoverable
(`WAITING_FOR_HUMAN` / `recoverable: true`), and that gated test was updated to assert the park. What the
drill actually established is untouched and still true: **zero clicks, no download, nothing ingested.** The
`ARTIFACT_INVALID` case still fails closed exactly as recorded. See §8-20.
No-leak +
`findProhibitedFields == []` across frames, the persisted record, and the ingest ref. This is the first
proof that the live driver is **wired into a persistent session** (loopback channel — **not** the Bridge
WS).

**Status: ✅ automated PASSED (2026-07-12) + headed PASSED (2026-07-13), headless-launched.** Command:
`RUN_INTEGRATION=1 npx vitest run test/cli/run-action-window-live-naver-browser.test.ts` → **3 passed / 1
skipped** (the 3 automated cases; the `AW_HEADED` human-click case skipped) in ~1.3s. The happy case drove
the full engine chain through the real driver — session gate `prepareSurface` (LOGGED_IN over the
synthetic seller-center URL) → locate/tag → highlight → observed click → read-only detect → quarantine
validate (dir emptied) → injected-fake ingest → **COMPLETED**, with the Operation Run **persisted
TERMINAL**; both fail-closed cases persisted **FAILED** with the sanitized `blocker.code` only; no-leak +
`findProhibitedFields == []` clean throughout. **The headed (`AW_HEADED=1`) human-click case also PASSED
(2026-07-13):** with `… -t "headed"` (→ **1 passed / 3 skipped**, ~8.9s) a seated operator clicked the
highlighted synthetic "엑셀 다운로드" once — the click was **observed** (the Runtime never clicked) → verify
→ detect → quarantine validate → injected-fake ingest → **COMPLETED**, Operation Run **persisted TERMINAL**,
`findProhibitedFields == []` clean. **No live NAVER, no network, no
backend.**

---

## §8-10 — Read-only frame-aware surface probe (Run-1 diagnosis) — EXECUTED 2026-07-13

**The read-only frame-aware probe (`probe-export-same-session`) ran once on 2026-07-13** under an
in-session read-only-scoped G6 ([`r4-probe-dispatch-record.md`](r4-probe-dispatch-record.md); operator (PO)),
to diagnose the Run-1 `UNSUPPORTED_STATE` (§8-8). Structurally read-only: **no click / export / download /
status write** (source-guarded); the seller logged in and reached the review-management export surface, then
signalled readiness; the probe read sanitized per-frame signals over the top document + every child frame.
Clean teardown (process exited, sentinel removed, `downloads/` + quarantine empty). Sanitized result
(enums/booleans/coarse buckets only — no URL, content, selector, or count):

- **Session:** `sessionVerdict: LOGGED_IN`. **Frames:** `frameCount: few`, one child frame.
- **Top document** (`urlCategory: seller-center`, `reviewRouteLike: true`): **`exportCandidateCount: one`,
  `visibleExportCandidateCount: one`, `enabledExportCandidateCount: one`** — the single export control is
  in the top document, visible + enabled. `tableGridListCount: many`, `dateInputCount: some`,
  `excelLike: true`, `downloadLike: true`, `iframeCount: one`, `shadowRootHostCount: none`.
- **The one child frame:** `frameUrlCategory: other`, every export/grid/review signal `none`/`false` —
  an **unrelated** frame (not the review surface).

**Finding — the child-frame hypothesis is REFUTED.** The review grid + export control are in the **top
document**, not a child frame. The frame-aware fix `e2be2e0` therefore does **not** address Run 1 (it stays
a valid general robustness improvement; see the §8-8 correction).

**Root cause of Run 1 — a FALSE-POSITIVE empty readiness verdict (operator-confirmed).** The operator
confirmed **review rows were visibly listed on screen**, yet `evaluateExportTargetReadiness` halted. Its
`countDataRows` matches **only** `<tbody><tr>` + `role="row"` and found zero — so NAVER's visible rows are
**neither** (a div-based / virtualized grid the counter doesn't recognize), while grid containers *are*
present (`tableGridListCount: many`). Readiness returned `EXPORT_TARGET_EMPTY (zero_rows)` /
`EXPORT_TARGET_UNKNOWN` → `UNSUPPORTED_STATE`, despite real exportable rows. This is the Milestone-D
"false-positive empty on a hidden/SPA grid" family, now pinned to the **row-shape recognition** in the
readiness gate — **not** frames, not session.

**Next (not yet done; §6 forbids speculative marker tuning — correct from evidence only):** (1) offline —
extend the sanitized probe with a coarse **data-row-like** signal recognizing more row structures
(`role="row"` / grouped `role="gridcell"` / repeated row-children under a grid/list container), distinct
from `tableGridListCount`; (2) one read-only live probe (fresh G6) to identify NAVER's actual row shape;
(3) offline — correct `export-target-readiness.ts` row detection from that observed shape. **Design choice
(PO decision):** alternatively **relax** the readiness gate (accept a visible+enabled export control + grid
container as READY and rely on the existing download-detection fail-closed for a genuinely-empty click).
The read-only G6 for this probe is **consumed**; any further live contact needs a fresh G6.

> **⚠ CORRECTION (2026-07-13, §8-11) — the row-shape-miss root cause is REFUTED.** The offline
> **data-row-like** signal from step (1) was implemented (commit `802f0a0`) and the read-only row-shape probe
> from step (2) was run (§8-11). It found `semanticRowCount: many` **and** `dataRowLikeCount: many` on the
> top document — **zero gap**. `countDataRows` (which `semanticRowCount` mirrors exactly) **would** have
> counted rows at that moment, so Run 1's empty verdict was **not** a div/virtualized row-shape the counter
> misses. The diagnosis widens to a **render-timing** issue — see §8-11. Step (3) (correct row detection) is
> therefore **not** the Run-1 fix.

---

## §8-11 — Read-only row-shape probe (Run-1 row-shape hypothesis) — EXECUTED 2026-07-13 · hypothesis REFUTED

**The read-only frame-aware probe (`probe-export-same-session`, unchanged CLI) ran once on 2026-07-13** under
a **fresh in-session read-only-scoped G6** (now consumed;
[`r4-rowshape-probe-dispatch-record.md`](r4-rowshape-probe-dispatch-record.md); operator (PO)), to measure the
row-shape gap the §8-10 "false-positive-empty" diagnosis predicted. The probe now emits two additional
sanitized signals (commit `802f0a0`): **`semanticRowCount`** (a coarse bucket that mirrors the readiness
gate's `countDataRows` — `<tbody><tr>` / `role="row"` only) and **`dataRowLikeCount`** (a **superset** also
recognizing `aria-rowindex`, `data-row*` attrs, `role="listitem"`, and row/list-item class tokens). A **gap**
(`semanticRowCount` low, `dataRowLikeCount` high) would have confirmed a div/virtualized row shape the gate
misses. Structurally read-only (**no click / export / download / status write**, source-guarded); the seller
logged in and reached the review-management export surface with the review list rendered on screen, then
signalled readiness. Clean teardown (process exited, sentinel removed, `downloads/` + quarantine empty).
Sanitized result (enums/booleans/coarse buckets only — no URL, content, selector, or count):

- **Session:** `sessionVerdict: LOGGED_IN`. **Frames:** `frameCount: few`, one child frame.
- **Top document** (`urlCategory: seller-center`): **`semanticRowCount: many`** and **`dataRowLikeCount: many`
  — a ZERO gap.** Both row estimators saw many rows. Context (consistent with §8-10): `tableGridListCount:
  many`, `exportCandidateCount: one` / visible `one` / enabled `one`, `dateInputCount: some`,
  `downloadAttributeCount: none`, `shadowRootHostCount: none`, `excelLike/downloadLike/reviewLike/searchLike:
  true`.
- **The one child frame:** `frameUrlCategory: other`, row signals `none`/`none` — the same **unrelated** frame
  as §8-10.

**Finding — the row-shape-miss hypothesis is REFUTED.** Because `semanticRowCount` mirrors `countDataRows`
exactly and it read **`many`**, the readiness gate **would have counted rows at this moment** — it would have
returned READY, not `EXPORT_TARGET_EMPTY`. So Run 1's false-positive-empty was **not** caused by NAVER
rendering div-based / virtualized rows the counter can't see (the §8-10 root cause). The offline row-shape
signal (`802f0a0`) stays a **valid general robustness signal** — and it is exactly what let us measure and
**refute** this hypothesis — but, echoing the §8-8 frame-fix correction, it is **not** the Run-1 fix target.

**Widened diagnosis — a readiness TIMING issue (leading hypothesis, not yet proven).** The rows are semantic
and countable **once the SPA has rendered them**. Run 1's live driver most likely evaluated
`evaluateExportTargetReadiness` on the surface HTML **before** the client-side grid finished rendering →
zero rows at that instant → `EXPORT_TARGET_EMPTY`. The probe read **after** the operator confirmed the list
was on screen, so it saw the settled DOM. This is a **render-timing** gap, not a row-shape gap.

**Next (DELIVERED offline — see §8-12):** the offline readiness **wait/timing** slice is now implemented —
before deciding readiness, the live driver waits for the row grid to render (a bounded read-only settle) and
re-evaluates, rather than widening the row counter. A further read-only probe (fresh G6) to confirm the
none → many transition on the real surface remains a **future** step (not required for the offline fix).
**No** readiness-gate (`export-target-readiness.ts`) code was changed.

---

## §8-12 — Readiness render-timing settle (DELIVERED offline; live confirmation pending a fresh G6)

The §8-11 render-timing hypothesis is now addressed **offline**. A NEW pure read-only primitive
`settleExportSurface` ([`export-surface-settle.ts`](../../collector/src/naver/export-surface-settle.ts)) polls
the resolved surface frame read-only on a bounded cadence and resolves as soon as the surface **DECIDES**:

- **rows rendered** (readiness `READY`, or a positive labeled count) → proceed;
- an **EXPLICIT** empty-state / no-export-target marker, or a "select a date range" instruction → halt now
  (a trustworthy empty — NAVER rendered a real "리뷰가 없습니다" / range prompt, not a mid-hydration blank);
- a **bare empty container** (`EXPORT_TARGET_EMPTY / zero_rows`) **or** an ambiguous surface → **PENDING**:
  keep polling. Trusting a bare empty container here is EXACTLY the Run-1 false-positive-empty, so it
  deliberately does not. At timeout the last observation is returned, so the driver **fails closed honestly**
  (waited the full window, rows never rendered → halt).

Wired into `NaverLiveProbeDriver.prepareSurface` on a **`LOGGED_IN`** session only (login/reconnect
interstitials never hydrate into a surface → decided immediately, no wasted window). The shared
`naverSurfaceDecision` **and** the readiness gate `export-target-readiness.ts` are **unchanged**, so the
sanitization contract and the fixture driver's single-shot path are byte-identical; only the live driver
gains the settle. Defaults: an 8 s window / 500 ms cadence, both injectable (with an instant `sleepFn`) for
hermetic tests.

**Hermetic proof (no browser, no live NAVER):**
[`export-surface-settle.test.ts`](../../collector/test/naver/export-surface-settle.test.ts) (20 tests) —
classify mapping across the full readiness union, an empty→rows hydration settling `READY` mid-window, an
explicit marker halting on check 1 (no polling), a bare-empty/ambiguous surface failing closed only at
timeout, read-error recovery, and dependency injection; `naver-live-driver.test.ts` (+3 tests) — a surface
that reads empty then renders rows now settles to `ok` (was `UNSUPPORTED_STATE`), a persistently-empty
surface still fails closed, and an unusable session decides without polling. `typecheck` clean; offline
`npx vitest run` **2677 passed / 32 skipped**; no readiness-gate / contract / FE / backend / package change.

**STILL OFFLINE — not live-verified.** This closes the offline half of the §8-11 diagnosis. A live
confirmation — that the settle actually flips `none → READY` on the real NAVER surface within the window
(and does not merely wait out genuinely-empty pages) — needs a **fresh export-scoped G6** (merged as PR #250).

> **⚠ CORRECTION (2026-07-14, §8-13) — the live confirmation FAILED; the settle is NOT the Run-1 fix.**
> Run 2 (§8-13) ran the settle live and reproduced Run 1's `UNSUPPORTED_STATE` at `prepareSurface`. The
> settle is a valid offline robustness primitive (and all its hermetic tests stand), but it does **not**
> resolve the live false-positive-empty. See §8-13 for the leading cause (empty-marker precedence).

---

## §8-13 — Live Run 2 (settle verification) — EXECUTED 2026-07-14 · FAILED · settle NOT the fix

**Run 2 ran the settle fix live** under a fresh export-scoped G3/P6/G6 in an **observe-only, no-click**
posture (operator/PO decision — [`r4-run2-settle-verification-dispatch-record.md`](r4-run2-settle-verification-dispatch-record.md)):
the seller logged in and reached the review-export surface with the review list rendered; the Runtime ran
`prepareSurface` (settle active, 8 s default window) and would have highlighted the control and parked at
`WAITING_FOR_HUMAN` **iff** readiness passed. It did not.

- **Sanitized result:** `status: FAILED` · `progress: { completedSteps: 0, totalSteps: 3 }` ·
  `channelCode: naver` · `blockerCode: UNSUPPORTED_STATE` — **identical to Run 1** (§8-8). The highlight
  never appeared; the run failed closed at `prepareSurface`.
- **Non-mutation (as scoped):** failed at step 0 → **no click, no download, no validate, no ingest, no
  backend contact, no DB write, no status/`LAST_SUCCESS`**. Clean teardown (sentinel removed, `downloads/`
  + `.aw-quarantine` empty, browser closed, git clean). G6 consumed.

**Finding — the settle fix is REFUTED as the Run-1 fix.** It passed every offline/hermetic test (§8-12) but
did **not** flip the live failure. Echoing the §8-8 frame-fix correction: a green offline seam is not a live
fix. The settle stays a valid general robustness primitive; it is **not** the Run-1 solution.

**Leading hypothesis (UNPROVEN — §6 forbids a speculative patch).** The §8-11 probe and the readiness gate
run **different** logic. §8-11 measured only row buckets (`semanticRowCount`/`dataRowLikeCount` via
`extractExportProbeSignals`) and inferred READY. But `evaluateExportTargetReadiness` checks empty-state /
no-export-target **markers first (precedence 1)**, *before* counting rows — and the settle treats an
explicit marker as a **trusted halt** (resolves on check 1). So a hidden / off-screen empty phrase on the
live surface would halt `prepareSurface` immediately **regardless of rendered rows**, which fits the fast
fail. §8-11's "`countDataRows` would have counted rows → READY" inference never measured this branch and was
likely wrong.

**Next (needs kickoff; evidence-not-speculation):** a read-only probe that emits the sanitized **live
`evaluateExportTargetReadiness` decision + reason + state** (which branch fired — `empty_state` /
`no_export_target` / `zero_rows` / `ambiguous`), so the *actual* cause is observed before any gate change.
Only then correct the gate/settle from that evidence. Requires an offline probe extension + a fresh
read-only G6.

> **✔ RESOLVED (2026-07-14, §8-14).** That probe ran. The leading hypothesis above is **CONFIRMED**: the
> live surface HALTed at `empty_state_marker` while its own `semanticRowCount` was `many` — a marker masks a
> populated grid. See §8-14 for the sanitized evidence and the evidence-based fix direction.

---

## §8-14 — Read-only readiness-branch probe (Run-2 cause) — EXECUTED 2026-07-14 · ROOT CAUSE CONFIRMED

**The probe from §8-13's "Next" ran** under a fresh read-only G3 lift + single-use G6 (dispatch record:
[`r4-readiness-branch-probe-dispatch-record.md`](r4-readiness-branch-probe-dispatch-record.md)). It uses the
readiness-branch instrumentation (commit `fa5c931`): the read-only frame-aware probe now emits, per frame,
the gate's verbatim `readiness` (decision / state / reason) **plus `readinessBranch`** (which precedence rung
fired). The seller logged in and reached the review-export surface with the list rendered; the probe read the
top document + every child frame once and emitted sanitized signals. `sessionVerdict: LOGGED_IN`.

- **Export-surface frame** (top document — the frame with the visible + enabled export candidate,
  `exportCandidateCount: one`, `excelLike`/`downloadLike` true):
  - `readinessBranch: empty_state_marker`
  - `readiness: HALT · EXPORT_TARGET_EMPTY · empty_state`
  - `semanticRowCount: many` · `dataRowLikeCount: many`
- **Child frame (`other`):** a non-export utility frame — no candidates, `readinessBranch:
  ambiguous_no_signal`. Not the surface.

**Finding — CONFIRMED root cause: `empty_state_marker` precedence.** The gate's own row counter sees `many`
rows on the surface frame (rung 3 would return `READY / positive_rows`) but **never reaches rung 3**: rung 1's
empty-state marker short-circuits and HALTs. A "no results"-style placeholder coexists in the DOM with a
**fully populated** review grid, and the marker precedence wrongly outranks the positive row evidence. This is
the Run-1 (§8-8) and Run-2 (§8-13) `UNSUPPORTED_STATE` cause, now observed live.

**Competing explanations ruled out by the same read:**
- NOT div-grid / virtualized rows the gate can't count — `semanticRowCount` is `many`, not `none`.
- NOT a frame-resolution bug — the surface frame IS the top document and carries both the rows and the
  candidate.
- NOT the render-timing gap — the surface was never row-empty, which is exactly why the settle (§8-13) could
  not fix it: it waited for rows that were already present while a marker masked them.

**Non-mutation:** read-only frame reads only; no click / download / validate / ingest / backend / DB / status
/ `LAST_SUCCESS`. Clean teardown (sentinel auto-removed, `.status/` empty, no `downloads/`, context closed,
git clean). G6 consumed.

**Next (evidence-based offline slice — NOT a speculative patch, per §6).** Correct
`evaluateExportTargetReadiness` so positive row/count evidence **outranks** the empty-state marker: either
move the row/labeled-count checks ahead of the marker rung, or require the empty-state node to be the
**visible** state (the placeholder is almost certainly present-but-hidden while the grid is populated — a
common SPA pattern). Design + hermetic tests offline (incl. a marker-coexists-with-populated-grid fixture,
the exact live shape), then re-verify live under a fresh G6. The settle stays a general robustness primitive
but is not this fix.

> **✔ DELIVERED offline (2026-07-14, §8-15) → ✔ LIVE-VERIFIED (2026-07-14, §8-16).** The precedence fix is
> implemented + hermetically tested (local commit `0ee3b6e`) AND confirmed on the real surface by Run 3:
> `prepareSurface` passed readiness and reached the human barrier. The §8-14 readiness false-empty is
> resolved live. See §8-15 (fix) and §8-16 (live verification).

---

## §8-15 — Readiness precedence fix (positive evidence outranks markers) — DELIVERED offline 2026-07-14 · LIVE-VERIFIED (§8-16)

**The §8-14 fix is implemented** (local commit `0ee3b6e`, HELD): `traceExportTargetReadiness` /
`evaluateExportTargetReadiness` were reordered so **positive row/count evidence outranks the empty-state
markers**. New precedence: (1) labeled count > 0 → `READY / positive_count`; (2) **real data rows present →
`READY / positive_rows`** (the fix); (3) no-export-target notice → HALT; (4) empty-state marker → HALT; (5)
labeled count == 0 → HALT; (6) results container / zero rows → HALT; (7) required-range → HALT; (8)
ambiguous → HALT.

- **Placeholder guard (`countPlaceholderBodyRows`).** An in-table empty-state row
  (`<tr><td colspan>…없습니다</td></tr>`) is itself counted as a row, so marker-bearing `<tbody>` rows are
  subtracted: `realDataRows = countDataRows − placeholderRows`. A populated grid + hidden marker now reads
  READY; a **lone placeholder row still HALTs** (subtraction floors at 0 → falls through to the marker
  rung); no arbitrary threshold, and a single-review store still reads READY. A latent stateful-regex bug
  was fixed en route (a non-global inline `<tr>` test; the shared `TR_RE` is `/g`).
- **Blast radius:** `export-probe.ts` is UNCHANGED — it re-emits the gate verbatim, so the fix flows
  through the read-only probe with no probe-code change. Still conservative: ambiguity never clicks, and a
  false READY that clicks into nothing is caught **fail-closed** by download detection downstream.
- **Offline verification:** `typecheck` clean; offline suite **2702 passed / 32 skipped** (+9 net tests) —
  new cases cover populated-grid-plus-hidden-marker → READY, the live "many rows + marker" shape → READY
  `many`, positive count + marker → READY, role=grid rows + marker → READY, placeholder subtraction (1 real
  + 1 placeholder → bucket `one`), a lone placeholder → HALT, and a regression loop proving genuinely-empty
  surfaces (all marker/count/zero-rows shapes) **still HALT**.
- **Status: LIVE-VERIFIED for the readiness gate (2026-07-14, §8-16).** ~~OFFLINE-verified only.~~ Run 3
  drove the fix on the real surface: `prepareSurface` PASSED readiness and reached the human barrier
  (`progress 2-of-3`, highlight on the Excel control), replacing the Run-1/Run-2 `UNSUPPORTED_STATE`
  (`0-of-3`). The §8-14 **readiness false-empty is resolved live.** (The click → download → validate →
  ingest legs remain unproven — a separate full-pilot authorization; see §8-16.)
- **PO design choice (resolved by evidence):** the targeted gate-precedence fix is confirmed live and
  adopted; the alternative "fully relax the gate" route is not needed. (It remains available if a future
  surface shows the precedence fix insufficient.)

---

## §8-16 — Live Run 3 (precedence-fix verification) — EXECUTED 2026-07-14 · FIX CONFIRMED LIVE

**Run 3 drove the §8-15 precedence fix on the real surface** under fresh G3/P6/G6 in an **observe-only,
no-click** posture ([`r4-run3-precedence-fix-verification-dispatch-record.md`](r4-run3-precedence-fix-verification-dispatch-record.md)):
the seller logged in and reached the review-export surface with the list rendered; the Runtime ran
`prepareSurface` (fixed readiness) → `locate` → `highlight` and reached the human barrier. The seller did
**not** act on the export control.

- **Sanitized terminal result:** `status: FAILED` · `progress: { completedSteps: 2, totalSteps: 3 }` ·
  `channelCode: naver` · `blockerCode: DOWNLOAD_TIMEOUT`.
- **The discriminator (vs. §8-8 Run 1 / §8-13 Run 2):** `completedSteps` rose **0 → 2** and the blocker moved
  from the readiness gate (`UNSUPPORTED_STATE`) to the benign no-click download-detect step
  (`DOWNLOAD_TIMEOUT`). **`prepareSurface` no longer halts on the populated-grid-with-marker surface** — the
  precedence fix reads it `READY / positive_rows`. Operator-confirmed corroboration: the **guide/highlight
  overlay appeared on the Excel download control** (Runs 1–2 never reached highlight).
- **`DOWNLOAD_TIMEOUT` is the expected, benign observe-only terminal.** `driveOneRun` auto-arms the download
  observer after the barrier; with no click → no download, detect fails closed (~60 s). A `FAILED` terminal
  is correct — the run *should* fail closed when the seller does not click; the target was "does readiness
  stop blocking?", not "COMPLETED".
- **Non-mutation:** `DOWNLOAD_TIMEOUT` at detect ⇒ no download captured → no validate → no ingest → no
  backend / DB / status / `LAST_SUCCESS`. Clean teardown (sentinel auto-removed, `.status/` empty, no
  `downloads/`, no `.aw-quarantine/`, browser closed, process exited, git clean). G6 consumed.
- **What this proves / does NOT prove.** PROVES: the §8-14 readiness false-empty is **resolved live** — the
  fix advances a genuinely-populated surface past the readiness gate to the human barrier. Does NOT prove:
  the click → download → quarantine-validate → **real `/api/uploads` ingest** path — deliberately out of
  scope (observe-only). A full export pilot needs a **new P6 + export-scoped G6** under the full §4 boundary.

---

## §8-17 — Live Run 4 (full export pilot) — EXECUTED 2026-07-15 · **COMPLETED · END-TO-END PROVEN**

**Run 4 drove the FULL export path on the real surface** under fresh, full-scope G3 (export **+ ingest**
lift) / P6 (full pilot) / G6 ([`r4-run4-full-export-pilot-dispatch-record.md`](r4-run4-full-export-pilot-dispatch-record.md)) —
the one leg §8-16 deliberately left unproven. Preconditions verified read-only first: `baseUrl` →
`http://localhost:8080` (local dev, **never production**; `NODE_ENV` unset), backend UP (`GET /health` → 200),
started via `cd backend && ./gradlew bootRun` against the existing Flyway-migrated local `sellerops` DB.

- **Sanitized terminal result:** `status: COMPLETED` · `progress: { completedSteps: 3, totalSteps: 3 }` ·
  `channelCode: naver` · **no blocker**.
- **Backend ingest:** `status: SUCCESS` · **totalRows 55 / successRows 55 / skippedRows 0 / failedRows 0** —
  a clean **first ingest** (+55; not a dedup no-op, so the dedup-awareness precondition held).
- **The full chain now works live:** `prepareSurface (READY — the §8-15 fix) → locate → highlight → [seller
  click + confirm dialog] → real download → read-only detect → quarantine-validate (OOXML sniff) → real
  `/api/uploads` ingest → COMPLETED`.
- **Privacy posture held under a REAL file:** the wire filename was the opaque `aw-<artifactRef>.xlsx` —
  NAVER's suggested filename was never uploaded. The AW view emitted only `status`/`progress`/`channelCode`.
  The quarantined real export was validated then **deleted** (D-021 posture), quarantine empty afterwards.
- **🔎 Choreography finding (observed, feeds §7 + future runs):** the NAVER export is a **TWO-step** human
  action — the highlighted-control click raises an **expected confirmation dialog** the operator must
  manually confirm, and **the download fires only on that confirmation**. Both steps must land inside the
  ~60 s `detectDownload` window (`DOWNLOAD_TIMEOUT_MS = 60_000`). The dialog is **expected/recognized** and is
  **NOT** a §7 abort trigger; §7's "unrecognized prompt/dialog → abort" rule still applies to everything else.
  The Runtime performs neither step — it only observes (no auth bypass, no Runtime-performed export).
- **⚠ MUTATION (as authorized):** 55 real test-seller review rows are now in the **local dev** backend DB.
  **Not reversible by the Runtime.** This was the explicit scope of the full-pilot P6 + export-scoped G6,
  both now **consumed** — any further live contact needs fresh ones.
- **Teardown:** quarantine + `downloads/` empty, sentinel removed, browser closed, process exited, git clean.

**What the §8-8 → §8-17 arc establishes.** Run 1 `UNSUPPORTED_STATE` 0-of-3 → the settle refuted live (§8-13)
→ root cause confirmed by observation, `empty_state_marker` precedence (§8-14) → precedence fix (§8-15) →
readiness live-verified 2-of-3 (§8-16) → **full export→ingest `COMPLETED` 3-of-3 (§8-17)**. The NAVER
supervised export pilot is **proven end-to-end on the real surface**.

**Follow-up RESOLVED (offline slice, 2026-07-15).** The §8-17 note — `upload.done` carrying exact row counts —
is closed. Scope was narrower than the note implied, and one part of it was **mis-stated**:

- **Never reached the wire.** `upload.done` is not a contract event (absent from `contracts/action-window/v1/`);
  it is a **dev log line** with one emission site. The sanitization boundary (`sanitizeBackendIngest` →
  `{ ok, processed }`) sits one layer *downstream*, so the exposure was terminal/log output only. The engine
  and AW view were correct throughout, and Run 4's `COMPLETED` result is unaffected.
- **Correct citation:** the binding rule is **`collector/CLAUDE.md` §4 item 3** ("never … exact amounts/
  counts"), not "§3" — `r4-preparation.md` §3 is the G1–G6 gate section. §4 item 4 explicitly names "log" as a
  bound surface.
- **Correction to §8-17's wording:** the note said the log carried "exact row counts **+ the opaque filename**".
  The filename is opaque **only on the Action Window path** (`neutralUploadName(artifactRef)` → `aw-<hex>.xlsx`).
  The `uploadReviewFile` wrapper passes `basename(filePath)`, so the capture / diagnostic / manual CLIs logged a
  **real seller-center export basename** (store/date identity) — a sharper §4.3 concern than the counts.

**Fix (offline-verified only; no live re-run, no wire/behavior change):** `upload.done` now emits the backend
status enum + four `RowCountBucket`s and **no filename**; the sibling `item-analysis.count` emits a bucket. Both
functions still **return** exact counts — callers fold them themselves. The bucket definition moved to a new
zero-import leaf `collector/src/row-count-bucket.ts` (`upload.ts` cannot import `review-upload-diagnostic.ts`,
which imports `../upload` — that edge would be a cycle); `review-upload-diagnostic.ts` re-exports it as
`countBucket`, so its public surface is unchanged. `esm/esm-review-schema-shape.ts` keeps an identical private
copy — folding the esm family in is a separate slice. The old test asserted the counts were *present*; it is
replaced by an exact key allow-list (a `toContain("successRows")` sweep would have passed against
`successRowsBucket` and proved nothing).

---

## §8-18 — Live Run 5 (barrier + observation) — EXECUTED 2026-07-16 · **`USER_ACTION_OBSERVED` LIVE-PROVEN** · non-mutating

**Run 5 drove a real click that deliberately never confirmed**, under a fresh Run-5-scoped G6 + a real-click-scoped
G3 pause lift + a barrier-and-observation P6 ([`r4-run5-barrier-observation-dispatch-record.md`](r4-run5-barrier-observation-dispatch-record.md)).
It answers the one question `40d7c53` could not: **the fix was offline-proven only, and the in-page click listener
(`observer.ts`) had never once fired on a live run.** Preconditions verified read-only first: backend **DOWN**
(no listener on 8080, connection refused — deliberate, defense-in-depth against an accidental confirmation),
`RUN_INTEGRATION` / `AW_HEADED` / `NODE_ENV` all unset, both commits under test present on `HEAD` (`ccd9597`).

- **THE HEADLINE — `aw.live.barrier { observed: true }`.** **The in-page listener fires on a real NAVER click.**
  First time ever, on any live run. The `40d7c53` barrier fix is **live-proven**, and `humanCheckpoint.observed`
  is a **real audit record** for the first time — it was `false` on every prior live run including Run 4 (§8-17).
- **The store agrees.** Operation Run **`run_a911f3c6799c`** persists `humanCheckpoint.observed: true`, matching the
  log line. This was the P0 check: a disagreement between the emitted line and the persisted record would have meant
  the audit trail lies. It does not.
- **Sanitized terminal result:** `status: FAILED` · `progress: { completedSteps: 2, totalSteps: 3 }` ·
  `channelCode: naver` · `blockerCode: DOWNLOAD_TIMEOUT` — the §8-16 Run 3 shape. **The expected success condition,
  not a fault:** the seller clicked and then deliberately let the detect window lapse.
- **🔎 The two-window timing is live-confirmed too.** The timeout fired **~60 s after the barrier observation**, not
  60 s after the highlight. `DOWNLOAD_TIMEOUT_MS` now starts at the **click**, exactly as `40d7c53` intended — so the
  operator budget really is two windows (observe, then ~60 s), and §8-17's combined ~60 s is **no longer the live truth**.
- **`aw.live.readiness` — the first machine evidence of the live period/scope state:**
  `verdict: LOGGED_IN` · `readinessDecision: READY` · `readinessReason: positive_count` ·
  `readinessBranch: labeled_count_positive` · `selectedRangePresent: false` · `dateRangeControlPresence: some`.
- **Period/scope — operator-confirmed, and consistent.** The operator **did not select a review period/scope** before
  signalling ready. `selectedRangePresent: false` **agrees with that operator state** — this is a true negative, **not**
  a detector false-negative (the failure class that cost Runs 1–3; §8-14).
  **Readiness still passed without requiring a selected range**, and the branch shows the mechanism: rung 1
  (`labeled_count_positive`) fired on a labeled positive row count and **short-circuited before any date-range rung
  could evaluate**. So the gate did not weigh period/scope and decline to care — **it never reached the question.**
  ⚠ This means `EXPORT_DATE_RANGE_REQUIRED` is dead for a **structural** reason, not merely an unused one: on any
  surface with countable rows, rung 1 wins first and the date rung is unreachable. **Whether that is a defect or
  correct-by-design is a product-owner decision — recorded here, deliberately not resolved.**
  **↳ RESOLVED 2026-07-16 → [D-025](decisions.md): correct-by-design.** Period/scope is a **guidance-only §4 human
  precondition**; the gate answers *exportability*, never *scope*. **And the mechanism above is narrower than the
  truth** (established offline while planning D-025, not by this run): rung 1 explains **Run 5's path**, but the
  **structural bound is rung 6** (`results_container_zero_rows`). Reaching the date rung requires **no
  `<table>`/`<tbody>`/`role=grid|table|rowgroup` anywhere in the document** — so a review grid halts before it at
  **any** row count, including zero, not merely when a count is positive. The rung stays reachable only on a
  container-free surface (which is why the offline fixture still fires it); it is now **locked by test** so a future
  rung reorder trips a suite instead of silently waking a gate.
- **⚠ The `selectedRangePresent` detector remains UNPROVEN in the positive direction.** One true negative is not
  validation. Whether it correctly reports `true` when a range **is** selected is untested live. **Per
  `collector/CLAUDE.md` §6 the markers stay placeholders** — this run is not the observed finding that promotes them.
  A future run that selects a range settles it cheaply.
  **↳ CORRECTION 2026-07-16 (D-025).** This bullet originally argued *"a detector hardwired to return `false` would
  have produced this identical result."* **That is false and is withdrawn** — offline we *know* the detector is not
  hardwired (`export-click-signals.test.ts` drives it to `true` on both its branches). **The true concern is stronger
  and more specific:** the filled-range regex matches the `value` **attribute** in serialized HTML, but every live
  read is `page.content()` and a user- or JS-set input value updates the IDL **property**, leaving the attribute
  untouched. On an SPA date picker — which this run's `dateRangeControlPresence: "some"` (6–20 date-ish controls)
  suggests — the detector may be **structurally incapable of ever returning `true`**. That is what makes promoting it
  to a readiness blocker a plausible **100% halt rate** rather than a rare false halt. The blind spots are now
  characterized by offline test; only a live run with a selected range can close the direction.
- **`dialogMatchesRecordedConsentMarkers: NOT_OBSERVED.`** The operator eyeball was **not returned** for this run.
  **HANDOFF's open question — whether the Run 4 dialog is the copyright/usage consent recorded in
  `export-click-signals.ts` — therefore remains OPEN, in neither direction.** Recording a guess here would have
  fabricated the exact finding the field exists to establish. The run's headline never depended on it.
- **Non-mutation — verified, not assumed:** `downloads/` **0 entries**; **no quarantine directory was ever created**;
  the backend was **never reachable** (connection refused before *and* after the run) and `/api/uploads` was never
  called. No download → no validate → no ingest → no DB write, no status, no `LAST_SUCCESS`. Sentinel auto-removed,
  browser closed, process exited clean (exit 0). **G6 consumed.**
- **🔎 Finding (reported, NOT fixed): the operator-facing run-time prose is STALE and contradicted this run's scope.**
  `CONFIRM_PROMPT` (`cli/run-action-window-live-naver.ts`) instructs the operator to **"manually confirm the expected
  NAVER confirmation dialog"** and states **"from the moment the highlight appears you have about 60 SECONDS"** for both
  steps. The first **tells the operator to do the exact thing Run 5 forbids**; the second was made false by `40d7c53`
  (see the two-window note above). It was rewritten in `4c6d1ac` **before** the barrier fix landed and never revisited.
  The operator was warned pre-launch and ignored it. **Not fixed during the run** — a code change would have invalidated
  the offline verification the G6 rested on.
  **↳ FIXED 2026-07-16 (D-025 rewrote it; A1/§8-19 made it policy-derived).** The prompt is now
  `confirmPrompt(declineIngest)`: timings are interpolated from the constants, the confirm choice is deferred to the
  run's approved scope, and the ingest claim is derived from what THIS run will do. All three are test-locked in both
  modes, so the next drift fails a suite rather than a seated human holding a single-use approval.
- **🔎 Finding (reported, NOT fixed): the readiness sentinel path is SHARED across CLIs** —
  `.status/probe-same-session.ready`, not a Run-5-specific path. Harmless here (nothing else was running; the entrypoint
  clears leftovers at startup), but two live CLIs must never run concurrently.

**What Run 5 PROVES:** the in-page click listener survives live NAVER; `USER_ACTION_OBSERVED` fires on a real click;
the persisted `humanCheckpoint.observed` is a truthful audit record; the click-started detect window is live-real; and
the live period/scope state is machine-visible for the first time.

**What Run 5 does NOT prove:** the **`COMPLETED` path under the new timing.** The confirmed-download → validate →
ingest chain is untouched here and still rests on §8-17's **old-timing** evidence. Re-proving it needs a **separate
mutating run with its own fresh export-scoped G6**. Also unproven: `selectedRangePresent` in the positive direction,
and the dialog-marker identity (`NOT_OBSERVED`, above).

---

## §8-19 — Milestone A1: the `--no-upload` footgun + a real no-ingest mode — DELIVERED offline 2026-07-16 · **NOT live-verified**

**Offline slice: code + tests + docs. No live NAVER, no browser, no backend, no G6 consumed.** Ratified as
[D-027](decisions.md). Baseline **2899 → 2926 passed / 29 skipped** (174 files) — **+27, all new; nothing regressed.**

- **The footgun was real and is closed.** `isClassifyOnly` / `CLASSIFY_ONLY_FLAGS` were exported, parsed, and
  unit-tested — and `run-action-window-live-naver.ts:62` **never imported them**. `--no-upload
  --i-understand-this-opens-live-naver` performed a **full live run including a real `/api/uploads` write**, with no
  diagnostic that the flag was ignored. ⚠ **A green unit test on a predicate proved nothing about its caller** — the
  lesson worth carrying: the flag had *tests*, and was still dead. It is now refused (exit 5) with a model-correcting
  message, locked by a CLI source guard plus a refusal test that **loops the exported alias array**, so a future third
  alias is covered without anyone remembering to.
- **`--no-ingest` exists and declines the handoff:** detect + quarantine-validate run against a real artifact, the
  bytes are dropped, and the run lands **`CANCELLED` · `{ completedSteps: 2, totalSteps: 3 }` · step `SKIPPED` · no
  blocker**. No new terminal, blocker code, event type, contract change, or schema bump — `git diff contracts/` is
  empty and `grep -rni ingest contracts/` is still **zero**.
- **⚠ `--no-ingest` is NOT a safety feature.** It is **strictly more mutating than not acting**: live NAVER opens, a
  human performs a real export action, a real file lands in quarantine. The lever that is non-mutating **by
  construction** is still **don't act** (Runs 2–3, §8-16). Its one purpose is the leg §8-17 could only prove by
  writing **55 irreversible rows**: detect + validate against a real artifact **without a DB write**.
- **Leak-safety is proven, not argued.** On the default path `ingest()` drops the retained bytes itself; a declined run
  never calls it, so `cleanup()` is the only teardown. `naver-live-driver.test.ts` now drives a byte-carrying download
  double + in-memory io hermetically: quarantine file **written then deleted at validate** (D-021), browser copy
  dropped, dir swept at cleanup, and a post-cleanup `ingest()` returns `{ ok: false, processed: 0 }` — observable proof
  the bytes are gone.
- **Default-off is proven:** `buildLiveRunDeps(...).declineIngest === false`, the pre-existing happy-path CLI and
  RUN_INTEGRATION browser tests are unchanged in substance, and `naver-live-driver.ts` / `ProbeDriver` are untouched.
- **🔎 A stale claim was corrected, not left standing.** `CONFIRM_PROMPT` asserted *"there is no no-ingest mode"* and
  [`HANDOFF.md`](HANDOFF.md) asserted it *"still holds for every future run"*. A1 made both false and both are fixed;
  the prompt is now `confirmPrompt(declineIngest)`, deriving what the human is told from what the run will do — the
  rule the timings already followed after D-025. Executed dispatch records carry **dated forward-pointers only**.
  ⚠ This closes the §8-18 finding above (*the operator-facing prose is STALE*): the prompt is now
  policy-derived and test-locked in both modes.

**What §8-19 does NOT prove:** anything live. `--no-ingest` has **never been run against NAVER** — its live behaviour
rests entirely on offline tests. A `--no-ingest` run needs a **fresh, scope-matched G3 + a fresh single-use G6**;
deliberately **no G6 template is pre-written for it** (shipping a capability is not authorizing a scope). The
`COMPLETED` path under the new timing remains unproven (§8-18).

---

## Readiness summary

- **Technical adapter readiness (§1 P9):** substantially green — every §6 item verified on NAVER fixtures
  (§8-2), the headed human-click proof passed (§8-3), the abort drill covers every fail-closed exit + operator
  abort with recovery (§8-6), and the privacy sweep is clean on wire + store (§8-7).
- **P10 (rollback/abort reviewed; abort path tested on fixtures):** ✅ — §8-6.
- **P11 (pre-live evidence pack assembled):** ✅ — this document.
- **Read-only §8-4 probe:** ✅ **complete (2026-07-12)** — session verified `ready:true` / `LOGGED_IN`
  under a consumed one-run G6. This was the first and only permitted pre-pilot live contact; it is
  strictly less than an Action Window run (no click/export/download/downstream).
- **Live driver core (PR #242, `cf509a5`):** ✅ **MERGED (2026-07-12)** — `NaverLiveProbeDriver` proves the
  NAVER-specific §6 seams on the live driver itself, hermetically + over a real browser on a **synthetic
  DOM** (see §8-2 note). **No live NAVER.** Session-wiring: the gated live entrypoint's `assembleLiveRun`
  seam is now **proven** by a synthetic-browser integration test with real Operation Run persistence
  (§8-9) — automated cases PASSED 2026-07-12 + the headed real-human-click case PASSED 2026-07-13; the
  live driver is **not** Bridge-wired (the entrypoint uses a loopback channel). The §6 checklist body in [`r4-preparation.md`](r4-gate-record.md) §6 is reconciled to
  match P9/§8-2 accordingly (fixture / synthetic-browser green; live still gated).
- **Live-driver headed synthetic proof (2026-07-12):** ✅ **PASSED with a real seated-operator click** (§8-3
  addendum) — proves the live driver's real-browser observe → download-detect → quarantine-validate →
  fake-ingest seams, synthetic-only. **Does not prove live export readiness**; P6/P12/fresh-G6/live export
  pilot remain gated.
- **Remaining before an export pilot:** a **fresh per-run G6 approval** in the dispatching turn under the
  **full §4 boundary** (the recorded pause lift and consumed G6 were scoped to the read-only probe only),
  plus the environment/live-work-pause posture re-affirmed for an actual export run. G2 (seller consent),
  G3 (stable environment + read-only-probe-scoped pause lift), and G5 (policy-track log) are recorded
  2026-07-12. None of these are Runtime code.

**This pack authorizes no live NAVER export contact.**

---

## §8-20 — Milestone A2-B: recoverable LOGIN_REQUIRED / SESSION_EXPIRED — DELIVERED offline 2026-07-16 · **NOT live-verified**

**Offline slice: code + tests + docs. No live NAVER, no browser, no backend, no G6 consumed.** Ratified as
[D-028](decisions.md). Baseline **2926 → 2976 passed / 29 skipped** (175 files) — **+50, every one attributed:**
`stage-tables` +32 (new) · `engine` +12 · `session-integration` +4 · `run-action-window-live-naver` +2 ·
`naver-session-integration` **+0** (two rows moved from the terminal table to the park table — same scenarios,
corrected outcome). **Nothing regressed and no file lost a test.**

- **The lie is gone.** `recoverable: true` was produced **nowhere in production code** — the field was plumbed
  persist → validate → view → wire carrying exactly one value, so every blocker the FE saw claimed to be
  unrecoverable, **including the two a seller can fix in ten seconds**. `LOGIN_REQUIRED` / `SESSION_EXPIRED` now
  **park**: `WAITING_FOR_HUMAN` · `recoverable: true` · `REQUEST_STEP_RECHECK` offered · `0-of-3` · **no
  `RUN_FAILED`**. `UNSUPPORTED_STATE` stays terminal **by construction** — the exhaustive switch over
  `SurfaceBlockerCode` makes a 4th code a compile error, not a test failure.
- **Zero contract, FE, backend, or schema change.** `git diff contracts/ frontend/ backend/` is empty;
  `OPERATION_RUN_SCHEMA_VERSION` is still **2**. The **FE affordance already existed** and was waiting for a view
  the engine could not produce: `HumanCheckpointCard` renders `recoverable` and gates 확인 완료 purely on
  `allowedCommands`, and `copy.ts` has shipped Korean copy for both codes all along.
- **⚠ The park is real; the recovery is only offline-proven.** Proven end-to-end **over the loopback**
  (`session-integration.test.ts`: park → seller fixes session → recheck → **`prepareSurface` called a second
  time** → run recovers to the barrier). The **CLI cannot exercise it** — `main()`'s `finally` closes the browser
  the instant `driveOneRun` returns. Driving recovery from the CLI is **A3**.
  > ⏩ **Corrected 2026-07-17 — §8-21 / [D-029](decisions.md) closed this.** The CLI now drives the recovery.
  > The recovery is **still offline-proven only**; that half of this bullet stands.
- **⚠ KNOWN LIMITATION, locked by test, not discovered later: a successful login can still kill the run.** The
  driver never navigates, so a recheck probes whatever page login landed on; off-surface → readiness HALT →
  `UNSUPPORTED_STATE` → terminal. **Where NAVER lands a seller after login is UNOBSERVED.** Per D-028 that is a
  **guidance-only §4 human precondition** (the D-025 category): observed, never gated. **Free falsifier:** any
  future run whose operator logs in and reports whether the surface is still readiness-`READY`.
- **Two silent traps were found empirically, not argued.** Adding the stage broke the build in exactly three
  exhaustive switches — and **not** in `stageStepIndex` (has a `default`) or `operation-run.ts`'s `STAGES` array
  (a `readonly Stage[]` accepts a subset). A missing `STAGES` entry does **not** fail loudly: the save path
  re-parses and throws from inside the session's drive chain, where the throw is swallowed into `fatalCleanup` —
  **the run parks in memory, nothing reaches disk, and no error surfaces anywhere.** The new
  `stage-tables.test.ts` nets both, and was **verified to fail** when each fix is reverted.
- **The audit trail stays honest.** The park emits **no `HUMAN_ACTION_REQUIRED`** — that event is how
  `humanCheckpoint.reached` is derived, and the checkpoint means step 2, so emitting it would claim a barrier the
  run never reached (the §8-18 lie class). Persisted parks assert `reached: false`, `RESUME_AT_CHECKPOINT`, and
  tasks `[AWAITING_USER, PENDING, PENDING]`. `activeStepIndex` is reset to 1, so a park after a resumed
  downstream failure cannot project *"step 3 of 3"* while waiting on a step-1 probe.
- **The `--no-upload` lesson repeated itself, in reverse.** §8-19's was "a green unit test on a predicate proved
  nothing about its caller". Here: **the fixtures had a `recoverable: true` example (fixture 10) the whole time,
  and it proved nothing about the engine** — no test asserts engine↔fixture agreement, and the live-proven
  barrier (fixture 04) already diverges on six fields. **An example is not a golden.** That finding, not cost, is
  why the 4-step plan was rejected: it would not have made fixture 10 projectable either.

**This section authorizes no live NAVER contact.** A2-B ships a capability and consumes no gate.

---

## §8-21 — Milestone A3: the CLI operator recovery loop — DELIVERED offline 2026-07-17 · **NOT live-verified**

**The CLI now drives A2-B's recovery park** ([D-029](decisions.md)): prompt → the seller logs in → they signal
the sentinel → `REQUEST_STEP_RECHECK` re-probes for real → the run continues. Bounded by a **shared 10-minute
budget**, not per-attempt timeouts. **Zero contract / FE / backend / schema / stage / navigation change** — A3 is
a pure consumer of A2-B's engine seam. Baseline **2976 → 2996 passed / 29 skipped** (175 files); +20, all
attributed (3 sentinel · 9 loop · 6 prompt · 2 source-guard).

- **What it closes.** §8-20 recorded, in three places, that *"the CLI cannot exercise it"* — the engine offered
  recovery, the FE affordance was built and waiting, and the one entrypoint that drives real NAVER tore the
  browser down before the seller could act. That claim is now **false by construction**; all three sites are
  corrected rather than rewritten.
- **It implements a ratified decision that had never been implemented.** D-028 ruled "the seller is back on the
  review-export surface" a **guidance-only §4 human precondition** — and then nothing delivered the guidance.
  `confirmPrompt` carries the equivalent for the initial wait; a recovery had **no prompt at all**.
  `recoveryPrompt` is the first place it is spoken, and it states the consequence: the Runtime does not
  navigate, so a wrong page ends the run at terminal `UNSUPPORTED_STATE` with the approval spent.
- **⚠ GOVERNANCE — a G6 now authorizes a longer live window: ~21 min → ~32 min** worst case (the rejected
  per-attempt design would have been ~52 min). D-028's boundary requires a fresh G3 + G6 per run but says
  nothing about duration, and duration is what changed. **Belongs in the next dispatch record.**
- **⚠ The falsifier was NOT free — the planning claim that it was is FALSIFIED.** `lastDiagnostic` is assigned
  after an unguarded `page.content()`, so a thrown probe retains the PREVIOUS probe's value. One probe per
  process made that unobservable; A3 makes up to four, and its premise is a seller who just logged in and
  navigated — exactly when a page read throws. The single post-run `aw.live.readiness` could have reported the
  **pre-login** readiness as post-login evidence: **the falsifier, or a stale lie, indistinguishably.** Now
  logged **per attempt** and withheld on `driver-error` (stale ⟺ threw ⟺ that outcome). Guarding
  `page.content()` in the driver is the deeper fix — **out of scope, reported.**
- **⚠ The audit lie that nearly shipped.** The obvious `outcomeOf` reports **`"recovered"` for a run that just
  died**: a thrown probe leaves `session.ts`'s `fatalCleanup` path with the last view still `PREPARING` +
  blocker. That is the same class D-028 rejected `HUMAN_ACTION_REQUIRED` for — except it would have been **ours,
  not inherited**. `"recovered"` is now asserted positively and `driver-error` is a distinct outcome; the test
  fails against the original design.
- **The stale sentinel violated a precondition that was already written down.** `probe-same-session.ts` says
  verbatim *"The caller clears any stale sentinel BEFORE calling this"* — **this CLI's copy dropped the
  sentence** (13 identical bodies, non-identical docstrings). Without the clear, the recheck fires milliseconds
  after the park against the same logged-out page and drains the loop, logging an exhaustion
  **indistinguishable from a seller who walked away**. `awaitFreshSentinel` makes the written rule structural;
  its trap test fails in under a millisecond without it.
- **The `--no-upload` lesson repeated itself a THIRD time — and the guard against it was itself vacuous.**
  §8-19: *"a green unit test on a predicate proved nothing about its caller."* §8-20: *"an example is not a
  golden."* Here: `awaitRecovery` is optional and `main()` is untestable, so the loop could be green while the
  live CLI stayed dead. The source guard written to lock the caller wiring asserted `/awaitRecovery:/` — which
  **`recoverLoop`'s own type signature satisfies**. Renaming `main()`'s wiring left all 56 tests green. It was
  caught **only** by deliberately falsifying it. **A vacuous guard against a footgun is the footgun.**
- **Falsification, not assertion.** Four locks were proven to fail before being trusted: delete
  `removeSentinel` → the trap test fails; rename or drop `main()`'s gate → the wiring guard fails (twice, two
  different shapes); restore the naive `outcomeOf` → the throw test fails.

**What §8-21 does NOT prove:** anything live. **The recovery loop has never run against NAVER** — it is proven
only against fake drivers over an in-process loopback, and the gate is injected precisely so it never needs a
browser. The gated browser suite is untouched and **still never run**. **This section authorizes no live NAVER
contact.** A3 ships a capability and consumes no gate; live use needs a fresh scope-matched G3 **and** a fresh
single-use G6, now carrying the longer window recorded above.

---

## §8-22 — Milestone A4: the synthetic-browser recovery rung — DELIVERED offline 2026-07-17 · **NOT live-verified**

**The A3 recovery loop now executes in a browser.** Two cases in the gated
`run-action-window-live-naver-browser.test.ts` drive the REAL `NaverLiveProbeDriver` through a REAL
`prepareSurface` **twice across a real navigation** — a login park → the seller logs in and returns → the
re-probe reads the NEW page → the run reaches the export barrier. They mirror **Run 6's choreography
exactly**: zero clicks, let the barrier lapse. **Zero production-code change** — A4 is tests + this record.
Baseline **2996 passed / 29 → 31 skipped** (175 files, 3025 → 3027): **`passed` is unchanged and +2 skipped
is the whole delta**, because the new cases are `RUN_INTEGRATION`-gated. `RUN_INTEGRATION` **PASSED
2026-07-17 — 5 passed / 1 skipped, 5 runs out of 5** (the `AW_HEADED` case stays skipped and is **still
never run**).

- **What it closes.** §6 (`r4-preparation.md`) had **ten rungs and none of them was recovery** — A2-B's park
  semantics live in §7, not the ladder. G4 reads *"live is never the first execution of any code path"*, and
  A3's only proof was fake drivers over an in-process loopback (§8-21), so live NAVER **would have been** the
  first browser execution of the recovery path. §6 now carries an 11th rung.
- **⚠ THE FINDING — the gated browser suite was RED on `main`, and §8-21 says why in its own last line.**
  §8-21 closes *"The gated browser suite is untouched and **still never run**."* A4 ran it, and the
  pre-existing `COMPLETED + persisted TERMINAL` case **failed 5 of 5 on a clean checkout of `main`** at
  `humanCheckpoint.observed`. It is a **race that almost always loses** — 1 pass in 11 observed runs — not a
  hard break, which is exactly why it was never caught. **A4 neither caused nor affected it: identical
  failure with and without A4.**
- **It is the SAME defect `40d7c53` fixed, in the one place that fix could not reach.** That commit
  ("make the human barrier real") touched only the live CLI, the hermetic test, and two docs — **never this
  suite**. Its fix was to make `driveOneRun` await `USER_ACTION_OBSERVED` before rechecking. This case
  **hand-rolls the command sequence** (`page.click` → `REQUEST_STEP_RECHECK`, no wait), so it kept racing
  `watchUserAction`, which `whenSettled()` does not track: the stage left `WAIT_FOR_USER_ACTION`, the stage
  guard dropped the observation, and the case asserted `observed === true` against a record that honestly
  said `false`. **The product path was never wrong — the test was.** Fixed by waiting on the event exactly as
  `driveOneRun` does; green 5/5. **The assertion now tests the barrier instead of the clock.**
- **⚠ The governance lesson is not the bug, it is the invisibility.** A ☑ in §6 cites suites that **nothing
  runs** — not in `npm test` (they are gated), not in CI. This one was red across all of Milestone A while
  §6 read green. **Verified and bounded, not extrapolated:** the other four gated browser suites
  (`fixture-browser` 8/8, `naver-browser` 2/2, `naver-live-browser` 2/2, `session-browser` 7/7) are **green**,
  so this was one racing assertion, not systemic rot. Whether §6's ☑ marks should depend on suites no
  scheduled run ever executes is **reported, not resolved.**
- **⚠ A4 adds ZERO passing tests to the default suite.** Its evidence exists **only** because the gated
  command was actually run — which is why the §6 rung carries a real PASSED date, as rung 4 does for its
  `AW_HEADED` proof. A reader who runs `npm test` sees `+2 skipped` and no more.
- **Falsification, not assertion.** Three locks were proven to fail before being trusted: (1) the gate stops
  swapping the body → `["still-blocked" ×3, "attempts-exhausted"]`, never `"recovered"`; (2) the gate swaps
  the body but **never navigates** → still-blocked, proving the **navigation** recovers the run and not the
  assignment; (3) assert the pre-login verdict → fails with actual `LOGGED_IN`, proving the diagnostic read
  is genuinely post-login and not the stale value a thrown probe would leave.
- **The log surface A3 created is swept for the first time.** `aw.live.recovery` / `aw.live.readiness` are
  needle-swept (`safeMeta` filters KEYS, never values). ⚠ The `"exp"` needle is **excluded from the log sweep
  only** and the reason is recorded in-code: it is a substring of the sanitized readiness enums the CLI
  legitimately logs (`EXPORT_TARGET_EMPTY`, `no_export_target`), so sweeping with it would fail on a **correct**
  diagnostic — the false-failure class `collector/CLAUDE.md` §5 warns about. Every page-derived needle still applies.
- **⚠ `§8-2`'s table no longer enumerates every §6 item** (PO, 2026-07-17). `§8-2:50-61` claims "every §6
  item" but is a dated snapshot (baseline `2556 / 25`) that already omits §8-14→§8-21. A4 adds an 11th rung
  and **deliberately does not edit it** — the rung's own pointer carries §8-22 instead, exactly as §6 rung 2
  absorbed every live correction inside its own parenthetical. **Reported, not resolved.**

**What §8-22 does NOT prove:** anything live. **The recovery loop has still never run against NAVER.**
Specifically, and stated here because a ☑ rung is easy to over-read:
- **`page.content()` mid-navigation is NOT covered.** The test's gate **awaits** its `page.goto`, so the
  re-probe reads a **settled** page and the destroyed-context window never opens. The unguarded read in
  `naver-live-driver.ts` remains an accepted, PO-declined risk, **first-executed live**, with signature
  `aw.live.recovery { outcome: "driver-error" }` and **no** `aw.live.readiness` for that attempt.
- **`main()`'s gate closure is NOT covered** — `settleSpa` on the recovery branch is executed by nothing
  offline. The gate is injected precisely so the test needs no operator; `main()` stays untestable.
- Real NAVER DOM/SPA behaviour; the export/download/ingest legs after a recovery (zero clicks); the
  **headed** case, still never run.

**This section authorizes no live NAVER contact and consumes no gate.** A4 records evidence; **it does not
decide G4.** Whether a green rung means G4 carries for Run 6 is a product-owner ratification in a dispatching
turn — the Run 6 draft is deliberately untouched by this slice, so that decision stays where it belongs.

---

## §8-23 — Live Run 6 (session recovery) — EXECUTED 2026-07-17 · **recovery LIVE-PROVEN** · non-mutating

**Run 6 parked a real run on a logged-out session and then RECOVERED it live**, under a fresh Run-6-scoped
G6 + a `session recovery`-scoped G3 pause lift + a session-recovery P6, all affirmed by the operator in the
dispatching turn ([`r4-run6-session-recovery-dispatch-record.md`](r4-run6-session-recovery-dispatch-record.md)).
It answers the one question §8-21/§8-22 could not: **A3's recovery loop had only ever run against fake
drivers (hermetic) or a real browser over a synthetic DOM (A4) — it had never re-probed live NAVER across a
real login.** Preconditions verified read-only first: A3 (`cc9aba8`) + A4 (`4f31fc4`) both ancestors of
`HEAD` (`d8b66a5`) and the entrypoint carrying `recoverLoop` / `awaitFreshSentinel` / `recoveryPrompt`;
backend **DOWN** (8080 connection refused — deliberate, defense-in-depth); `RUN_INTEGRATION` / `AW_HEADED` /
`NODE_ENV` all unset.

- **THE HEADLINE — `aw.live.recovery { outcome: "recovered", attempt: 1 }`.** First live proof of the
  park → recover → continue arc on the real NAVER surface. Run 5 (§8-18) tore the browser down at the
  barrier after a click; **every prior live run that hit a session blocker simply ended.** Here the run
  parked, the seller logged in and returned, and the **real driver re-probed and cleared the blocker** —
  which only a probe can do; a human saying "I logged in" never clears it.
- **The park was real, and it was the subject of the run.** Signal 1 fired **while logged out** →
  `LOGIN_REQUIRED` park, `recovery attempt 1` prompt printed, browser alive, no `RUN_FAILED`. This is the
  D-028 park working as designed, not a fault.
- **The re-probe read the POST-LOGIN page — `aw.live.readiness` (attempt 1):** `verdict: LOGGED_IN` ·
  `readinessDecision: READY` · `readinessReason: positive_count` · `readinessBranch: labeled_count_positive`
  · `selectedRangePresent: false` · `dateRangeControlPresence: some`. **D-028's falsifier lands POSITIVE:**
  the seller logged in, navigated back to the export surface themselves, and the re-probe found a READY
  surface — **not** `UNSUPPORTED_STATE`. For this run the navigate seam is not a product-owner question; the
  Runtime never navigated and still read a valid export surface because the seller returned to it.
- **⚠ NO `driver-error` — the accepted `page.content()` race did NOT fire this once.** Run 6's premise —
  a seller who just logged in and navigated — **is** the canonical `Execution context was destroyed`
  window that the unguarded `page.content()` read in `naver-live-driver.ts` risks. It did not throw: the
  re-probe ran on a settled page and produced a clean `readiness`. **This is one observation, not a
  closure.** "Expect the first, tolerate the second" — the first residual was silent here, on one seller's
  post-login landing on one day. The read stays **unguarded** (PO-declined, re-affirmed in G4's
  ratification); a future recovery whose navigation is still in flight can still throw with signature
  `aw.live.recovery { outcome: "driver-error" }` and **no** `aw.live.readiness` for that attempt.
- **🔎 `main()`'s recovery-branch `settleSpa` executed live for the first time.** A4 (§8-22) injects its own
  gate, so `settleSpa(page)` on the recovery branch (`run-action-window-live-naver.ts:759`) is executed by
  nothing offline — it was **first-executed live here**, without incident. Best-effort by construction (the
  driver's own readiness settle stands behind it); it cost latency, not the run.
- **Sanitized terminal result:** `status: FAILED` · `progress: { completedSteps: 2, totalSteps: 3 }` ·
  `channelCode: naver` · `blockerCode: DOWNLOAD_TIMEOUT` — the §8-16 Run 3 / §8-18 Run 5 shape. **The
  expected success condition:** after recovery the export control was highlighted and the seller **clicked
  nothing**; the observe window lapsed and the run failed closed.
- **The store agrees with the log.** Operation Run **`run_57ab9b52a3c0`** persists `latestView`
  `FAILED` / 2-of-3 / `blocker { DOWNLOAD_TIMEOUT, recoverable: false }` / `channelCode: naver`, and
  `humanCheckpoint { reached: true, observed: false, targetRef: <SHA-16> }` — the barrier was **reached**
  (control highlighted) and **not observed** (no click). Log line and persisted record do not diverge.
- **🔎 The two-window timing is live-confirmed on the no-click path.** Recovery at `14:45:57` → highlight →
  `aw.live.barrier { observed: false }` at `14:55:57` (exactly `OBSERVE_TIMEOUT_MS` = 10 min later, nobody
  acted) → `DOWNLOAD_TIMEOUT` at `14:56:57` (`DOWNLOAD_TIMEOUT_MS` = 60 s later). The two windows are
  sequential and real; §8-18 proved the second starts at a **click**, and here — with no click — the
  observe window itself lapsed first, then the 60 s. Total recovery→terminal ≈ 11 min; the `~32 min`
  worst-case the G6 affirmed was budgeted, not spent (only 1 recovery attempt; `MAX_RECOVERY_ATTEMPTS` = 3
  never approached, `RECOVERY_BUDGET_MS` mostly unused because recovery landed on the first fresh signal).
- **Period/scope — operator-confirmed, consistent, and still a true negative.** The operator **did not
  select a review period/scope** before either signal (confirmed this turn). `selectedRangePresent: false`
  **agrees with that operator state** — a true negative, not a detector false-negative. **The
  positive-direction detector remains UNPROVEN** (§8-18, D-025): this run selected no range, so it is not
  the observed finding that could promote the markers, and the `page.content()`-attribute-vs-IDL-property
  blind spot D-025 characterized offline is untouched. `dateRangeControlPresence: "some"` again indicates
  the control was present; readiness passed via rung 1 (`labeled_count_positive`) without weighing scope,
  exactly as §8-18/D-025 established.
- **Non-mutation — verified, not assumed:** `aw.live.barrier { observed: false }`; **zero**
  `DOWNLOAD_DETECTED` frames; **no quarantine directory was ever created**; `downloads/` untouched; the
  backend was **never reachable** and `/api/uploads` was never called; no download → no validate → no
  ingest → no DB write, no status, no `LAST_SUCCESS`. Sentinel auto-removed in `finally`; browser closed;
  process exited clean (exit 0); git worktree clean. Leak sweep clean on **both** the log output and the
  persisted record (no raw URL / filename / content / credential; `targetRef` is an opaque SHA-16).
  **G6 CONSUMED.**
- **🔎 Finding (reported, NOT fixed): the CLI launch/recovery prompts are the EXPORT-PILOT prompts,
  scope-mismatched for session recovery.** `confirmPrompt` tells the operator to *"complete the NAVER-ID
  login … reach the review-management export surface"* **before** the first signal — the exact opposite of
  Run 6, whose whole premise is signalling **while logged out**. The dispatch record §4 flagged this as a
  deliberate deviation and the operator was steered by the record, not the prompt, so it caused no harm.
  But unlike §8-18's *stale*-prose finding, this prompt is not stale — **it is correct for the export
  pilot and wrong for session recovery, and no single launch prompt is correct for both scopes.** Whether
  the entrypoint should branch its operator prose on run scope is **reported, not resolved.**
- **🔎 Operational note (not a defect): the documented env-load idiom is cwd-sensitive.** Two pre-launch
  attempts failed **before any browser opened** — once at the built-in refusal (exit 2, `NAVER_REVIEW_URL`
  unset because the shell cwd had reset out of `collector/` so `. ./.env` found no file) and once at the
  shell (exit 127, same cause). **Defense-in-depth worked exactly as designed: the refusal fired before
  `launchNaverContext`, so neither attempt contacted NAVER and neither spent the G6.** The working
  invocation `cd collector && set -a && . ./.env && set +a && npx tsx …` must keep the `cd` and the env
  load in the **same** command; the two-line idiom in the dispatch records assumes cwd is already
  `collector/`.

**What Run 6 PROVES:** A3's recovery loop works on live NAVER — a logged-out park recovers to a READY
export surface across a real login and a seller-performed navigation; the real driver's re-probe (and
`main()`'s recovery-branch `settleSpa`) run live without a `driver-error`; and the persisted `latestView` /
`humanCheckpoint` is a truthful terminal record matching the emitted log.

**What Run 6 does NOT prove:** **that recovery works in general** — a `recovered` is one seller's post-login
landing on one day, an observation, not an invariant; D-028's limitation (the driver never navigates) is
unchanged. Nor: **the `page.content()` race is closed** (it did not fire once — not proof it cannot); the
**export / download / ingest legs** (zero clicks ⇒ unreachable, not merely unused); **`COMPLETED` under the
two-window timing** (still rests on §8-17's old-timing evidence); the **Run 4 dialog identity** (no click ⇒
no dialog); `selectedRangePresent` in the **positive direction**; platform acceptance.

**This section authorizes no further live NAVER contact and consumes no gate.** The Run-6 G6 is spent;
**any further live contact needs a fresh single-use G6** — and per the dispatching instruction, **there is
no retry under this G6.**

---

## §8-24 — Live overlay-label check (incidental export click) — EXECUTED 2026-07-18 · overlay label LIVE-VERIFIED · **real export download → `ARTIFACT_INVALID` (NEW FINDING)** · non-mutating

**A single-use live `--no-ingest` run**, authorized by the operator in the dispatching turn (this session)
and scoped to verifying the **uncommitted overlay-label change** on `feat/r4-supervised-channel-runtime`
(the highlight badge renders an operator-legible label in place of the raw `copyKey`). No export click was
pre-authorized; the operator clicked the highlighted control **at the seat** and confirmed it afterward, so
the run reached the downstream legs and surfaced a finding the no-click runs (§8-18 Run 5, §8-23 Run 6)
could not. Backend **DOWN** (`--no-ingest`; the real uploader was never constructed). **G6-equivalent CONSUMED.**

> **⚠ Code baseline is NOT a committed SHA.** This run executed against **uncommitted** working-tree changes
> (overlay-label slice: `overlay.ts` badge text + `naver-live-driver.ts` label map/mount). That change is
> **diagnostic-only** — it alters the highlight badge string and touches **no** detection / download /
> quarantine / validation path — so the `ARTIFACT_INVALID` finding below is a property of the **real NAVER
> export artifact, not of the change under test**. Every other §8 live entry cites a committed baseline;
> this one deliberately does not, and says so.

- **✅ Overlay label — LIVE-VERIFIED (the run's stated purpose).** Operator-confirmed at the real highlight:
  the badge showed the **Korean operator label** (`리뷰 내보내기 버튼을 클릭하세요. NAVER 확인창이 뜨면 이번
  실행 범위 안에서 확인하세요.`), **not** the raw `actionWindow.step.userTargetAction` key; **readable**;
  **positioned above the control**, on-screen, not clipped. The `label ?? copyKey` fallback path is untouched
  (offline-covered by `fixture-browser.test.ts`). The diagnostic overlay renders a legible line for the
  seated operator on the real surface, where before it showed a dotted machine key.

- **🔎 THE FINDING (reported, NOT resolved) — a real NAVER export download FAILED quarantine validation:
  `blockerCode: ARTIFACT_INVALID`.** The operator's click fired a **real download**; the runtime quarantined
  it read-only and the D-021 sniff returned **invalid** (unrecognized extension **or** OOXML magic mismatch),
  so the run failed closed at step 3. **This diverges from §8-17 (Run 4, 2026-07-15), where the export
  validated cleanly as OOXML — backend `SUCCESS` 55/55/0/0.** Same channel, same surface; different artifact
  verdict.

- **⚠ Cause UNDETERMINED, and the artifact is not inspectable.** Per §4.3 + D-021 the quarantine file was
  **deleted after the sniff** (the quarantine directory is absent/clean afterward — so this is the
  **validation-fail** verdict, not the delete-failure path), and its content may never be read or logged.
  Candidate explanations, **all unverified**: a non-`.xlsx` export format (e.g. CSV), an interstitial/HTML
  page saved in place of a workbook, a partial/aborted download, or a format-/period-dependent export shape.
  **None is confirmed.** A controlled classification probe (extension + magic **bucket** only, no content)
  could narrow it — and would need a **fresh single-use G6**.

- **Sanitized terminal result:** `status: FAILED` · `progress { completedSteps: 2, totalSteps: 3 }` ·
  `channelCode: naver` · `blockerCode: ARTIFACT_INVALID`. The barrier fired real — `aw.live.barrier
  { observed: true }` (the §8-18 observer working: a real click observed) — then `aw.live.run { FAILED,
  ARTIFACT_INVALID }` ~2 s later. Contrast the no-click runs, which lapsed to `DOWNLOAD_TIMEOUT` with
  `observed: false`.

- **Readiness (`aw.live.readiness`, post-run):** `verdict: LOGGED_IN` · `readinessDecision: READY` ·
  `readinessReason: positive_count` · `readinessBranch: labeled_count_positive` · `dateRangeControlPresence:
  some` · **`selectedRangePresent: false` + `selectedRangePresentLive: true`.** The D-025 discriminator
  reproduces (attribute-regex blind `false`, in-page IDL `true`), consistent with the 2026-07-18
  live-positive; **D-025's positive-direction promotion remains a PO decision, unchanged here.** (The
  operator's period-selection state was not separately re-confirmed this run; `Live: true` is the machine
  reading.)

- **Non-mutation — verified, not assumed:** `--no-ingest` (real uploader never constructed); a download fired
  and was quarantined **then deleted** on the invalid verdict (dir clean/absent after); **no** validate-pass,
  **no** ingest, backend **never contacted** (`/api/uploads` never called), no DB write / status /
  `LAST_SUCCESS`; `downloads/` untouched. Sentinel auto-removed in `finally`; browser closed; process exit 0.
  **The run mutated no files** — the git worktree carried only the four overlay-slice files plus the
  pre-existing protected pair, nothing staged. Sanitized log lines carry only enums/booleans — no raw URL /
  filename / content / credential.

**What this run PROVES:** the overlay-label change renders a legible Korean operator label at the real NAVER
highlight (fallback intact); and — via the operator's incidental click — that a **real NAVER review-export
download can fail D-021 quarantine validation (`ARTIFACT_INVALID`)** on the current surface, a divergence
from Run 4's clean OOXML.

**What this run does NOT prove:** that the NAVER export is broken (one seller, one day, one period/format —
an observation, not an invariant); **the artifact's actual format/content** (never inspected, deleted by
design); that the overlay-label change had any role (diagnostic-only, no downstream touch); or anything about
ingest (validation failed before it, and `--no-ingest` regardless).

**This section authorizes no further live NAVER contact and consumes no gate beyond the single-use approval
already spent.** Any follow-up classification probe needs a **fresh single-use G6**.

---

## Related

- Gate + readiness source → [`r4-preparation.md`](r4-gate-record.md) §1/§3/§6/§7/§8
- Durable decisions → [`decisions.md`](decisions.md) D-019/D-020/D-021/D-022/D-023
- Living handoff state → [`current-state.md`](HANDOFF.md)
- Capability ledger → [`checklist.md`](../evidence/INDEX.md) row 14
