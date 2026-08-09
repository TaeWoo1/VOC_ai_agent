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

**1. The instrument, not the marketplace, was the difference.** Under the census this run replaced, the same
press on the same surface produced `SURFACE_UNCHANGED` — `choiceControlCount` did not exist. The v2 record is
retained as `supersedes` rather than overwritten, with `cause: PREDICATE_UNSATISFIABLE_ON_WING_MARKUP`.

**2. `submitAffordancePresent` is corroborated blind, by a stronger kind of evidence.** Previously it read
`false` on a page containing a visible button — suggestive, but an argument about markup. Now a Stage-2 that
demonstrably opened left it `false` on both sides. It did not merely fail to fire; it failed to fire across the
one real transition anybody has measured.

**3. Stage-2 does not use the dialog contract.** No `dialog[open]`, `[role=dialog]`, `[role=alertdialog]`, or
`[aria-modal=true]` painted on either side. Recorded as `dialogContainerPresent: false`.

> **The wording here is load-bearing.** This is *not* a measurement that Stage-2 is visually non-modal. An
> overlay built from plain `div`s with none of those attributes reads `false` while looking exactly like a modal
> to the seller. What is measured is the markup contract, not the appearance. A test pins the doc comment saying
> so, because "not a dialog element" quietly becoming "not a modal" is precisely this workstream's failure mode.

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

typecheck green. Full collector suite: **309 files / 7602 tests passed**, 18 files + 142 skipped (was 7596 — **+6**). Selfchecks: `wing-reveal` 0, `wing-probe` 0, `wing-deletion` 2 (PARTIAL by design).

**Mutation guards: 19/19 caught** across provenance (superseded record erased or self-pointing, sha rolled back, run id detached), one-capture (`captureCount` inflated, stability upgraded, changed-signal count inflated), and no-overclaim (`structuralMarkerMeasured` or `purposeWordingMeasured` flipped true, `keyCreationRuledOut` softened, the dialog caveat deleted, the measured transition renamed to a signal that did not move, the purpose candidate wired into the recon scope).

One guard was MISSING and the battery found it: the driver comment calling `submitAffordancePresent` corroborated could be deleted with every test still green. Closed by deriving the claim instead of asserting the prose — a disjunct may be listed as empirically refuted only if it appears in the live record's own
`measuredUnchanged`, and the disjunct that fired may never be listed. The refuted set can no longer grow on a hunch.

## Not in this unit

No live run, no browser, no WING contact. No selector change, no Stage-2 selector adopted or guessed, no recon
target wired to a runner, no census field change, no guided tutorial or stage-ordering change, no deletion,
NAVER, credential, connect, or sync work.

## Next

`Coupang WING Stage-2 READ_ONLY Recon v1` — measure the real purpose-selection controls and labels, read-only,
under its own fresh grant. **The tutorial step plan is not redesigned until that recon exists.** A count told us
Stage-2 is there; only the recon can say what it contains.
