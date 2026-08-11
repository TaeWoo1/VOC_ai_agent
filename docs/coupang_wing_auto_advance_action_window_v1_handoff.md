# Coupang WING Auto-Advance Action Window v1 — session handoff

**Branch** `feat/coupang-product-path-guided-issuance-e2e-v1` · **HEAD** `e05b2c3d` · clean, **not merged, no PR**.

Two units landed on this branch back to back: `Coupang Product-Path Guided Issuance E2E v1` and
`Coupang WING Auto-Advance Action Window v1`. 23 commits, 49 files, +2931/−244.

An independent `/code-review high` over `main...HEAD` found **8 real defects**, five of which are merge
blockers. **Do not open a PR or merge until at least findings 1–5 are fixed.** The green test suite did not
catch any of them, which is the main thing to carry forward.

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

Reviewer scope: `git diff main...HEAD`. Findings 1–5 are merge blockers.

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

## 4. Test + safety state at `e05b2c3d`

- collector `npm run typecheck` green · `npm test` **7975 passed | 142 skipped**
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

## 5. First actions for the next session

1. **Fix finding 1 first**, and with it the test gap that hid it — add `awaiting_wing_surface` (and
   `checkpoint_reveal_issuance_form`) to `ALL_STAGES` so every stage's allowed-commands are covered. The
   pattern to watch for across all of these: **a guard fixed in one place and left standing in its sibling.**
   That was the cause of three separate defects in these units (`onReachVerified` parks, the two overlay steps
   in finding 3, the descriptor fields), and findings 1–4 are all further instances.
2. Then 2, 3, 5 (blockers), then 6 (manifest honesty), then 7, 8.
3. Re-run collector + frontend suites and `wing-walk-selfcheck.sh`.
4. Re-run `/code-review high` over `main...HEAD` — the fixes touch the same seams the findings came from.
5. One **fresh** live walk to confirm findings 1/3 are actually gone on the product path (the run must survive
   a >10 min login and render step 1's panel with no stale ring). Fresh bootstrap → manifest → STOP for a grant.
6. Only then PR → merge, as one PR for the whole branch.

Do not merge on the current green suite alone. Every one of these 8 defects was present while it was green.
