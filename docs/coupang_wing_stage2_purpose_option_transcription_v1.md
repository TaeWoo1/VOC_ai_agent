# Coupang WING Stage-2 Purpose Option Transcription v1

> **Status:** offline. Nothing in this commit opens a browser or contacts the marketplace. No radio selected, no
> 확인 pressed, no selector promoted, no ordering changed. **The purpose semantics remain UNMEASURED** — this
> unit supplies the strings the calibration re-run will compare against, and predicts what that run should say.

## What the operator transcribed

Read off the live Stage-2 screen on **2026-08-10**, verbatim, in screen order:

| | verbatim | chars | measured band for that radio (2026-08-09) |
|---|---|---|---|
| radio 0 | `OPEN API` | 8 | `short` (1–8) ✓ |
| radio 1 | `플레이오토 웹 솔루션` | 11 | `medium` (9–24) ✓ |

Also reported as visible on the same screen: the heading `키의 사용 목적을 골라주세요`, and the buttons `취소`
and `확인`. The heading is added as a probe (below); `확인` was already one; **`취소` is probed nowhere**, because
locating a control this workstream must never press serves nothing.

**Both length checks pass, and they were falsifiable** — a reading outside the bands would have meant a
different element, a different screen, or a flipped order.

**But the check is weaker than it looks, and the weakness is mine.** I stated both bands in the request that
asked for the transcription, so the reading was not blind to what would satisfy them. It catches a gross error;
it is not independent confirmation. The bands are wide, and nothing here ties either string to either control.
Producing that tie is the whole job of the calibration re-run.

## The finding, before any instrument runs

**Neither radio is labelled 자체개발 or 직접입력.** The flow description the workstream has been carrying names
the self-developed option as 자체개발, parenthetically 직접입력. Neither word labels either option. One of the
two names a specific solution rather than describing an integration method.

This retires the previous record's one `INFERRED` claim — that the visible wording differs from the flow
description — and replaces it with an operator reading. It does **not** promote it to MEASURED: a human reading
a screen is a third provenance class, not a measurement, which is exactly why both strings enter as candidates
like the rest.

**What this unit deliberately does not decide:** whether `OPEN API` is the self-developed path the flow account
describes. It is the obvious reading and it is still an inference about product intent, which is a product-owner
question. Nothing in the code assumes it.

## What changed in source

**Two candidates added, provenance `OPERATOR_TRANSCRIBED`** — the class the previous unit reserved and left
unused rather than guess at the second radio's wording. The four flow-description and spacing-variant entries
stay, at their existing indices, so an earlier run's `exactCandidateIndex` remains readable.

**One recon candidate added, not replaced.** The `purpose` target shipped
`이제 키의 사용 목적을 골라주세요.` — an operator *report* from 2026-08-09, measured `ABSENT_EVERYWHERE` on
2026-08-10. The verbatim heading differs from it by a leading `이제 ` and a trailing period, which is the
likeliest explanation of that absence. Both are now probed: dropping the old one would make the comparison
unrepeatable, and the absence is the evidence.

Its wording is pinned as an **equation**, not a literal: the 08-09 report must equal `이제 ` + the verbatim entry
+ `.`. This unit's own battery found the gap — restoring the trailing period to the verbatim entry survived every
test, and that entry's whole justification is the difference from the string it corrects.

**One entry left the guess denylist, and it is worth saying why.** The previous unit asserted that no shipped
candidate contains 업체연동 / 대행 / 위탁 / **솔루션** / 외부 — plausible second-option wordings nobody had read.
The real label contains 솔루션. The denylist was, in part, excluding a substring of the answer, which is what
denylists of imagined wording do; the other four still hold and are still asserted.

## The prediction, written down before the run

A test builds a fake Stage-2 exactly as transcribed — two radios, one `name` group, one `label[for]` each — and
runs the **real generated script** against the **real shipped candidate list**:

```
visibleChoiceControlCount 2 · nameGroupCount 1 · largestNameGroupSize 2 · ungroupedCount 0 · candidatesCompared 6
row 0  LABEL_FOR · short  · exact 4 → purpose_option.open_api               · labelForCount 1 · group 0
row 1  LABEL_FOR · medium · exact 5 → purpose_option.playauto_web_solution  · labelForCount 1 · group 0
```

If the live run returns anything else, **the difference is the finding**, and it is not renegotiable after the
fact. It cannot be blamed on the matcher: the same matcher produced the expectation. The indices are asserted
through their candidate ids, not as bare numerals a reordering could re-aim.

Two silent no-match modes are pinned by code point, because neither is visible to a reader or a reviewer:
**decomposed Hangul** (renders identically, compares unequal — the script does not normalize, by design) and a
**non-breaking space** (routine in text copied out of a rendered page; the matcher collapses ASCII whitespace
only). Either would report `exactCandidateIndex: -1` against a character-perfect page, and the run would read as
a measured non-match rather than as our own bug.

## Three guards that were aimed one layer away

**A past run cannot own the current set.** Two records tied their coverage to the *live* candidate constants —
`candidatesMeasured === WING_STAGE2_RECON_CANDIDATES.length` and
`candidatesCompared === WING_STAGE2_PURPOSE_OPTION_CANDIDATES.length` — with the comment "so a fifth candidate
cannot leave the record claiming complete coverage". Both fired the moment this unit added candidates, and both
were right to. But an equality that has to be *edited* to stay true only records that someone edited it. Each
record now **names** the ids it covered (`measuredCandidateIds`, `comparedCandidateIds`), the count is checked
against that list, and the ids that postdate the run are asserted **by name** in the test — so an addition has
to be acknowledged, which is what the equality was reaching for.

**The calibration record had no field-set guard.** The recon record has carried an exact-key-set assertion since
a denylist beside it let two purpose-option spellings and a page sentence through. The larger, newer record —
the one holding the `확인` signature it is careful not to promote — never got one, and this unit is how that
surfaced: `comparedCandidateIds` was added and nothing objected. A field can enter a sanitized record silently
exactly once. Now added, over the top level and every nested shape.

**An unreadable Stage-2 page reported zero choice controls** (`bbaeef44`, carried over from the previous unit,
where it was recorded as this unit's first fix). `sanitizeChoiceControlCensus` coerced `null`/`undefined`/a
string/an array into a complete census reading `visibleChoiceControlCount: 0` — the number the recon record's
headline Stage-2 claim is read from. Only a THROW produced a fault; a silent nothing produced a finding. It was
the last of the three Stage-2 sanitizers with the defect, and the calibration re-run evaluates it live. The test
that held it in place was named "returns a safe reading rather than throwing" and asserted the fabricated zero.

## Provenance, kept in three classes

| class | content |
|---|---|
| **MEASURED** | nothing new. Every count on the existing records is unchanged and none is re-attributed |
| **OPERATOR_REPORTED** | the two option strings, the heading, `취소`/`확인` being visible, and the screen order |
| **INFERRED** | that `OPEN API` corresponds to the flow description's self-developed path — **not** acted on |

## Verification

typecheck green. Full collector suite: **311 files / 7780 tests passed**, 18 files + 142 skipped (was 7772 —
**+8**). Live-harness selfcheck: **75 PASS**, exit 0, on a clean tree.

**Mutation guards: 33/33 caught.** Among them: `OPEN API` doubled-spaced, lowercased, trailing-spaced, or
unspaced to 7 characters (still inside its band); the Korean label in decomposed Hangul, with a non-breaking
space, or respaced to a length the band check still accepts; **the two transcriptions swapped in screen order**;
either relabelled as a flow description, or a flow description relabelled as a transcription; a guessed
candidate added back under an `OPERATOR_TRANSCRIBED` label; the verbatim heading removed, or given its trailing
period back; the 08-09 report quietly rewritten to the verbatim string; `measuredCandidateIds` claiming the
heading it never probed, dropping the one that resolved, or naming a candidate that does not exist;
`comparedCandidateIds` claiming a transcription was compared; either coverage count inflated to the new set
size; a field added to the calibration record or to a nested shape; the census sanitizer's null branch removed
or widened to reject an empty object; the sweep dropping its `UNUSABLE_READING` fault; the driver skipping
re-sanitization; the name-length bucket boundary moved by one; the exact-match branch degraded to a containment
test; and radio grouping by `name` dropped.

**One survived on the first pass** — the verbatim heading's wording, pinned nowhere — and it is now the equation
above. A second entry reported an error rather than a result: its anchor text appeared twice in the file, so it
patched nothing. That was a battery bug, not a test gap; re-aimed, it is caught.

## Not in this unit

No live run, no browser, no WING contact. No radio selected, no 확인 pressed, no selector promoted, no ordering
change, no instrument or census widening, no tutorial or stage-plan work. No candidate invented — the guesses
the previous unit declined (업체연동, 대행, 위탁, …) are still asserted absent from the shipped set.

## Next

`Stage-2 Purpose Option Calibration Re-run`. Code has changed, so any standing approval is **REVOKED**: a fresh
bootstrap for a new `runId`/`approvalId`, a fresh manifest bound to this SHA, and a fresh single-use grant. Phase
`COUPANG_WING_STAGE2_LABEL_CALIBRATION`, agent `READ_ONLY`, operator presses `API Key 발급 받기` and leaves the
purpose screen untouched.

The run either turns both rows' `-1` into indices 4 and 5, or it does not — and the prediction above says which
before it runs.

**No radio is selected and nothing is promoted until the semantics are established.**
