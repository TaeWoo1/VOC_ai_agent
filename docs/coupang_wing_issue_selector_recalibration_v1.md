# Coupang WING Issue Selector Recalibration v1

**Status:** landed · offline unit · no live run
**Trigger:** the `Coupang WING Issuance Form Reveal Live v1` attempt on 2026-08-09, aborted at the checkpoint
**Predecessor:** `docs/coupang_wing_issuance_form_reveal_v1.md` (whose calibration claim this unit withdraws)

## What happened live

The reveal harness passed every gate. Bootstrap minted a fresh identity at `9da07a9f`, preflight passed all 14
checks, the manifest displayed, the operator granted, the run classified the surface as `open_api_issuance`,
resolved the 발급 control to a unique match, and logged `highlighted: true`.

The operator saw no highlight. Not on the wrong control — **nowhere on the page**.

Nothing was pressed. The operator reported the real control's markup, the run was aborted at the checkpoint
(exit 7, overlay cleared), and the account remains in the REAL NO-KEY state.

## Two independent defects, both in the same selector

```ts
issue: { candidateQuery: "button,a,span,div", exactText: "발급" }   // refuted
```

**1. The text could never have matched.** `exactText` compares the element's *whole* normalized text. The real
control reads `API Key 발급 받기`. A spec looking for exactly `발급` cannot match it — not on a bad day, not ever.

**2. The locator had no visibility filter.** So the unique match it *did* find was a node that does not paint.
The read-only tag landed on an invisible element, and every downstream check agreed: `matchCount === 1`, tag
written, checkpoint panel painted (the panel is mounted separately and painted fine), `highlighted: true`.

The on-page copy then told the operator to press *"the highlighted 발급 button."* Had they trusted the instruction
instead of their eyes, this run would have pointed a real person at whatever that node was.

## Why four captures called it confirmed

`WING_ISSUE_CALIBRATION_EVIDENCE` claimed `LIVE_DOM_CALIBRATION_CONFIRMED`, `matchCount: 1`, `role: "button"`,
across four captures spanning both account states. Every one of those captures was real. The record was still wrong.

**`role: "button"` was never measured.** `buildFixedLabelLocateScript` returned `{ count, sig }` — no tag, no
role, no visibility. The value came from `WING_TARGET_ROLE`, a hardcoded table of *expected* roles that the
recorder wrote into a field named `role`. The single property that would have exposed the mismatch was the one
property the apparatus could not produce, so asserting it cost nothing and proved nothing.

**`matchCount: 1` was true and irrelevant.** It says the selector hit one element. It says nothing about *which*.
Repeating it across four captures multiplied confidence in a uniqueness claim while adding no evidence about
identity — the captures agreed with each other, and all four were about the decoy.

This is the same defect class that dominated the previous unit, now one level up: **a guard placed one layer away
from the thing it guards.** Uniqueness guarded identity. It does not imply it.

## What landed

**Visibility filter in the shared locator** (`buildFixedLabelLocateScript`). A candidate must paint to be a
match: `display:none`, `visibility:hidden` (inherited, so a hidden ancestor is covered), zero client rects, and
zero-area boxes are all rejected; `display:contents` with children is accepted, since it paints through them.
`count` now means *visible* matches. Shared by the deletion and renewal drivers too — the same latent hole was in
all of them, and a per-driver copy is the drift `wing-harness-common.sh` exists to prevent.

**Value-free diagnostics.** `hiddenCount` (rejected non-painting matches) and `tag` (the measured tag name of the
unique match). Both structural, both counts-or-tagnames, neither carries content. `hiddenCount` exists because
"matched nothing visible" and "matched nothing" are both `count: 0`, and telling them apart is what diagnosing
this failure required. `tag` exists so a calibration record can only state a tag it actually observed.

**Corrected spec:** `issue: { candidateQuery: "button", exactText: "API Key 발급 받기" }`. Narrowed to `button`
for the same reason the text is corrected — the control is a real button, and a span/div satisfying a
button-shaped intent is the failure mode, not a fallback.

**`WING_TARGET_ROLE` → `WING_TARGET_EXPECTED_ROLE`**, and the record field `role` → `expectedRole`, alongside a
new **measured** `observedTag`. An expectation and an observation must not share a name.

**Calibration withdrawn.** `WING_ISSUE_SELECTOR_CALIBRATED = false`;
`WING_ISSUE_CALIBRATION_EVIDENCE.status = LIVE_DOM_CALIBRATION_REFUTED`, carrying the refuted spec, what it
observed (`visibleMatchCount: 0, nonPaintingMatchCount: 1`), the operator-reported element, and
`reconfirmationRequires`. A new constant `LIVE_DOM_CALIBRATION_REFUTED` distinguishes *measured and found wrong*
from *never measured*: they carry different obligations.

## Why the flag is still false

The spec is corrected and the locator is fixed. **Neither is a measurement.** Nobody has observed the corrected
spec resolve on a live WING page. Re-asserting `true` on the strength of a plausible fix is the identical move
that produced the refuted record — a claim about the live DOM written from something other than the live DOM.

Everything downstream fails closed, deliberately: the manifest reports `selectorsCalibrated: false`, the preflight
refuses to display a manifest, the gate refuses with `SELECTORS_NOT_CALIBRATED`, and the driver refuses to
highlight. A reveal press is unreachable by any path.

## How the fix is proven

`test/action-window/api-issuance-calibration/fixed-label-visibility.test.ts` executes the **real generated
script** against a fake DOM reproducing the live page — the decoy and the real button side by side. It asserts
the refuted spec resolves to a `DIV` and not the button; that it cannot match the real control at all; that it
now returns `count: 0, hiddenCount: 1`; and that the corrected spec returns `count: 1, tag: "BUTTON"`.

It runs against a fake DOM rather than Chromium on purpose. `collector-ci.yml` sets `RUN_INTEGRATION: ''`, so a
browser fixture would be skipped in CI — and this bug's entire nature was a check that reported success without
ever having been exercised.

**Mutation battery: 12/12 caught, 0 survived** — including reverting the spec, deleting the visibility filter,
hardcoding `hiddenCount` to 0, dropping the measured tag, flipping the flag back to `true`, re-confirming the
evidence status, and doctoring `refutedSpec` to match the shipped one.

## What this unit does NOT do

No selector calibration is restored. No tutorial restructure. No Stage-2 step-plan redesign — that still needs
real Stage-2 DOM, which does not exist, because nobody has pressed 발급.

## Next

A **live READ-ONLY probe** of the corrected spec on the no-key surface, reporting `count: 1`, `hiddenCount: 0`,
`observedTag: "BUTTON"`. The probe harness (`wing-probe-bootstrap.sh`) already exists and presses nothing. Only
after that measurement may `WING_ISSUE_SELECTOR_CALIBRATED` return to `true` and the reveal run be re-attempted.

## Known pre-existing issue, not addressed here

`wing-probe-selfcheck.sh` and `wing-deletion-selfcheck.sh` print `SELFCHECK PASS` with exit 0 while silently
skipping their clean-tree halves on a dirty tree — the fail-open the reveal harness's `PARTIAL`/exit-2 closed.
Identical on `main`, and its own unit. Worth closing before the probe run, since the probe leans on that harness.
