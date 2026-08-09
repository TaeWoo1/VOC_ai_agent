# Coupang WING Reveal Observation Predicate Repair v1

**Status:** landed · offline unit · no live run, no WING window, no probe
**Trigger:** the `Coupang WING Issuance Form Reveal Live v2` run of 2026-08-09 at `0297d307`
**Predecessor:** `docs/coupang_wing_issuance_form_reveal_v1.md` (whose expected-outcome predicate this replaces)

## What the live run established

The reveal itself worked. SellerOps highlighted the real `API Key 발급 받기` control, **the operator confirmed the
highlight visually**, pressed it themselves, and a **persistent purpose-selection surface appeared**. Agent
click/type/submit budget: zero. Nothing was selected; no `확인` was pressed.

The instrument then reported:

```
outcome        SURFACE_UNCHANGED
changedSignals []
```

Zero deltas, for a surface a human was looking straight at.

## The defect: the success criterion was unreachable, not unmet

```js
submitAffordancePresent: document.querySelector("button[type='submit'], input[type='submit']") != null
```

The control the run highlighted was reported by the operator as `<button type="button"
id="policyAgreementWithAutoCategoryBtn" class="wing-web-component btn-api-key-gen">` — **operator-reported, not
machine-measured**, and the same sighting that `docs/coupang_wing_issue_selector_calibration_landing_v2.md`
deliberately declines to promote to an anchor. It explains *why* the detector fails. The failure itself does not
depend on it.

**Proven by the run's own baseline, not inferred.** The *before* census — taken on the page that visibly
contained that button, the one the operator saw a ring around — recorded `submitAffordancePresent: false`. A page
with a working, visible button read as having no submit affordance. So the predicate `submitAffordancePresent`
false→true could never fire on any WING screen built from that library. The run could not have passed.

**And the backup signals had no headroom.** `countBucket` is `0 → none · 1–3 → few · >3 → many`. On the initial
surface `editableTextInputCount` and `listLikeContainerCount` were **already `many`** — a saturated bucket cannot
report an increase. A modal is not a navigation, so `pageCategory` did not move either. `changedSignals: []` is
the correct output of a broken instrument, not a quiet page.

This is the third instance of one defect class: **a guard placed one layer away from the thing it guards.**
`role: "button"` was an expectation dressed as an observation. `matchCount: 1` guarded uniqueness while identity
was the question. Here, a criterion measured a property the target markup never exhibits — and stayed
unfalsifiable until a run finally reached it.

## What changed

### The field that lied is documented, not widened

`submitAffordancePresent` keeps its implementation and gains a docstring stating exactly what it reads and what
it demonstrably does **not** see. It is not widened to count `<button type="button">`: "a submit control exists"
would then be false wherever any button is.

The **name** is still broader than the measurement, and renaming is its own unit — recorded below.

**A correction review forced here.** An earlier draft justified that deferral with "it is shared with the NAVER
API-center census". It is **not**: `observe-api-center.ts` declares a separate interface with its own in-page
script and a byte-identical selector, so changing the WING field reaches none of it, and the "67 references /
23 files" figure conflated two independent fields. Nobody has measured whether NAVER's controls are `type=submit`
either — so that surface plausibly carries the same latent defect. That is a reason for the rename unit to cover
both, not a reason this one could not act.

### Three signals with headroom by construction

All generic HTML/ARIA. No WING selector, no text, no value.

| signal | reads | why it has room to move |
|---|---|---|
| `dialogLikePresent` | painting `dialog[open]` · `[role='dialog']` · `[role='alertdialog']` · `[aria-modal='true']` | false on a page with no modal |
| `choiceControlCountBucket` | painting, enabled `input[type=radio\|checkbox]` · `[role='radio']` · `[role='option']` | a purpose-**selection** surface is the shape most likely to add these; zero-based |
| `actionControlCountBucket` | painting, enabled `button` · `[role='button']` · `input[type=button\|submit\|reset]` · `summary` | the shape-agnostic one — cards, buttons and radios all move it |

`actionControlCount` uses a **wider ladder** (`0 · 1–3 · 4–8 · 9–20 · >20`) precisely because a real page has
plenty of buttons and the three-step ladder would saturate on contact — the exact failure this unit is repairing.

Two scoping decisions worth stating:

- **The visibility filter applies only to the new signals.** Retro-filtering `editableTextInputCount` and friends
  would silently change what every recorded capture meant, including the baseline this unit reasons from.
- **The new signals are optional end to end.** A census taken before they existed carries `undefined`, and
  `undefined` must stay distinguishable from a measured `false`/`none`. `toWingSignals` omits them rather than
  defaulting, and each new disjunct **abstains unless both ends were measured** — a transition needs two
  endpoints, and an absent baseline is not a zero.

### The predicate

`stage2SurfaceRevealed` — a **disjunction**, because Stage-2's actual shape is unmeasured:

```
dialogLikePresent false→true
  OR choiceControlCountBucket rose
  OR actionControlCountBucket rose
  OR submitAffordancePresent false→true   (retained, not load-bearing on WING markup)
```

**What it still does not promise.** Nobody has machine-read Stage-2, so no predicate written today can be
guaranteed to fire on it. If none of these move but something else does, the honest answer stays
`SURFACE_CHANGED_UNRECOGNIZED` — a STOP, and a *better* result than `SURFACE_UNCHANGED` because it means the
instrument saw something. The point of the repair is that a predicate must be **satisfiable**, not that it must
succeed.

## The guard that would have caught this on day one

`test/action-window/coupang-issuance/reveal-outcome-predicate.test.ts` (29 cases):

- **Headroom, at run time.** `stage2DisjunctsWithHeadroom(before)` reports which disjuncts could still fire on
  the surface the run is actually looking at, and it rides in the walk record and the log line. This is the check
  whose absence let an unsatisfiable criterion ship — and, unlike a fixture assertion, it answers the question on
  the real page. An empty list means the run is blind whatever its outcome says. A test ties it to the predicate:
  a disjunct absent from the list cannot be made to fire by any `after`.
- **Headroom, in fixtures** — kept, but labelled for what it is. It constrains `SYNTHETIC_INITIAL`, whose three
  new values are ASSUMED, not measured.
- **Individually decisive.** Each disjunct is exercised by a delta that changes that signal *alone*, so a term
  that has become dead code fails rather than hiding behind its neighbours.
- **The regression, from the run's own numbers.** The recorded baseline is reproduced verbatim, and the OLD
  predicate is shown to stay false against every plausible Stage-2 shape while the new one fires.
- **Direction and no-evidence.** A decrease is not an increase; `undefined` is neither.
- **Fail-closed ordering intact.** `OVERLAY_NOT_CLEARED` → `credential_shown` → off-surface → unchanged, each
  pinned against a *maximal* fake delta so the ordering is what stops interpretation, not an unconvincing input.
- **The shipped in-page script, executed for real** against a fake DOM — the same technique as the
  visibility-filter guard, and for the same reason: a Chromium fixture is skipped in CI (`RUN_INTEGRATION: ''`),
  and "a check that never ran" is the failure mode this unit exists to close. It reproduces the defect directly
  (WING's own button ⇒ `submitAffordancePresent: false`, `actionControlCount: 1`).
- **Sanitization.** The census output is asserted to contain only booleans and numbers, and no page text.

### A failure mode the repair does NOT create — corrected after review

An earlier draft of this document, the driver docstring, and the commit message all claimed the new
`actionControlCount` would count SellerOps' own overlay button, making an uncleared overlay able to manufacture a
`CONFIGURATION_SURFACE_SUSPECTED`. **That is false for this walk.** `highlightIssueCheckpoint` mounts the overlay
*without* `advance`, and `overlay.ts` creates its `<button>` only inside `if (o.advance)`. What this step injects
is a ring `div[aria-hidden]`, a badge `div`, and a copy-only panel `div[role=note]` — and `role=note` is not a
dialog. None of the three new signals matches any of it. The driver's own docstring said so three paragraphs
above the claim.

Worse, the test "pinning" it was vacuous: it asserted the string `document.createElement("button")` appears
somewhere in `overlay.ts` — true, in the branch this driver never takes — and then counted a hand-written fixture
node with no derivation from the overlay at all. It could not fail.

Replaced with the guard that matters: **this call site must never pass `advance`.** Adding one would put a
clickable SellerOps control in front of a seller mid-action on a live marketplace page — a safety regression in
its own right — and only incidentally also fabricate a Stage-2 delta. `OVERLAY_NOT_CLEARED` remains ordered ahead
of every interpretation regardless, pinned against a maximal fake delta.

The cost of the error was not the false sentence; it was that the commit spent its entire false-positive analysis
on a non-risk and left the real contamination sources unexamined. Those are now in "Limits" below.

## Limits — the false positives this repair makes possible

Review's sharpest point: the commit spent its false-positive analysis on a risk that does not exist and left the
real ones unexamined. **The direction matters.** A false negative yields `SURFACE_CHANGED_UNRECOGNIZED` — a STOP,
a warning block, and an honest record. A false positive yields exit 0, "the outcome this run was built to
expect", and gets written into the next unit's evidence base as a structural belief about a surface this document
otherwise insists is `structuralMarkerMeasured: false`. **False positives are the worse direction here**, and the
new signals are twitchier than the ones they join.

- **The driver's own scroll.** `mountOverlay` calls `scrollIntoView()` between the before-census and the
  after-census. Sticky action bars, floating "TOP" buttons and lazy-loaded sections routinely appear on scroll —
  each a painting, enabled action control. Crossing a wide-bucket edge would read as a reveal with zero operator
  action.
- **Incidental modals.** A WING notice popup, consent banner or chat launcher rendering `[role='dialog']` or
  `[aria-modal='true']` inside the poll window flips the strongest disjunct outright.
- **First-flicker polling.** `observeRevealOutcome` breaks at the *first* differing signal. Against coarse
  saturated buckets that was nearly inert; against these signals a spinner or a toast can end the poll before the
  surface settles — even though "persistent" is the one property the operator actually reported about Stage-2.

**A dwell / re-confirm before classifying is the obvious guard, and it is deliberately NOT in this unit.** The
approved manifest budgets "1 operator-performed 발급 press + **1 sanitized observation**"; taking a second
post-press read to confirm persistence expands what the agent does on the page beyond what the operator granted.
That is a manifest change, not an implementation detail, and it belongs to the run that asks for it.

Until then, the mitigation is honesty at the boundary: `detectableDisjuncts` records what the run *could* have
seen, and a `CONFIGURATION_SURFACE_SUSPECTED` remains "consistent with", never proof.

### `actionControlCountBucket` may already be at its ceiling on the real WING page

The wide ladder tops out above 20 painting, enabled controls. The repo's own recorded reasoning for why
`editableTextInput` and `listLikeContainer` read `many` — "the WING shell (navigation, search, menus) supplies
most forms, inputs and list containers" — applies equally to buttons, and a seller-center shell plausibly carries
more than 20. If so, that disjunct is dead on the live surface exactly as its predecessor was.

This is **unmeasured**, and the unit tests cannot settle it: they assert headroom against an *assumed* baseline,
which constrains the fixture and not WING. That is why `stage2DisjunctsWithHeadroom` exists — the next live run
reports which disjuncts had room to move **before** the operator is asked to act, so "the instrument was blind"
is something the run says about itself rather than something discovered afterwards.

Also narrower than "shape-agnostic" claims: clickable `<a>`, `<label>` and plain `<div onclick>` option cards —
common in Korean marketplace UIs — match none of the three selector sets.

## Provenance: what is measured, and what is only reported

> **⚠ SUPERSEDED 2026-08-09.** The table below describes `WING_STAGE2_LIVE_EVENT` **as it stood after this
> unit**. That content is now the *superseded* half of the record, reachable as `WING_STAGE2_LIVE_EVENT.supersedes`
> (`WingStage2ApparatusFailure`, `cause: PREDICATE_UNSATISFIABLE_ON_WING_MARKUP`). The live constant now records
> the v3 run, which **did** detect Stage-2 — `apparatusOutcome: CONFIGURATION_SURFACE_SUSPECTED`,
> `measuredTransition: choiceControlCountBucket:none->few`. See
> `docs/coupang_wing_reveal_live_v3_evidence_landing.md`. The rows for `structuralMarkerMeasured`,
> `keyCreationRuledOut` and `issuedStateReason` are still accurate; the first two rows are not.

`WING_STAGE2_LIVE_EVENT` recorded the live event with the attribution attached to each part — the distinction both
previous calibration failures got wrong:

| | |
|---|---|
| Stage-2 appeared, and was persistent | **OPERATOR_REPORTED** |
| the apparatus's verdict | `SURFACE_UNCHANGED`, `changedSignals: []` |
| any structural property of Stage-2 | **`structuralMarkerMeasured: false`** — not a tag, not a role, not a count |
| `keyCreationRuledOut` | `false`, unchanged |
| `issuedStateReason` | `NO_DISCRIMINATING_SIGNAL`, unchanged |
| operator selected a purpose / pressed 확인 | `false` / `false` |

The operator's transcription — `이제 키의 사용 목적을 골라주세요.` — is recorded **only** as a candidate under
`WING_STAGE2_RECON_CANDIDATES.purpose`, with its rationale stating it is a hypothesis: no apparatus has matched
it, the transcription may differ from the DOM in whitespace or punctuation, and it may be a heading, a toast or a
dialog title. A test asserts the string does **not** appear in the census script — promoting one human
transcription to a machine-checked marker is the move that would repeat the whole sequence.

The hypothesis set stays inert: `purpose` is in neither `WING_RECON_TARGETS` nor `WING_RECON_APPROVED_SCOPE`.

## Verification

- typecheck green; full collector suite **7576 passed / 142 skipped, 0 failed** (+30)
- reveal, probe and deletion regressions unchanged; deletion selfcheck still PARTIAL/exit 2 by design
- **mutation battery: 26/26 caught** — the predicate's four disjuncts individually, direction inversion, an
  always-true predicate, the fail-closed ordering, the bucket ladder, the census filters and selectors, the
  optional-signal handling, every provenance field, the run-time headroom report, and an `advance` button being
  added to this walk's overlay
- independent review

### The battery found a real bug, which is the point of running it

The first cut compared bucket ranks with `undefined` sorted below `none`. That made `undefined → none` read as an
**increase** — a Stage-2 reveal reported because the *instrument* gained a signal, on a page where nothing
happened. No test distinguished it, so the mutation that "fixed" it survived, which is how it surfaced.

It is the same false-positive shape the repair exists to remove, one level up: a comparison between a measurement
and the absence of one. Now every new disjunct requires both ends measured, and `P9`/`P9b` pin both the rank
guard and the dialog disjunct's strict `=== false` baseline check.

The battery was also written in Python rather than bash, because two mutation strings contain both quote
characters and the previous unit lost a mutation to exactly that quoting trap — it reported green without ever
applying.

## Not in this unit

No live run, no WING window, no probe. No selector recalibration. No 7-step guided-tutorial restructure. No
자체개발 promotion. No deletion tooling change. No credential / connect / sync work.

## Still open

- **`submitAffordancePresent` is still named more broadly than it measures.** Renaming touches the NAVER
  API-center census (67 references, 23 files) and belongs in its own unit.
- **Stage-2 remains unmeasured.** Nothing structural about it is known.
- `wing-probe-selfcheck.sh` still exits 0 while skipping its clean-tree half on a dirty tree.

## Next

> **⚠ AMENDED 2026-08-09 — the headroom report landed here was never wired into the walk.** It was computed
> inside `observeRevealOutcome()`, i.e. *after* the press, and surfaced only as a count in a log line, so the
> "known before the operator is asked to act" property this document claims was not reachable from the reveal
> CLI. Worse, gating on it directly would have been vacuous: `submitAffordancePresent` has structural headroom on
> every WING baseline via a term live evidence proved cannot move. Closed by
> `docs/coupang_wing_reveal_headroom_gate_v1.md`, which splits structural headroom from empirical detectability
> and refuses **before** the highlight when only refuted detectors remain. Step 1 below now runs under that gate.

1. **Live:** a fresh Reveal Live run — bootstrap, manifest, fresh grant — where the operator presses
   `API Key 발급 받기` and the corrected observer attempts to **machine-detect** Stage-2. Sanitized evidence, one
   observation, STOP. `SURFACE_CHANGED_UNRECOGNIZED` is an acceptable and informative result.
2. **Then, separately:** a READ-ONLY Stage-2 recon measuring the real controls and labels.
3. **Only after that:** redesign the guided tutorial plan. Not before — the plan needs measured Stage-2 DOM, which
   still does not exist.
