# Coupang WING Stage-2 Label Calibration Evidence Landing v1

> **Status:** offline. Lands the first measurement of how Stage-2's choice controls are LABELLED. No live run, no
> browser, no marketplace contact. No selector promoted, no ordering changed, no tutorial redesign, no candidate
> added. **The purpose labels are still not established, and no radio is selected.**

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

Neither carries an `aria-label` or an `aria-labelledby`; neither sits inside a `<label>`. Each has exactly one
`label[for]`, and the association resolves. **The two length bands differ**, so the options are not symmetric
wording — that is a bound on each label's size and nothing else; no character of either is recorded.

This settles the recon's one correction, and settles it the other way round. That record could say only that no
painting `fieldset` / `[role=radiogroup]` / `[role=listbox]` existed, and a code comment over-claimed it as "the
radios are ungrouped". HTML groups radios by their shared `name`, which the shape census deliberately never
reads. Read now — in-page, to bucket by, with only the ordinal leaving — **they are grouped.**

**Neither radio matches any purpose candidate.** `purposeCandidatesMatched: 0`, and per row both
`exactCandidateIndex` and `containsCandidateIndex` are `-1`. All four candidates were sent
(`candidatesCompared: 4`), so this is a measured non-match across the whole set, not a partial sweep.

## The recon's seven absences, split three ways

The recon could produce only `ABSENT`, bounded by its own `absenceBounds` to painting whole-text matches. Every
one of those is now resolved:

| candidate | presence | reading |
|---|---|---|
| `확인` | **PRESENT_VISIBLE** | 1 painting exact · **20 hidden exact** |
| `업체명` | PRESENT_HIDDEN_ONLY | 4 hidden exact |
| `URL` | PRESENT_HIDDEN_ONLY | 2 hidden exact |
| `IP 주소` | PRESENT_HIDDEN_ONLY | 2 hidden exact |
| `자체개발` | PRESENT_NOT_WHOLE_TEXT | nested text, 2 non-painting innermost containers |
| `직접입력` | PRESENT_NOT_WHOLE_TEXT | same |
| `호출 IP` | ABSENT_EVERYWHERE | nothing, anywhere |
| the transcribed sentence | ABSENT_EVERYWHERE | nothing, anywhere |

**The recon's single INFERRED explanation was too simple.**
`WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT` was offered for all seven. It holds for **two**. Three were
hidden whole-text matches — a different cause entirely — and two are absent by any reading. So it is confirmed
as *one cause of three*, not as *the* cause, and `absenceExplanation.tested: false` was the honest label on it.

The bound did its job, and this is worth stating plainly: the recon's absences were correctly described as
counting painting matches only, which is exactly why three of them turn out to be hidden matches rather than
absences. Nothing on that record is rewritten.

**`확인` is unique among painting elements — and there are twenty others that do not paint.** The recon recorded
`matchCount: 1, verdict: UNIQUE` and carried no hidden count; it could not have seen them. `uniquenessScope:
"PAINTING_ELEMENTS_ONLY"` now says so. If any of the twenty ever painted, the locator resolves to many. That is
a property of the page, recorded — not a decision about the locator, which is still promoted to nothing.

**The signature agrees across two captures.** `c1b87128024cdec8`, byte-identical to the recon's — two runs, two
grants, two captures. Recorded as `AGREED_ACROSS_TWO_CAPTURES` and no stronger: two is not many, the sibling's
`SINGLE_CAPTURE_NOT_ESTABLISHED` is not upgraded, and the signature stays `EVIDENCE_ONLY`. The `issue`
calibration's original defect was a stability claim built on captures that were never independent; the fix is
not to make the same claim off a smaller number.

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

**One signal recorded without explanation.** `openApiMarkerPresent: false`, while the surface still classified
as `open_api_issuance` — which the precondition requires. No conclusion is drawn. Dropping a signal that reads
strangely is how a record becomes selective, and the recon record carried no such field to compare against.

## Provenance, kept in three classes

| class | content |
|---|---|
| **MEASURED** | every count, category, ordinal, bucket, presence verdict and signature above |
| **OPERATOR_REPORTED** | that the purpose screen was open and untouched when ready was signalled |
| **INFERRED** | that the visible wording differs from the flow description — `tested: false` |

## Verification

typecheck green. Full collector suite: **311 files / 7770 tests passed**, 18 files + 142 skipped (was 7757 —
**+13**).

**Mutation guards: 30/30 caught** on the new record — the run identity rewritten; the group collapsed to two
groups or to ungrouped; the two length bands made equal; an association claimed where none was measured; a
candidate match claimed; `candidatesCompared` untied from the shipped list; the purpose semantics claimed
measured; a purpose option named; the inference upgraded to measured; the split arithmetic broken away from the
recon's seven; a presence verdict changed without its bucket count; the old hypothesis recorded as fully
confirmed; `확인` promoted, pressed, or its uniqueness scope widened; its twenty hidden matches dropped; the
signature rewritten or its two-capture agreement upgraded to established stability; a faulted sweep recorded as
clean; a truncated scan recorded as complete; the oddly-reading signal dropped to the expected value; the
sibling's `absenceBounds` or single-capture caveat rewritten from here; and the record or its rows only
shallow-frozen.

The battery runs `--no-cache` and asserts every pattern is unique before applying it. This file now holds
**four** sibling records sharing a field vocabulary (`captureCount`, `sig16`, `keyCreationRuledOut`,
`precondition`), and an unanchored pattern in it is a false SURVIVED waiting to happen — that has already
produced six of them across two earlier units, plus one more from a stale transform cache.

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
