# Coupang WING Stage-2 Label Calibration Evidence Landing v1

> **Status:** offline **in this commit** — the evidence below comes from a granted live run; nothing here opens a
> browser or contacts the marketplace. No selector promoted, no ordering changed, no tutorial redesign, no
> candidate added. **The purpose labels are still not established, and no radio is selected.**

## The run

| | |
|---|---|
| git | `ce733f78` |
| run / approval | `wt-1e2ab6816bcc` / `apr-848e2cfd06f2` |
| record | `wingrec_5497afb9eec4` |
| phase | `COUPANG_WING_STAGE2_LABEL_CALIBRATION`, agent `READ_ONLY` |
| operator | pressed `API Key 발급 받기` themselves, left the purpose screen untouched |
| agent click / type / submit / highlight / tag / selection | **0** |
| precondition | `OK` |
| integrity | 8 candidates measured, 8 containment readings, 0 probe faults, 0 containment faults, no census fault |
| teardown | sentinels swept · window closed · tree clean · grant consumed |

## MEASURED

**The two radios are one `name` group, and both are properly labelled.**

```
nameGroupCount 1 · largestNameGroupSize 2 · ungroupedCount 0
radio 0   LABEL_FOR · labelForCount 1 · length short (1–8)   · groupIndex 0
radio 1   LABEL_FOR · labelForCount 1 · length medium (9–24) · groupIndex 0
```

Each has exactly one `label[for]` and no wrapping `<label>`, and neither carries an `aria-labelledby` reference.
**The two length bands differ**, so the options are not equal-length wording — a bound on each label's size and
nothing else; no character of either is recorded.

Three things that reading does **not** establish, each of which the first draft of this document asserted:

- **Not "no `aria-label`".** `LABEL_FOR` means `aria-labelledby` and `aria-label` both lost the precedence race
  — which a whitespace-only `aria-label` also produces. Absence was never measured.
- **Not "the association resolves".** "Resolves" is the instrument's word for `ariaLabelledbyResolvedCount`,
  which is 0 here because there was nothing to resolve.
- **Not "correctly wired".** Nothing checked that the `label[for]` element *paints*; the lookup does no paint
  test. `labelElementPaintMeasured: false` is on each row.

This settles the recon's one correction, and settles it the other way round. That record could say only that no
painting `fieldset` / `[role=radiogroup]` / `[role=listbox]` existed, and a code comment over-claimed it as "the
radios are ungrouped". HTML groups radios by their shared `name`, which the shape census deliberately never
reads. Read now — in-page, to bucket by, with only the ordinal leaving — **they are grouped.**

**Neither radio matches any purpose candidate.** `purposeCandidatesMatched: 0`, and per row both
`exactCandidateIndex` and `containsCandidateIndex` are `-1`. All four candidates were sent
(`candidatesCompared: 4`), so this is a measured non-match across the whole set, not a partial sweep.

## Where each label actually is — the full quad, per candidate

Recorded as four integers each, because the cause split below is *derived* from them and has to be
re-derivable. `dV` is the count of painting elements that contain the label while no painting element's whole
text equals it — the number that decides whether the matcher was the problem.

| candidate | eVis | eHid | dVis | dHid | presence | miss cause |
|---|---|---|---|---|---|---|
| `확인` | 1 | 20 | 1 | 22 | PRESENT_VISIBLE | — (matched) |
| `업체명` | 0 | 4 | **1** | 6 | PRESENT_HIDDEN_ONLY | **whole-text mismatch, on screen** |
| `URL` | 0 | 2 | 0 | 5 | PRESENT_HIDDEN_ONLY | present only in non-painting nodes |
| `IP 주소` | 0 | 2 | 0 | 8 | PRESENT_HIDDEN_ONLY | present only in non-painting nodes |
| `자체개발` | 0 | 0 | 0 | 2 | PRESENT_NOT_WHOLE_TEXT | present only in non-painting nodes |
| `직접입력` | 0 | 0 | 0 | 2 | PRESENT_NOT_WHOLE_TEXT | present only in non-painting nodes |
| `호출 IP` | 0 | 0 | 0 | 0 | ABSENT_EVERYWHERE | not present in any form |
| the transcribed sentence | 0 | 0 | 0 | 0 | ABSENT_EVERYWHERE | not present in any form |

**The recon's hypothesis holds for ONE of its seven absences — and not the one this document first claimed.**

The first version said "two", naming `자체개발` and `직접입력`, and independent review demonstrated it wrong. It
is worth keeping the error on the page, because it is this workstream's own recurring defect committed again:
**`presence` is a LOCATION verdict and I read it as a CAUSE verdict.**

- Both self_dev candidates read `PRESENT_NOT_WHOLE_TEXT` — but their painting-container count is **zero**. The
  text is not on screen in any form, so the matcher was never the reason it was missed. Visibility was.
- The one candidate the hypothesis does explain is `업체명`: a painting element contains it, and no painting
  element's whole text equals it. It reads `PRESENT_HIDDEN_ONLY`, because the fold ranks a hidden whole-text
  match above a painting partial one — so reading causes off the enum credits the wrong candidates.

Split over the seven: **1** whole-text mismatch on a painting element · **4** present only in non-painting nodes
· **2** not present in any form. The record carries `wingStage2MissCause`, a total function over the quad, and
the test *recomputes* the split rather than re-stating it — counting presence values per bucket, as the first
version did, survives a swap between two candidates with all totals intact.

The recon's own bound did its job, and that is worth stating: its absences were correctly described as counting
painting matches only, which is exactly why **six** of the seven turn out to be about paint. Nothing on that
record is rewritten.

**`확인` is unique among painting elements — and there are twenty others that do not paint.** The recon recorded
`matchCount: 1, verdict: UNIQUE` and carried no hidden count; it could not have seen them. `uniquenessScope:
"PAINTING_ELEMENTS_ONLY"` now says so. If any of the twenty ever painted, the locator resolves to many. That is
a property of the page, recorded — not a decision about the locator, which is still promoted to nothing.

**The signature agrees with one earlier run.** `c1b87128024cdec8`, byte-identical to the recon's — a different
run on a different commit. Recorded as `AGREES_WITH_ONE_EARLIER_RUN_NOT_ESTABLISHED`, which says the agreement
and denies the conclusion in the same token, and `captureCount: 1` means captures taken *by this run*. Not "two
grants": the recon record carries no `approvalId`, so that is unverifiable from here. The signature stays
`EVIDENCE_ONLY`. The `issue` calibration's original defect was a stability claim built on captures that were
never independent; the fix is not to make the same claim off a smaller number.

## What is deliberately NOT claimed

**The purpose semantics are still unmeasured.** `purposeOptionSemanticsMeasured: false`. Shape, association,
group membership and a length band are known for both radios; what either MEANS is not. Deciding which is
자체개발 from "one is short and one is medium" would be inventing a product decision from a bucket. A test
asserts no Hangul appears anywhere in this record's own fields.

**`확인` is still not the final key-issuance control.** Nothing pressed it, this phase has no tooling that could,
and its role continues to come from the product owner's description of the flow.

**One inference, labelled as one.** That the operator-visible option wording differs from the flow description
(자체개발(직접입력)) is `INFERRED`, `tested: false`. The measured facts are two — neither label matches those
words, and those words exist on the page only in non-painting nodes. The step to "the options are called
something else" assumes the `LABEL_FOR`-derived name is what a sighted seller reads. Very likely; not measured.

**One signal that reads oddly, recorded WITH the reading that explains it.** `openApiMarkerPresent: false`,
while the surface still classified as `open_api_issuance`. That is not a mystery: the classifier accepts either
disjunct, and `credentialAnchorPresent` is `true`. The first draft called it "not explained by this run" while
omitting the second signal — which is precisely the selectivity the note claimed to be avoiding.

## Provenance, kept in three classes

| class | content |
|---|---|
| **MEASURED** | every count, category, ordinal, bucket, presence verdict and signature above |
| **OPERATOR_REPORTED** | that the purpose screen was open and untouched when ready was signalled |
| **INFERRED** | that the visible wording differs from the flow description — `tested: false` |

## Verification

typecheck green. Full collector suite: **311 files / 7772 tests passed**, 18 files + 142 skipped (was 7757 —
**+15**).

**Mutation guards: 49/49 caught.** Among them: the run identity or SHA rewritten; the group collapsed to two or
to ungrouped; the two length bands made equal; a row's ordinal rewritten; an association claimed where none was
measured; `ariaLabelledbyResolvedCount` claimed non-zero; the label element's paint claimed measured; a
candidate match claimed; `candidatesCompared` untied from the shipped list; the purpose semantics claimed
measured; a purpose option named — in precomposed **and** decomposed Hangul; the inference upgraded; the split
re-credited to the candidates the first draft wrongly named; **two candidates' quads swapped**; a candidate key
renamed off the shipped id; either miss-cause branch removed; `확인` promoted, pressed, downgraded, or its
uniqueness scope widened; its twenty hidden matches dropped; the signature rewritten or its agreement upgraded
to established stability; the explaining signal rewritten; each of the four truncation flags hidden; the
sibling's bounds or caveat rewritten from here; and the record, its rows, or its quads only shallow-frozen.

### The first draft got the central claim backwards, and review caught it

`presence` answers WHERE a label is. I read it as WHY the recon missed it. The record said the whole-text
hypothesis was confirmed for **two** candidates, `자체개발` and `직접입력` — whose painting-container count is
**zero**, so the matcher was never the reason. The one candidate it does explain, `업체명`, was filed under a
different bucket entirely, because the fold ranks a hidden whole-text match above a painting partial one.

It is the same defect this workstream keeps producing — a guard, or here a conclusion, one layer away from the
thing it concerns — and my own battery could not see it: the test counted presence values per bucket, which a
swap between two candidates satisfies with every total intact. Fixed by putting the four containment integers
on the record and having the test **recompute** the split with `wingStage2MissCause`; the swap is now `L12c`
and it fails.

Review found **two more blocking issues and eight surviving mutations**, all verified by running them:

- **`openApiMarkerPresent: false` was recorded as "not explained by this run"** while the record omitted
  `credentialAnchorPresent: true` — the other disjunct the classifier accepts, and the actual explanation.
  Recording the odd reading while dropping the one that explains it, under a note about not being selective.
- **The shape census was never asserted** despite the record claiming to re-read it, so three of its numbers
  were free. They are now pinned by value *and* tied to `refines`.
- `confirmLocated.verdict`, each row's `index`, the presence **keys**, and `refines.runId` were all unguarded.
- The recon record's source pin sliced to end-of-file, and this commit appended a fourth record after it — so
  the pin's three strings could have been satisfied by a different record. Bounded, and the bound is asserted.

Five over-claims corrected: "the association resolves" (that word names a field measuring 0 references), "no
`aria-label`" (deduced from losing a precedence race, never measured), "correctly wired" (nothing checked the
label element paints), "two separate grants" (the recon record has no `approvalId`), and a doc table headed
"seven absences" listing eight rows.

## Not in this unit

No live run, no browser, no WING contact. No candidate added or changed, no selector promoted, no ordering
change, no census or instrument change, no guided tutorial or stage-plan work.

## Next

`Stage-2 Purpose Option Transcription v1`. **No more guessing at candidates.** The operator transcribes the two
visible option strings off the screen verbatim; they enter `WING_STAGE2_PURPOSE_OPTION_CANDIDATES` as
`OPERATOR_TRANSCRIBED` — the provenance class this unit reserved and left unused — and a READ_ONLY re-run turns
each row's `-1` into an index.

That is a code change, so it revokes any standing approval and needs a fresh bootstrap, a fresh manifest bound
to the new SHA, and a fresh single-use grant.

**No radio is selected until the purpose labels are established.**
