# R4 Pre-Live Evidence Pack — NAVER SmartStore review export

**Assembled:** 2026-07-11 · **Channel:** NAVER SmartStore review export (ratified G1, [`decisions.md`](decisions.md) D-021).
**Code baseline under test:** `origin/main` `3cda125` (merge of PR #227 — the fixture-only NAVER
downstream + Bridge/local-agent boot wiring); the §8-6 NAVER operator-abort drill is added by this pack slice.
**Status:** ASSEMBLED (technical readiness). **This pack authorizes NO live action** — it records readiness
evidence only. Live NAVER remains blocked by the §3 gate — now **G3 and G6** (G2/G5 recorded 2026-07-12,
[`r4-gate-record.md`](r4-gate-record.md), D-024) — and the NAVER live-work pause.

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
| **G3** | Environment | ☐ OPEN | Stable env (network/IP/location) + dedicated Chrome profile + paired Bridge + Operation Run persistence, and the **NAVER live-work pause lift** (§9 item 3). Checklist in [`r4-gate-record.md`](r4-gate-record.md) §G3; operator-owned, pending. |
| **G4** | Synthetic ladder green | ✅ | **This pack, §8-2** — every §6 adapter-readiness item green on NAVER fixtures. |
| **G5** | Policy track open | ✅ | **Logged 2026-07-12** — none required for the NAVER seller-owned export per §5; no platform "approved" — [`r4-gate-record.md`](r4-gate-record.md) §G5, §8-5. |
| **G6** | Per-run approval | ☐ OPEN | Explicit product-owner approval **in the dispatching turn** (channel, seller-account owner, date, operator, run scope, §7 abort criteria). Template in [`r4-gate-record.md`](r4-gate-record.md) §G6; never standing; not given. |

**Gate summary:** G1/G2/G4/G5 ✅ (G2/G5 recorded 2026-07-12 → [`r4-gate-record.md`](r4-gate-record.md),
[`decisions.md`](decisions.md) D-024). **G3 (stable env + live-work pause lift) and G6 (per-run approval)
remain the only OPEN gates** — operator/product-owner-owned, not Runtime code. This pack records no live action.

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

**N/A — deferred.** No live NAVER contact is permitted (blocked by G2–G6 + the live-work pause). Fixture-level
session probing is covered under §8-2 (Session precondition probe). A read-only live probe is the ONLY permitted
pre-pilot live contact and only **if the gate requires it** — to be produced separately, under explicit approval,
if and when G2/G3 are satisfied.

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

## Readiness summary

- **Technical adapter readiness (§1 P9):** substantially green — every §6 item verified on NAVER fixtures
  (§8-2), the headed human-click proof passed (§8-3), the abort drill covers every fail-closed exit + operator
  abort with recovery (§8-6), and the privacy sweep is clean on wire + store (§8-7).
- **P10 (rollback/abort reviewed; abort path tested on fixtures):** ✅ — §8-6.
- **P11 (pre-live evidence pack assembled):** ✅ — this document.
- **Remaining before any live run:** the operator/product-owner gates **G2** (seller consent / pilot seller
  identity), **G3** (stable environment) + the **NAVER live-work pause lift**, **G5** (policy-track log), and
  **G6** (per-run approval in the dispatching turn) — plus, only then, a separately-approved read-only live
  session probe (§8-4). None of these are Runtime code.

**This pack authorizes no live NAVER contact.**

---

## Related

- Gate + readiness source → [`r4-preparation.md`](r4-preparation.md) §1/§3/§6/§7/§8
- Durable decisions → [`decisions.md`](decisions.md) D-019/D-020/D-021/D-022/D-023
- Living handoff state → [`current-state.md`](current-state.md)
- Capability ledger → [`checklist.md`](checklist.md) row 14
