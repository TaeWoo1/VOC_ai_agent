# Coupang WING Stage-2 Purpose Label Calibration v1

> **Status:** offline. Builds the instrument that determines what the two Stage-2 radios actually are, and closes
> the two absence limits the recon landing recorded against itself. No live run, no browser, no marketplace
> contact. No selector promoted, no ordering changed, no tutorial redesign. **No radio is selected.**

Baseline `9e759653`.

## What was unmeasurable before this

The Stage-2 recon left three things open, all recorded on `WING_STAGE2_RECON_EVIDENCE`:

| field | what it said |
|---|---|
| `purposeOptionSemanticsMeasured: false` | two radios counted; what either MEANS unread |
| `absenceBounds.hiddenMatchCountCarried: false` | the sweep discarded the locate script's `hiddenCount`, so an `ABSENT` meant "no **painting** whole-text match" |
| `absenceExplanation.tested: false` | the whole-text hypothesis for seven absences was INFERRED, and nothing could test it |

Three instruments, one per row.

## 1 · `hiddenCount`, carried at last

`buildFixedLabelLocateScript` has always returned it; `probeFixedLabelMatch` has always surfaced it; the Stage-2
sweep dropped it on the floor. It now travels through the fold into `WingReconCandidateResult.hiddenMatchCount`
and onto the wire.

**`null`, not `0`, when the reading carried none.** A reading that did not report a hidden count has not measured
zero of them — the same measured-vs-unmeasured line `NOT_MEASURED` draws for the count itself, one field over. A
junk value (negative, fractional, `NaN`) is rejected to `null` too; `0` is a real reading and survives.

This is a capability the *next* run has. It does not retroactively bound the seven absences already on the
record, and a test pins `hiddenMatchCountCarried: false` on that evidence so landing this cannot rewrite what
that run measured.

## 2 · The containment probe — absent, or unmatchable?

`buildFixedLabelContainmentScript` returns five integers and a flag:

```
exactVisible · exactHidden                 whole-text equality, split by paint
deepestContainsVisible · deepestContainsHidden   innermost elements that merely CONTAIN the label
scanTruncated
```

**Innermost only.** Every ancestor up to `<html>` also contains the text; counting them would report page depth
rather than a finding. A direct-child test suffices — a descendant's text is a subsequence of its parent's.

It folds to a closed presence verdict, ordered strongest-evidence-first:

`PRESENT_VISIBLE` → `PRESENT_HIDDEN_ONLY` → `PRESENT_NOT_WHOLE_TEXT` → `ABSENT_EVERYWHERE`, and
**`ABSENT_WITHIN_SCAN_BOUND`** when the scan hit its cap. That fifth value is the whole point of the second
`absenceBounds` limit: an absence measured over a prefix of the document is an absence from that prefix. A
*present* verdict is not weakened by truncation — finding something under a partial scan is still finding it.

`PRESENT_NOT_WHOLE_TEXT` on `자체개발` would confirm the INFERRED hypothesis directly: the label is on the
screen, rendered across nested nodes, and the matcher — not the wording — is what missed it.

An empty candidate returns zeros rather than the size of the page (`''.indexOf` matches everything).

The probe's exact-visible count is asserted to **agree with the shipped locate script** for the same spec. The two
share `norm` / `accName` / `paints` by copy, and a drift would make the calibration's exact half incomparable
with every count already on the record.

## 3 · The label-association census — what each control IS

For every painting, enabled choice control, one row:

| field | reading |
|---|---|
| `nameSource` | `ARIA_LABELLEDBY · ARIA_LABEL · LABEL_FOR · LABEL_ANCESTOR · TITLE · NONE` |
| `nameLengthBucket` | `none · short · medium · long` |
| `exactCandidateIndex` / `containsCandidateIndex` | index into **our** candidate list, or `-1` |
| `hasIdAttr`, `labelForCount`, `ancestorLabelCount` | whether the association is wired, and whether it is wired twice |
| `ariaLabelledbyRefCount` / `…ResolvedCount` | a shortfall is a broken association, and a common one |
| `groupIndex` | **the radio-`name` group, as an ordinal** |

plus `nameGroupCount`, `largestNameGroupSize`, `ungroupedCount`, `rowsTruncated`, `scanTruncated`,
`candidatesCompared`.

**`groupIndex` is the measurement the recon could not make.** The landing recorded "no painting
fieldset/radiogroup/listbox" and a code comment over-claimed it as "the radios are ungrouped" — a correction this
document already carried. HTML groups radios by their shared `name`, which the shape census deliberately never
reads. The census now reads it *in-page to bucket by*, and emits only the bucket number. The `name` value never
leaves, and a test asserts it does not appear in the serialized reading.

**It is a documented SUBSET of the accname algorithm, and says so.** No `aria-labelledby` recursion, no
`aria-owns`, no CSS generated content, no `<legend>` fallback. A record that called this "the accessible name"
would be claiming conformance it does not have — the same shape as `role: "button"`, a property named after a
standard and asserted from an instrument that never computed it.

**`checked` is not read.** A source guard forbids it. The shape census already refuses it as a leaked selection,
and this run's whole premise is that no purpose has been chosen: an instrument that could report one is an
instrument that could report the operator's choice.

## The candidate list, and what is deliberately missing from it

```
자체개발      PRODUCT_OWNER_FLOW_DESCRIPTION
자체 개발     MECHANICAL_SPACING_VARIANT
직접입력      PRODUCT_OWNER_FLOW_DESCRIPTION
직접 입력     MECHANICAL_SPACING_VARIANT
```

Every entry traces to the product owner's account of the official flow, or is a mechanical spacing transform of
one. The provenance vocabulary is closed, and `OPERATOR_TRANSCRIBED` is **reserved and unused** — nothing here is
wording a human read off the live screen.

**The second radio's label is not in this list, and is not guessed.** Only one of the two measured radios has a
described counterpart in the flow account. 업체연동 / 대행 / 위탁 are plausible and would be invented wording
shipped into the live page as an exact-match query — the speculative retuning `collector/CLAUDE.md` §6 forbids. A
test pins the list by value and asserts none of those strings appears.

So the second option is measured **structurally** — derivation, association, group, length band — and its wording
stays unknown. A row reading `exactCandidateIndex: -1` against a `short`, `LABEL_FOR`-derived name is the honest
outcome, and it **is** a finding: it says the control is properly labelled with something none of our hypotheses
match, which is a different world from an unlabelled control.

## Fail-closed: `CALIBRATION_BLIND`

A census with an empty comparison list still measures derivation and grouping, but cannot answer the question the
phase is named for — every row would read "matched no candidate" for a reason about us, not about WING. So an
empty candidate set refuses, twice: in `sweepStage2`, and again in `main()` **before Chrome launches**, because
an operator is about to log in, navigate and press a real marketplace control and should learn the instrument is
blind before doing any of that. Same gate as `BLIND_INSTRUMENT` on the reveal harness, one surface over.

The guard is unreachable while the shipped set is non-empty, so the candidate list is **injectable** at the
`runWingSelectorRecord` seam and the refusal is exercised for real. A guard nothing can run is a guard nobody has
tested — and "the constant is non-empty, therefore the branch is fine" is the one-layer-removed reasoning that
has produced a defect in this workstream five times. A test pins that the CLI never passes the injection point,
so production can only ever send the frozen set.

## The phase — `COUPANG_WING_STAGE2_LABEL_CALIBRATION`

Its own phase, not a flag on the recon. Same surface, same operator flow, same scope vocabulary, same READ_ONLY
mode, same zero highlight/click/selection budget — but two measurements the recon does not take, and **the
manifest is what the operator reads before granting**. A Stage-2 run announced as an "API issuance highlight
proof" is a finding review already made on this workstream.

Two new approval actions: `FIXED_LABEL_CONTAINMENT_PROBE` and `CHOICE_CONTROL_LABEL_ASSOCIATION_CENSUS`. A test
asserts the **recon** phase did not grow them — that is what keeps the two separately approvable.

The phase gate now refuses a third way. It always refused a one-sided phase; it now also refuses **two different
Stage-2 phases**, which is worse than either half alone: a calibration run under a recon manifest takes two
readings the operator never read, and a recon run under a calibration manifest returns less than the manifest
promised.

Both Stage-2 phases route through one predicate — `isWingStage2Phase` in the manifest, `is_stage2_phase` in
bootstrap and preflight — rather than a fourth `phase = …` comparison per branch. The WING phase list already
learned that lesson: three separate `||` chains had accumulated, and a phase added to two of the three was
screened against the wrong host.

`ApprovalManifest.stage2Targets` is now **declared**. It was emitted before it was typed, so the preflight read it
through a JSON path while the compiler denied it existed.

## Verification

typecheck green. Full collector suite: **311 files / 7738 tests passed**, 18 files + 142 skipped (was 7671 —
**+67**). Harness selfcheck: PASS, including 17 new `STAGE2CAL` cases.

Both in-page scripts are executed by tests through `new Function(...)` against a DOM double that carries a real
computed style and answers only the exact selectors the script is contracted to ask for — so a widened query or
a deleted `paints()` branch fails, rather than being handed the fixture regardless.

## Not in this unit

No live run, no browser, no WING contact. No selector promoted, no ordering changed, no tutorial redesign, no
purpose selected, no 확인 pressed, no `checked` read. The Stage-2 recon evidence record is unchanged, including
its own `absenceBounds`.

## Next

A live calibration run under a fresh manifest and a fresh single-use grant. Two things it could learn that this
build cannot: whether the two radios share one `name` group, and whether `자체개발` is `PRESENT_NOT_WHOLE_TEXT`
rather than absent.

If the operator can transcribe the two on-screen option strings, they enter the candidate list as
`OPERATOR_TRANSCRIBED` first — with them the calibration is decisive rather than partial.

**No radio is selected until the purpose labels are established.**
