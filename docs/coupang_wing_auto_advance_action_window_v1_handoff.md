# Coupang WING Auto-Advance Action Window v1 — session handoff

**Branch** `feat/coupang-product-path-guided-issuance-e2e-v1`.

Three units landed on this branch back to back: `Coupang Product-Path Guided Issuance E2E v1`,
`Coupang WING Auto-Advance Action Window v1`, and `Coupang WING Auto-Advance Review Findings Repair v1`.

An independent `/code-review high` over `main...HEAD` found **8 real defects**, five of which were merge
blockers. **All eight are fixed** — see §6. The green test suite did not catch any of them, which is the main
thing to carry forward: every fix landed with a test that fails without it.

---

## 1. What now works (live-proven)

The product path runs end to end without the seller touching a terminal or returning to the SellerOps tab.

| Capability | Evidence |
|---|---|
| Local Agent starts as an installed **launchd service** (no terminal) | `install` → `healthy:true`, `approvalPresenter: macos_native` |
| Pairing approval in the product UI + macOS dialog | `bridge_pair_presented {status:"presented", elapsedMs:6692}` |
| Dedicated window opens on the seller's **WING landing**, not blank | `aw_coupang_walk_landing {urlCategory:"wing_host"}` |
| Run **watches** WING instead of parking (blank tab, login) | no `page_mismatch` on a run that started blank |
| **Auto-advance with no button presses** through steps 2–4 | operator-confirmed 2026-08-11: "버튼 없이 자동으로 넘어갔어" |
| Consent auto-advance (both boxes ticked) | operator-confirmed; advanced to the key-creation checkpoint |
| Stops at the key-creation checkpoint | `약관 동의 및 Key 발급받기` never pressed in any run |

**Agent marketplace budget on this branch:** 0 clicks / 0 inputs / 0 submits / **1 navigation** (the landing at
window open, never again) / 0 credential-value reads. `agentNavigations` moved 0 → 1 deliberately, with the CLI
constant, walk descriptor, operation text, action budget, operator disclosure and harness verifier all updated
together.

### Product-principle changes made in these units (both operator-directed)

1. **The walk observes WING's own state to advance.** Four steps advance without the seller pressing anything.
   The WING-resident button remains everywhere as a fallback (safety fence: manual progress always available)
   and because two markers were unproven at the time.
2. **The runtime reads whether the consent checkboxes are ticked.** `buildWingConsentCompleteScript` computes
   the conjunction **in the page** and returns one bare boolean — which box was ticked never crosses the
   boundary, so it cannot be stored, sent, or logged. SellerOps still never ticks a box and never reads the
   terms. All seller-facing copy was rewritten; the previous "체크 여부도 확인하지 않습니다" is gone.

---

## 2. `issue_final` measurement and promotion

The key-creation control now has a calibrated locator and **is highlighted**. The reading, taken 2026-08-11
under the granted walk at git `7fc18eac`:

```
stage3.terms.issue_final   TERMS     visibleCount:1  hiddenCount:0  observedTag:"BUTTON"
stage3.terms.heading       TERMS     visibleCount:1  hiddenCount:0  observedTag:"DIV"      (same pass, 07:33:31)
stage3.terms.issue_final   PURPOSE   visibleCount:0  hiddenCount:1                          (kept on the record)
```

Why this settles it: the terms heading carries character-for-character the same text as the button, so whether
narrowing the query to `button,a` separates them was an open hypothesis. Both were read in the **same pass**
and came back distinct. Every earlier reading was from PURPOSE, where the query matches one **hidden** node —
a hidden unique match is exactly what invalidated the 삭제 record.

Recorded in `WING_FLOW_SCREEN_MARKER_EVIDENCE` (`collector/src/action-window/coupang-wing-label-recon.ts`).
`WING_KEY_CREATION_SELECTOR_CALIBRATED = true`. The spotlight is **gated on that flag** rather than a
hand-written target list, so withdrawing the calibration removes the ring by itself.

Also promoted on the 2026-08-10 walk: `WING_PURPOSE_SCREEN_MARKER_MEASURED` and
`WING_TERMS_SCREEN_MARKERS_MEASURED` (purpose heading `visible:1 tag:DIV`; terms heading hidden on PURPOSE,
visible on TERMS).

**The probe short-circuit that cost a whole live sitting is gone** — `probeFlowScreen` reads every terms
marker in one pass instead of returning on the first visible one.

---

## 3. Independent review — 8 findings, verbatim scope

Reviewer scope: `git diff main...HEAD`. Findings 1–5 were merge blockers. **All eight are repaired** — the
finding text below is kept verbatim as the record of what was wrong; §6 says what each fix was.

### 1. HIGH — `awaiting_wing_surface` is an unrecoverable dead end after the watch window expires
`collector/src/action-window/coupang-issuance/coupang-issuance-session.ts:180`

The `AWAIT_SURFACE` loop is bounded at `surfaceWaitTimeoutMs` (10 min) and just `return`s. But
`awaiting_wing_surface` is deliberately **not** in `COUPANG_ISSUANCE_PARK_STAGES`
(`coupang-issuance-stages.ts:151`), so `maybeRecoverPark()` will not restart it, **and**
`coupangIssuanceAllowedCommands` falls through to the automatic-stage branch which omits
`REQUEST_STEP_RECHECK` — the command is rejected `INVALID_FOR_STATE` and the FE is not even offered the button.
A seller who needs >10 min (2FA, password reset) leaves the run reporting `RUNNING` forever with no blocker and
only `CANCEL_RUN` / `SWITCH_TO_MANUAL` left. **The park this replaced was recoverable; this is not.**

*Direction:* either make the wait recoverable (offer `REQUEST_STEP_RECHECK` in this stage and let
`maybeRecoverPark` cover it) or, on expiry, transition into a genuinely recoverable park rather than returning.
Do not simply raise the timeout.

### 2. MEDIUM — two concurrent `AWAIT_SURFACE` loops
`coupang-issuance-session.ts:171`

`waiting_login` **is** still a park stage, so while loop #1 polls, the FE is offered `REQUEST_STEP_RECHECK`.
Pressing it runs `recheck()` → `stage="opening"` → `"PROBE"` → login again → `waitingFor(...)` → a second loop,
while #1 is still alive. When the seller reaches the issuance page both call `onSurfaceProbed` before either
narrows the stage: `STEP_COMPLETED` for step 1 emitted twice, two `{guide:"issue"}` chains, duplicate
`STEP_READY`/`HUMAN_ACTION_REQUIRED`/`TARGET_HIGHLIGHTED`, two `watchBarrier` observers on one target.

*Direction:* a single-flight guard on the surface-wait loop, like `recovering` already does for park recovery.

### 3. MEDIUM — `reach_open_api` and `return` never migrated to `dockedPanelOnly`
`collector/src/action-window/coupang-wing-issuance-driver.ts:1057`

Both are locator-less guidance steps that still call `mountStepOverlay(page, target)` without the flag — i.e.
they still have the exact defect this branch fixed for the other text-guided steps.
- `return`: the preceding `credentials` step leaves its `data-aw-target` on the Access Key row (nothing clears
  it between steps; `clearHighlight` only runs on park paths), so the overlay finds the **stale anchor**, draws
  the ring on the Access Key row while the panel reads `SellerOps로 돌아가기 7/7`.
- `reach_open_api`: no tag exists on a fresh window, so `mountOverlay` returns at
  `if (!target && !o.dockedPanelOnly) return;` having created nothing — yet `highlightTarget` unconditionally
  returns `{count:1, sig:REACH_OPEN_API_GUIDANCE_SIG}`, so the engine barriers on step 1 **with no on-page
  instruction rendered at all**.

### 4. MEDIUM — `markClosed()` is never called; "a closed window is FORGOTTEN" does not hold
`collector/src/action-window/coupang-issuance/lazy-coupang-issuance-driver.ts:53`

`CoupangWingIssuanceDriver` resolves `whenSurfaceClosed` from `page.once("close")`, but nothing wires it to
`LazyCoupangIssuanceDriver.markClosed()` — unlike `LazyImportDriver`, wired explicitly at
`local-agent.ts:573`. If the seller closes the WING window the engine parks, `maybeRecoverPark` fires a recheck
every second for 10 minutes, and every retry goes through `this.opened` (the dead page): `settleSurface` burns
its 3 s poll and `locateTarget` throws, instead of re-opening in the same persistent profile. `isOpen()` and
`close()` are dead code for the same reason (the driver is a local `const` inside
`buildCoupangIssuanceLiveConfig`), so the window is never closed at agent shutdown either.

### 5. MEDIUM — FE copy contradicts the step's behaviour, in the commit that claims verbatim reuse
`frontend/src/lib/actionWindow/copy.ts:111`

The block comment says the entries are "VERBATIM from `OPERATOR_STEP_LABELS`", but two are the **pre-change**
strings: `revealForm` still ends "화면이 열리면 **아래 버튼을 누르세요**" while the driver says "화면이 열리면
**자동으로 넘어갑니다**", and `reachOpenApi` (line 109) still says "WING 홈에서 …", dropping the new
"WING에 로그인한 뒤 …". Nothing asserts the equality, so the drift the comment warns about is already present.
A seller following the SellerOps-tab copy is told to press a button that is no longer the advance mechanism.

*Direction:* fix both strings **and** add the assertion that pins FE copy to `OPERATOR_STEP_LABELS`, so the
comment's claim is enforced rather than stated.

### 6. MEDIUM — `capableActions` no longer covers what the run does
`collector/src/cli/approval-manifest.ts:644`

Still `OPEN_DEDICATED_WINDOW / WAIT_OPERATOR_LOGIN_NAV / CLASSIFY_SANITIZED_PAGE_CATEGORY /
HIGHLIGHT_REAL_CONTROL / OBSERVE_USER_CLICK_TRANSITION`, but the run now (a) navigates once to the landing
(`agentNavigations: 1`; `APPROVAL_ACTIONS` has **no navigation member at all**) and (b) reads the consent
checkboxes' `checked` state — while two census capabilities in the same enum explicitly document "does not read
`checked`". Both are disclosed in prose (`operatorActionSummary`, `sellerConsentObserved`) but **not in the
machine-checkable list the approval gate validates**, so `capableActions` shows a strictly narrower run than
the one that executes. This is the recurring manifest-honesty defect class.

### 7. LOW — `recoverPark` swallows a drive throw without telling the engine
`coupang-issuance-session.ts:302`

`maybeRecoverPark` wraps the loop in `.catch(() => undefined)` and `recoverPark` awaits `this.drive(...)`
directly rather than via `onDriveError`. A locate that throws during self-recovery — the navigation race this
path exists for — aborts the loop silently: `engine.onDriveFault()` never called, no state published, and since
`maybeRecoverPark` only runs at the end of a drive chain, nothing restarts it.

### 8. LOW — the "one carrier per agent" exclusion was not updated for the live walk
`collector/src/cli/local-agent.ts:1184`

`awChannel` is gated on `hostReply || hostIssuance || hostCoupangIssuance` but not `hostLiveWalk`. On a
non-production boot (the launchd service pins `NODE_ENV=production`, so this needs a hand-run agent),
`--action-window-coupang-issuance-live` plus `--dev-action-window-synthetic` leaves both carriers defined and
`createAgentBridge` throws at boot instead of refusing cleanly.

### Noticed, not reported as findings
- `ALL_STAGES` in `coupang-issuance-stages.test.ts:21` omits `awaiting_wing_surface` (and already omitted
  `checkpoint_reveal_issuance_form`), so the allowed-commands cases do not cover the new stage. **This is why
  finding 1 was invisible to the suite.**
- `run-coupang-wing-issuance-live.ts:110` carries a pre-existing orphaned string-literal statement
  (`"approval-manifest gate, no phase binding and no repo-identity check";`) under the changed constant.

---

## 4. Test + safety state

- collector `npm run typecheck` green · `npm test` **8024 passed | 142 skipped**
- frontend `npm run typecheck` green · `npm test` **1883 passed**
- `tools/coupang-local/wing-walk-selfcheck.sh` **PASS**
- No service installed (`uninstall` run after the last measurement); no plist under `~/Library/LaunchAgents`.

**Live safety boundary — unchanged and must stay so.**
- `약관 동의 및 Key 발급받기` has never been pressed. `keyCreationAutoAdvances: false`; highlighting it is not
  pressing it. Real key creation remains a **separate phase with its own manifest and grant**.
- Agent click / input / submit / credential-value reads all remain **0**.
- `--dev-insecure-auto-approve` remains **banned** for this workstream; the launchd service pins
  `NODE_ENV=production`, so the bridge refuses it structurally.
- Any code change **revokes** the current approval — re-bootstrap for a new `approvalId` and a fresh one-line
  grant (`docs/sellerops_live_approval_contract.md`).

**Dev environment the operator does not run:** Claude starts backend (`:8080`), frontend dev server
(`:5173`), and installs/uninstalls the agent service. The operator touches only product UI, the macOS approval
dialog, and WING. Walk account: `wing-walk@sellerops.test` / `walkproof1234` (fresh org, no seller accounts, so
`resolvePhase` lands on `issuance`). Use a **normal** browser window — a private window discards the pairing
token and forces re-pairing every run.

---

## 5. What the eight repairs were

Unit `Coupang WING Auto-Advance Review Findings Repair v1`. Every fix landed with a test that fails without it;
each was verified to fail against the pre-fix code, not merely asserted to.

| # | Repair |
|---|---|
| 1 | A new **observed-wait** stage class. `awaiting_wing_surface` offers `REQUEST_STEP_RECHECK` throughout the wait (and `recheck()` handles it), and on expiry converts to a recoverable `page_mismatch` park carrying **`SURFACE_SETTLE_TIMEOUT`** — "화면이 아직 준비되지 않았어요", which is what happened, rather than `UI_DRIFT`'s "화면이 바뀐 것 같아요", the message this stage exists to stop showing someone who was simply not there yet. Deliberately **no auto-restart**: the park is reached *by* a watch running out, and restarting it would poll a page nobody is looking at for as long as the agent lives. |
| 1b | `ALL_STAGES` gains `awaiting_wing_surface` + `checkpoint_reveal_issuance_form`, plus an exhaustiveness case (a new stage cannot be added without being covered) and a general "every non-terminal stage can ask the runtime to look again". |
| 2 | Fixed in **both** places it can go wrong: a single-flight guard on the surface-wait loop (the duplicate *watcher*) and a stage guard in `onSurfaceProbed` (the duplicate *advance*). |
| 3 | `reach_open_api` and `return` moved into `TEXT_GUIDED_SIG`, so all five locator-less steps take one branch: clear the prior tag → mount docked → **report what actually mounted**. |
| 4 | `markClosed()` wired at the carrier (`page.once("close")` inside `open()`), and the walk's window is closed with the agent that opened it — `isOpen()` / `close()` stop being dead code. |
| 5 | Three FE strings corrected, and the "VERBATIM" comment replaced by an assertion: `collector/test/crossstack/coupang-issuance-fe-copy-parity.test.ts` pins all seven character-for-character to `OPERATOR_STEP_LABELS` (now exported). |
| 6 | Two new `APPROVAL_ACTIONS`: `NAVIGATE_TO_SELLER_LANDING_ONCE` and `OBSERVE_CONSENT_COMPLETE_AGGREGATE`. The test asserts the **general** form — a boundary claim without a matching capability fails. |
| 7 | `recoverPark` routes a drive throw through `onDriveError` instead of awaiting bare under a swallowing `.catch`. |
| 8 | `awChannel`'s one-carrier exclusion now includes `hostLiveWalk` (and `hostLiveWalk` is decided before it is used). |

Two things the reviewer noticed but did not file are also gone: the orphaned string literal in
`run-coupang-wing-issuance-live.ts`, and — found while re-running the selfcheck — the **preflight's operator-facing
summary line**, which still read "navigates nothing · 2 highlighted + 4 text-guided" while the verifier beside it
demanded `agentNavigations:1 / 3 / 2`. Same defect class as finding 6, in the sentence the operator grants against.

The pattern to keep watching for: **a guard fixed in one place and left standing in its sibling.** It caused
three defects in the first two units and four of these eight; findings 2 and 3 were each repaired in *both*
places for that reason.

### The second review round

Re-running `/code-review high` over the repaired branch found **7 more**, one HIGH. Two were introduced by the
repair itself, which is the point of re-reviewing rather than re-running the suite:

| # | Defect | Repair |
|---|---|---|
| 1 HIGH | **The park-recovery timer re-opened the seller's closed window.** Wiring `markClosed()` made the lazy driver bring a window up on the next call — so a park from a closed surface put a recheck on a 1 s timer that re-launched Chrome *and* re-ran the landing `goto`, for ten minutes. `agentNavigations: 1` stopped being true. | A `surfaceClosed` latch: no timer recovers a closed surface; the seller's own command clears it. The landing navigation is latched to once per **carrier**, not per open. The closure watch is re-armed on every guide, so a re-opened window is watched too. |
| 2 | `markClosed()` fired on the first page's close even when the run had moved to a newer tab. | The close handler forgets the surface only when the context has **no page left**. (The orphan half was already fixed by giving the carrier its own `closeSurface()`.) |
| 3 | The install health probe read `BRIDGE_PORT` from the installing **shell**; launchd gives the agent the plist's env, so a configured port made `install` poll the wrong one, time out, and `exit 5` on a healthy service. | `install` probes `plan.env`; `status` reads the installed plist. |
| 4 | **The auto-advance could fire on arrival.** The first screen probe ran at `i === 0` with no baseline, so a marker already painted when the step was armed completed it with zero seller action. | The screen must **change into** the expected one, measured against a baseline taken at arm time; an unreadable baseline disables screen-advance and the seller's on-page button carries it. |
| 5 | The **bootstrap's** disclosure still said "the agent never navigates" and "the two live-calibrated controls" — the same drift as the preflight line, in the half nothing grepped. | Rewritten to the verified descriptor, and the selfcheck now asserts both the current claims and the absence of the retired ones. |
| 6 | The key-creation locator was a second hand-written copy of the measured candidate, defeating the invalidation rule `WING_KEY_CREATION_SELECTOR_CALIBRATED` documents. | Derived from `WING_TERMS_SCREEN_MARKER_SPECS`, failing at load if the measurement is gone. |
| 7 | `waiting_login` has no expiry recovery. | **Accepted, not fixed** — and now argued in the code rather than asserted: it is already a park carrying `LOGIN_REQUIRED` with the button offered, so the expiry is not silent; there is no WING-resident surface to offer anything else on; and restarting the watch would poll a login page for as long as the agent lives. |

## 6. Remaining

1. One **fresh** live walk on the product path (the run must survive a >10 min login and render step 1's panel
   with no stale ring). Fresh bootstrap → manifest → STOP for a grant; any code change revokes it.
2. PR → merge, as one PR for the whole branch.

Do not merge on a green suite alone. Every one of the 8 defects was present while it was green.
