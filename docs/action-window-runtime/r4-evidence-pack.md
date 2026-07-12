# R4 Pre-Live Evidence Pack — NAVER SmartStore review export

**Assembled:** 2026-07-11 · **Channel:** NAVER SmartStore review export (ratified G1, [`decisions.md`](decisions.md) D-021).
**Code baseline under test:** `origin/main` `3cda125` (merge of PR #227 — the fixture-only NAVER
downstream + Bridge/local-agent boot wiring); the §8-6 NAVER operator-abort drill is added by this pack slice.
**Status:** ASSEMBLED (technical readiness); the read-only §8-4 probe result is recorded 2026-07-12.
**This pack authorizes NO live action** — it records readiness evidence only. The **read-only
session-precondition probe was completed 2026-07-12 (§8-4)** under a **consumed one-run G6** approval;
any live **export** remains blocked pending a **fresh per-run G6** in the dispatching turn under §4
(G2/G5 recorded 2026-07-12, G3 confirmed 2026-07-12, [`r4-gate-record.md`](r4-gate-record.md), D-024).
The G3 pause lift is scoped to that first read-only session-precondition probe only.

**Sanitization discipline (self-applied):** every value below is an enum, boolean, coarse count, test name,
or commit SHA. No raw review/inquiry content, reviewer/seller/account identity, reference codes, exact
amounts, tokens, cookies, raw URLs/HTML/screenshots, raw timestamps, `eventTimeMs`, filenames, or local
paths appears in this document. This is the same contract the pack certifies (§8-7).

This pack satisfies [`r4-preparation.md`](r4-preparation.md) §8 items 1–7 and P11; it is the readiness
evidence for §1 P9/P10/P11.

---

## §8-1 — Gate record (§3 supervised-pilot internal gate)

| Gate | Item | Status | Evidence / what it still needs |
|---|---|---|---|
| **G1** | Channel ratified | ✅ | **NAVER SmartStore review export** — [`decisions.md`](decisions.md) D-021 (2026-07-09); §2 selection rationale. |
| **G2** | Seller consent | ✅ | **Self-consent recorded 2026-07-12** for `NAVER_DEV_SELLER_SELF_01` (operator's own dev account) acknowledging §4 verbatim; first live run scoped to the read-only session-precondition probe — [`r4-gate-record.md`](r4-gate-record.md) §G2, [`decisions.md`](decisions.md) D-024. |
| **G3** | Environment | ✅ | **Confirmed 2026-07-12** — stable env (network/IP/location) + dedicated Chrome profile + paired Bridge + Operation Run persistence, and the **NAVER live-work pause lift scoped to the first read-only session-precondition probe only** (§9 item 3; not a general lift). Checklist in [`r4-gate-record.md`](r4-gate-record.md) §G3; operator-owned. |
| **G4** | Synthetic ladder green | ✅ | **This pack, §8-2** — every §6 adapter-readiness item green on NAVER fixtures. |
| **G5** | Policy track open | ✅ | **Logged 2026-07-12** — none required for the NAVER seller-owned export per §5; no platform "approved" — [`r4-gate-record.md`](r4-gate-record.md) §G5, §8-5. |
| **G6** | Per-run approval | ☐ per-run | Explicit product-owner approval **in the dispatching turn** (channel, seller-account owner, date, operator, run scope, §7 abort criteria). **One read-only-probe instance was approved + consumed 2026-07-12** (result §8-4) — **never standing**; an export pilot needs a **new** instance under §4. CONSUMED instance in [`r4-gate-record.md`](r4-gate-record.md) §G6. |

**Gate summary:** G1/G2/G3/G4/G5 ✅ (G2/G5 recorded 2026-07-12, G3 confirmed 2026-07-12 →
[`r4-gate-record.md`](r4-gate-record.md), [`decisions.md`](decisions.md) D-024; the G3 pause lift is
scoped to the first read-only session-precondition probe only). **G6 is a per-run gate** — a
read-only-probe instance was approved and **consumed 2026-07-12** (the §8-4 probe is complete), but G6 is
never standing: an **export pilot still requires a fresh per-run G6** in the dispatching turn, not Runtime
code. This pack records no live export action.

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

## §8-8 — Export pilot result — RESERVED (not yet run; authorizes no live action)

**No export pilot has run.** This slot is reserved for the sanitized result of the first supervised NAVER
export pilot, to be filled **only after** an actual dispatched run per the export-pilot pre-dispatch
runbook ([`r4-gate-record.md`](r4-gate-record.md) §5 post-run checklist). Until then it records nothing
and grants nothing.

When filled, record enums/booleans/counts/SHA only (per §8-7 / `findProhibitedFields`; **never** URL,
filename, path, selector, page content, credentials, cookies, tokens, or `eventTimeMs`):

- ☐ Export-scoped G6 instance (dispatching turn, date, operator, scope) — [`r4-gate-record.md`](r4-gate-record.md) §G6.
- ☐ Final run view: `{ status, progress, channelCode, blockerCode? }`.
- ☐ Ingest outcome `{ ok, processed }`.
- ☐ Quarantine validate result + dir-emptied confirmation.
- ☐ No-leak assertion (`findProhibitedFields == []` across wire + store).
- ☐ Operation Run id (`run_…`) for the audit trail.

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
quarantine emptied, persisted FAILED); and a headed (`AW_HEADED=1`) real-human-click case. No-leak +
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
  live driver is **not** Bridge-wired (the entrypoint uses a loopback channel). The §6 checklist body in [`r4-preparation.md`](r4-preparation.md) §6 is reconciled to
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

## Related

- Gate + readiness source → [`r4-preparation.md`](r4-preparation.md) §1/§3/§6/§7/§8
- Durable decisions → [`decisions.md`](decisions.md) D-019/D-020/D-021/D-022/D-023
- Living handoff state → [`current-state.md`](current-state.md)
- Capability ledger → [`checklist.md`](checklist.md) row 14
