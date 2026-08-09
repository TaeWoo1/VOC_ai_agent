# Coupang WING Reveal Live v3 — Evidence Landing

> **Status:** offline. Lands the evidence from the first Reveal Live run whose instrument actually saw Stage-2.
> No live run, no browser, no marketplace contact. No selector change, no Stage-2 selector guessing, no guided
> tutorial or stage-ordering change, no deletion tooling change.

## The run

| | |
|---|---|
| git | `3699df9e` |
| run / approval | `wt-dc2b46e93881` / `apr-3b60dacb9a69` |
| phase | `COUPANG_WING_ISSUANCE_FORM_REVEAL`, agent `READ_ONLY` |
| operator | confirmed the highlight visually, then pressed `API Key 발급 받기` themselves |
| agent click / type / submit | **0** |
| observations | **1** |
| outcome | `CONFIGURATION_SURFACE_SUSPECTED` (exit 0) |
| teardown | overlay cleared before observation · sentinels swept · window closed · tree clean |

Stage-2 opened and persisted. Nothing was selected, nothing was typed, `확인` was never pressed.

## What was measured

**One signal moved:**

```
choiceControlCountBucket:  none → few
```

**Four measured and unchanged:** `dialogLikePresent` false→false · `actionControlCountBucket` many→many ·
`submitAffordancePresent` false→false · `pageCategory` `open_api_issuance` on both sides.

The disjunct that fired is the **purpose-selection** one — added because the operator reported a
purpose-selection surface, and it fired on the surface it was written for.

### The pre-press capability report was accurate

The gate printed, before the operator was asked to act:

```
structural headroom (4)   dialogLikePresent, choiceControlCountBucket,
                          actionControlCountBucket, submitAffordancePresent
empirically refuted (1)   submitAffordancePresent
ELIGIBLE detectors  (3)   dialogLikePresent, choiceControlCountBucket, actionControlCountBucket
```

One of those three caught the transition. `submitAffordancePresent`, excluded from eligibility, contributed
nothing — as predicted.

## Three findings, stated at the strength the evidence supports

**1. v2 could not have detected this transition, whatever the page did.** Its census had no
`choiceControlCount` at all. That is the provable half and it carries the point. Whether the marketplace *also*
changed between two separate runs is not measurable from either capture, so this record does not claim it did
not — an earlier draft asserted exactly that, under a heading promising claims at the strength the evidence
supports. The v2 record is retained as `supersedes`, with `cause: PREDICATE_UNSATISFIABLE_ON_WING_MARKUP`.

**2. `submitAffordancePresent` is corroborated blind, by a stronger kind of evidence.** Previously it read
`false` on a page containing a visible button — suggestive, but an argument about markup. Now a Stage-2 that
demonstrably opened left it `false` on both sides. It did not merely fail to fire; it failed to fire across the
one real transition anybody has measured.

**3. Stage-2 does not use the dialog contract.** No dialog-contract container was painting and enabled on
either side. Recorded as `dialogLikePresent: false` — the census field's own name, and the same reading already
in `measuredUnchanged`, so the record states it once. The selector set is not restated here; a test anchors the
record to `EXTRACT_WING_CENSUS` instead, because a hand-copied list drifts silently when the census changes.

> **The wording here is load-bearing.** This is *not* a measurement that Stage-2 is visually non-modal. An
> overlay built from plain `div`s with none of those attributes reads `false` while looking exactly like a modal
> to the seller. Nor is "absent" quite right: the census filters to painting, non-`aria-disabled` elements, so a
> hidden dialog node also reads `false`. What is measured is the markup contract, not the appearance. A test
> pins the field's own doc comment AND rejects the inverted form of it, because "not a dialog element" quietly
> becoming "not a modal" is precisely this workstream's failure mode.

## What this evidence does NOT establish

**One capture.** `captureCount: 1`, `signatureStability: SINGLE_CAPTURE_NOT_ESTABLISHED`. No stability claim and
no cross-run anchor — the mistake the `issue` calibration already made once with "four captures agreed".

**A bucket, not a description.** `none → few` means 1–3 painting, enabled choice controls appeared. It does not
say what they are, what they are called, or what selecting one would do. `structuralMarkerMeasured` stays
`false`; `purposeWordingMeasured` is `false`.

**The operator's transcription is still a candidate.** `이제 키의 사용 목적을 골라주세요.` remains in
`WING_STAGE2_RECON_CANDIDATES.purpose`, unwired and unmatched. This run measured a control *count* and no
wording, so nothing promotes it. `EXTRACT_WING_CENSUS` still contains no Stage-2 text.

**`keyCreationRuledOut: false` / `NO_DISCRIMINATING_SIGNAL`** stand unchanged. The classifier still cannot tell
an issued account from a no-key one. Only the operator saw the screen.

**The guided tutorial is untouched.** Step count, stage identifiers, and ordering are byte-identical. A control
count is not a step plan.

## Verification

typecheck green. Full collector suite: **309 files / 7603 tests passed**, 18 files + 142 skipped (was 7596 —
**+7**). Selfchecks: `wing-reveal` 0, `wing-probe` 0, `wing-deletion` 2 (PARTIAL by design).

**Mutation guards: 25/25 caught** across provenance (superseded record erased, self-pointing, sha rolled back or
rewritten, dates rewritten, run id detached), one-capture (`captureCount` inflated, stability upgraded,
changed-signal count inflated), and no-overclaim (`structuralMarkerMeasured` / `purposeWordingMeasured` flipped
true, `keyCreationRuledOut` softened, the dialog caveat deleted **or inverted**, a census dialog selector
deleted, the moved signal also listed as unchanged, the purpose candidate wired into the recon scope).

### What the first battery missed

A 19/19 green battery still shipped four vacuous guards and two over-claims. Independent review found them.

- **The doc-comment pin didn't pin a meaning.** It sliced 1200 characters *preceding* the field and looked for a
  substring. Two mutations survived: one **inverting** the caveat into the exact over-claim it warns against
  ("that worry is obsolete: Stage-2 is not a modal"), and one deleting it while parking the pinned sentence in an
  adjacent comment still inside the window. Now it extracts the field's own doc block and *also* rejects the
  assertive form.
- **The corroboration pin passed on its own negation.** `toContain("CORROBORATED")` is satisfied by
  `**NOT CORROBORATED**`, ids and all.
- **The anti-contradiction check was an exact-string test.** Adding `"choiceControlCountBucket:none"` made the
  record say the same signal both moved and did not move, suite green. Now matched by prefix.
- **`supersedes.gitSha` and both dates were unpinned** — the superseded sha was constrained only by "different
  from v3", so `deadbeef` passed.
- **A field that resolved to no symbol.** `dialogContainerPresent` restated `dialogLikePresent` under a second
  name and hand-copied the census's four selectors; deleting one from the census left the suite green while the
  record kept asserting a measurement that no longer happened. Renamed to the census field, selectors anchored.
- **Two over-claims corrected:** "the difference was the instrument, not the marketplace" (the negative half is
  not measurable), and "all three prior calibration failures" (there are two — the third failure on this surface
  has a different cause and is not a calibration).

**And the battery harness itself had the bug it exists to catch.** `restore()` covered only two files while one
mutation targeted a third, so that mutation was left in the working tree after a run reported clean. Fixed, and
the harness now asserts every mutation target is one it can restore.

### One guard is weaker than its name suggested

"every refuted disjunct is corroborated by `measuredUnchanged`" is a **necessary** condition, not a sufficient
one: "did not move on one capture" is equally true of a capable detector whose shape was simply absent —
`dialogLikePresent` is exactly that, and it is not refuted. So it cannot establish blindness. The claim *the
refuted set cannot grow on a hunch* belongs to `coupang-wing-reveal-walk.test.ts`, which asserts eligibility
behaviour directly; this file's test was credited with it and should not have been. Both the test name and this
document now say which does which.

## Not in this unit

No live run, no browser, no WING contact. No selector change, no Stage-2 selector adopted or guessed, no recon
target wired to a runner, no census field change, no guided tutorial or stage-ordering change, no deletion,
NAVER, credential, connect, or sync work.

## Next

`Coupang WING Stage-2 READ_ONLY Recon v1` — measure the real purpose-selection controls and labels, read-only,
under its own fresh grant. **The tutorial step plan is not redesigned until that recon exists.** A count told us
Stage-2 is there; only the recon can say what it contains.
