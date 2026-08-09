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

`buildFixedLabelContainmentScript` returns four integers and a flag:

```
exactVisible · exactHidden                 whole-text equality, split by paint
deepestContainsVisible · deepestContainsHidden   innermost elements that merely CONTAIN the label
scanTruncated
```

**Innermost only.** Every ancestor up to `<html>` also contains the text; counting them would report page depth
rather than a finding. A direct-child test suffices — a descendant's text is a subsequence of its parent's.

**Two caps, deliberately.** The candidate scan stops at 4000 — the locate script's own cap, byte for byte — so
the exact halves are comparable with every count already on the record; a wider cap here would count matches
that script never saw while the agreement test reported agreement. The whole-document containment scan gets its
own 8000. Either one being hit sets `scanTruncated`.

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

**An unusable reading is `null`, not zeros.** `sanitizeContainmentReading` returns `null` for `undefined` /
`null` / a non-object, and the sweep records that as a `UNUSABLE_READING` fault rather than a reading. This was
review's first BLOCKING finding and it was exactly right: `{0,0,0,0,false}` is a *complete* reading, so a page
that swapped under the probe, or a CSP that killed the script, folded straight to `ABSENT_EVERYWHERE` and was
counted in `containmentMeasured`. Only a **throw** produced a fault; a silent nothing produced a finding. The
association census now has the same rule and the same fault category.

## 3 · The label-association census — what each control IS

For every painting, enabled choice control, one row:

| field | reading |
|---|---|
| `nameSource` | `ARIA_LABELLEDBY · ARIA_LABEL · LABEL_FOR · LABEL_ANCESTOR · TITLE · NONE` |
| `nameLengthBucket` | `none · short · medium · long` |
| `exactCandidateIndex` / `containsCandidateIndex` | index into **our** candidate list, or `-1` |
| `hasIdAttr`, `labelForCount` | whether the association is wired, and whether it is wired **twice** |
| `ancestorLabelCount` | 0-or-1 by construction — `closest()` returns the nearest wrapper, so it can never express "twice" |
| `ariaLabelledbyRefCount` / `…ResolvedCount` | a shortfall is a broken association, and a common one |
| `groupIndex` | **the radio-`name` group, as an ordinal** |

plus `nameGroupCount`, `largestNameGroupSize`, `ungroupedCount`, `rowsTruncated`, `scanTruncated`,
`candidatesCompared`.

Two fields whose names undersell what they hold. `hiddenChoiceControlCount` is the **union** of not-painting and
disabled, exactly as on the shape census — a painting-but-disabled radio lands here, so it must not be read as
"not on screen". And `candidatesCompared` counts the **non-blank** candidates: the in-page loop skips a blank
one (an empty string is contained in every name), so counting it would claim coverage the comparison never had.
The clamp bound stays the full list length, so an index still names the right candidate.

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

Both gates take the candidate list as a **parameter**: the sweep's from `runWingSelectorRecord`, the launch
gate's as `calibrationLaunchRefusal(isCalibrationRun, candidates)`. The shipped set is non-empty, so in place
neither branch is reachable — and a guard nothing can run is a guard nobody has tested. "The constant is
non-empty, therefore the branch is fine" is the one-layer-removed reasoning that has produced a defect in this
workstream five times.

The launch gate got there the hard way. Its first form lived inline in `main()` and was asserted by slicing the
source for two substrings; review demonstrated **two surviving mutations** — deleting the `return` after
`process.exitCode = 2` (the refusal prints and Chrome launches anyway), and prefixing the condition with
`false &&`. Extracting the decision makes the second a real test. The `return` is the one line a pure function
cannot cover, and it is now pinned to that block alone rather than to "somewhere before the launch", because
`process.exitCode = 2; return;` appears at several gates in this file.

A test pins that `main()` never passes the injection point — over the **whole** of `main()`, not a
300-character window at the call site, because a window that size is defeated by hoisting the option into a
variable and spreading it in.

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

That claim was **false when first written**. The preflight's embedded Python — the branch that decides whether
the run env gets a Stage-2 scope or a probe scope, the highest-consequence Stage-2 branch in the harness — had
its own duplicated phase list, and the test that "covered" it only asserted `is_stage2_phase` appeared
*somewhere* in the file. The shell now evaluates the predicate and passes a yes/no in.

`ApprovalManifest.stage2Targets` is now **declared**. It was emitted before it was typed, so the preflight read it
through a JSON path while the compiler denied it existed.

## Verification

typecheck green. Full collector suite: **311 files / 7757 tests passed**, 18 files + 142 skipped (was 7671 —
**+86**). Harness selfcheck: PASS, including 17 new `STAGE2CAL` cases, exercised on a clean tree.

Both in-page scripts are executed by tests through `new Function(...)` against a DOM double that carries a real
computed style and answers only the exact selectors the script is contracted to ask for — so a widened query or
a deleted `paints()` branch fails, rather than being handed the fixture regardless.

**One unexplained transient.** One full-suite run reported `1 failed | 7742 passed`; the failing test's name was
not captured, and every re-run since has been green. Recorded rather than dismissed — a
prior unit in this workstream saw the same thing once and it is still unidentified.

**Mutation guards: 76/76 caught.** Among them: an absence claimed over a truncated scan; an unreported hidden
count folded into a measured zero; an unusable page reading coerced into a complete one; a conflicting row
keeping its containment; the group NAME emitted beside its ordinal; the derived name emitted beside its index;
`checked` added to the census; a page-authored category adopted verbatim; a candidate index pointing at no
candidate; a guessed second-option label added to the list; either blind gate defeated; `main()` printing the
refusal and launching anyway; either new read armed under the recon phase; the recon phase growing the
calibration actions; and the landed recon evidence's own absence bounds flipped.

### What the batteries and the review actually found

The first pass caught 55/60, and **two of the five misses were real**:

- The containment probe's `paints()` split on the *containment* half was dead weight — nothing asserted
  `deepestContainsHidden`. A label rendered into a collapsed panel would have been reported as visibly present.
- The `label[for]` id escaping was untested **because the test double was lenient**: its selector parser accepted
  an unescaped quote and handed the labels back anyway, so deleting the escaping changed nothing. A real browser
  throws on a malformed attribute selector, and the script's own `catch` turns that into zero associations. The
  double now throws. Verified load-bearing: against the *committed* tests, both mutations still survive.

Then a run reported `A6` as SURVIVED while the identical mutation applied by hand failed the suite — a **stale
vitest transform cache**. The battery now runs `--no-cache`. A runner that can report a false survivor is as
misleading as one that reports a false catch, and this workstream has been burned twice already by
first-occurrence collisions doing exactly that.

Independent review then found **three BLOCKING issues, ten more to fix, and eleven surviving mutations** — every
one of them verified by actually running it. The three that mattered most are in the sections above: the
unusable-reading coercion, the source-text-only launch gate, and the association census's own untested
`scanTruncated`. Two of its findings duplicated what the battery had already caught, independently.

Nine over-claims were corrected rather than argued with: "five integers" (it is four) in five separate places
including an operator-facing approval-action description; `ancestorLabelCount` described as able to report
"wired twice" when `closest()` makes it 0-or-1; `hiddenChoiceControlCount` not documented as the union of
not-painting and disabled; `candidatesCompared` counting blanks the comparison skipped; the doc's claim that
both Stage-2 phases route through one predicate while the preflight's embedded Python carried a duplicated phase
list; a "carries no page-authored text" assertion measured against a stubbed record whose Hangul allowlist was
partly built *from the record itself*; `rationale.length > 20` standing in for a provenance check that is
genuinely mechanical; and a `probeLabelContainment` / `choiceAssociationCensus` settle asymmetry that is
deliberate but was undocumented.

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
