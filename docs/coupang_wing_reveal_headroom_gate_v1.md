# Coupang WING Reveal Headroom Gate v1

> **Status:** offline. Adds a **pre-press** capability gate to the reveal walk: before the operator is asked to
> press `API Key 발급 받기`, the run measures whether any of its Stage-2 detectors could actually observe the
> result, and refuses if none can. No live run, no browser, no marketplace contact. Selector, calibration, census
> fields, the Stage-2 predicate's disjunction, deletion tooling, NAVER, and the guided tutorial are unchanged.

## The defect this closes

`Coupang WING Reveal Observation Predicate Repair v1` added `stage2DisjunctsWithHeadroom` so a run could report
its own blindness *before* the operator acted. It computed the right thing in the wrong place, and the reveal
walk never used it:

| where | what |
|---|---|
| `coupang-wing-reveal-driver.ts:525` | `detectableDisjuncts` computed **inside `observeRevealOutcome()`** — after the press |
| `run-coupang-wing-reveal-live.ts` | **zero** references to it; `REVEAL_WALK_STOPS` had no blind-instrument member |
| the emitted record | omitted it entirely; it survived only as `detectableDisjunctCount` in a log line |

So the capability report existed, arrived after the irreversible part, and arrived as a bare integer. The
property the repair was written for — *know before the operator acts* — was not reachable from the walk.

### The part that matters more

Moving the call earlier would not have been enough, and the reason is the fourth instance of this workstream's
recurring defect.

`stage2DisjunctsWithHeadroom` ends with `if (!b.submitAffordancePresent) out.push("submitAffordancePresent")`. On
WING that field is measured `false` — and the 2026-08-09 run proved it stays `false` through a Stage-2 the
operator was looking at, because the field reads `button[type='submit'], input[type='submit']` and WING's
component library emits `<button type="button">`.

So `!false` gives it headroom on **every** WING baseline, forever, via the one term proven unable to move. A gate
counting structural headroom would therefore pass on every WING run — reporting capability on the strength of the
detector known to be blind, and never once firing.

**Structural headroom is a fact about the ladder. Detectability is a fact about the surface.** Reading the first
as the second is the same shape as `role: "button"` (an expectation named like an observation), `matchCount: 1`
(uniqueness guarding identity), and `submitAffordancePresent` false→true (a criterion the markup cannot satisfy).

## What landed

**Three layers, not one** (`stage2DetectionEligibility`, pure, in the driver):

```
structuralHeadroomDisjuncts   below its ceiling on this baseline — says nothing about WING
empiricallyRefutedDisjuncts   structural headroom that live evidence has already refuted here
eligibleDetectionDisjuncts    headroom that is not refuted — the ONLY set the gate may read
```

`WING_EMPIRICALLY_REFUTED_DISJUNCTS` is `["submitAffordancePresent"]`, and membership requires **live evidence of
blindness**, never a hunch. The failure direction is deliberate: adding a name shrinks the eligible set and makes
the gate stricter, so a mistake here costs a refused run, not an unwatched press.

The refuted set is intersected with structural headroom rather than listed unconditionally — a disjunct already at
its satisfying value has no headroom, so nothing is claiming it as capability and nothing needs subtracting.

**`submitAffordancePresent` stays in the predicate.** A real Stage-2 that does emit `type=submit` should still be
recognised. Only the *pre-press capability claim* drops it. The two are now separately expressible, which they
were not before.

**The gate** — in `runRevealWalk`, computed from `classified.observation`, which the walk already held:

- runs **before `probeIssueMatch()`**, so before anything is tagged, highlighted, or disclosed as pressable
- `eligibleDetectionDisjuncts.length === 0` ⇒ stop `BLIND_INSTRUMENT`, **exit 9**
- on that path: no probe, no tag, no overlay, no checkpoint copy, no press hint, no press wait, no observation
- the overlay teardown still runs, like every other exit

**Exit 9 is distinct from 7 on purpose.** Both mean "nothing was observed", but 7 says the surface or the operator
ended the run and 9 says SellerOps' own instrument was not fit to watch it — the difference between re-running and
repairing. Folding it into 7 would hide the one result that must not be retried as-is.

**Disclosure**, printed immediately above the press request and again as the refusal's justification — names and
counts of all three sets. Names are field identifiers; no DOM, text, value, selector, or URL.

**The emitted record** carries the three sets themselves, plus the driver's independent post-press recomputation
over the same baseline. Both, so they cannot silently diverge; a test asserts they agree. A count alone must never
be the only surviving evidence — that shape is what made `SURFACE_UNCHANGED` uninterpretable.

**The preflight** now states the refusal in the manifest disclosure, so the operator's grant is given against a
run that may decline before asking them to act.

## What this gate does NOT claim

It does not assert that Stage-2 will be detected. Stage-2 has never been measured; nothing written today can
promise that. The assertion is much weaker and is the only honest one available:

> We do not ask the operator to take a real marketplace action when every remaining detector is one we have
> already proven blind.

`SURFACE_CHANGED_UNRECOGNIZED` remains a perfectly possible outcome of an eligible run, and remains informative.

## A fixture that was quietly modelling the old collector

`BASE_CENSUS` in the walk tests omitted the three Stage-2 fields, so under the gate every existing walk test
became a blind baseline and stopped at `BLIND_INSTRUMENT` — the suite would have been testing the gate instead of
the walk. The fixture now measures them, because the shipped census always emits them, and `blindObservation()` is
the deliberate version of that baseline. Worth recording: the fixture was a pre-repair collector, and nothing said
so until the gate made it fail.

## Verification

typecheck green. Full collector suite: **309 files / 7594 tests passed**, 18 files + 142 tests skipped (was 7576 —
**+18**). Selfchecks after commit: `wing-reveal` 0, `wing-probe` 0, `wing-deletion` 2 (PARTIAL by design, the
withdrawn deletion calibration).

**Mutation battery: 16/16 caught.** The load-bearing ones:

| id | mutation |
|---|---|
| G1 | gate reads **structural** headroom instead of the eligible set — the whole point of the unit |
| G5 | gate moved **after** the highlight — the live page is tagged before the refusal |
| G6 | refuted list emptied — `submitAffordancePresent` counts as capability again |
| G8 | eligible set aliased to structural headroom — the split becomes decorative |
| G10 | an **unmeasured** signal promoted to headroom, and so to eligibility |
| G12 | emitted record keeps only a **count** of the eligible set |
| G13 | emitted eligibility **fabricated** rather than computed |
| G16 | `BLIND_INSTRUMENT` exits 0 — a refused run reads as a good one |

No Chromium fixture applies: the eligibility layer is pure TypeScript over an already-computed observation and
touches no in-page script. Stating that rather than reporting a fixture run that would prove nothing.

## Not in this unit

No live run, no browser, no WING contact. No selector or calibration change. No census field change. The Stage-2
predicate's disjunction is byte-identical. No deletion, NAVER, credential, connect, or sync work. No guided
tutorial restructure.

## Next

`Coupang WING Issuance Form Reveal Live v3`, from the new SHA only: fresh bootstrap → Approval Manifest → fresh
single-use grant → operator navigation → `ready` → highlight → **`eligibleDetectionDisjuncts` printed before the
press request** → the operator presses only if it is non-empty → one sanitized observation → STOP. An empty set
means BLIND_INSTRUMENT and the operator is never asked to press.

Then, separately, a READ_ONLY Stage-2 recon measuring the real purpose/control/label structure. Only after that is
the guided tutorial redesigned.
