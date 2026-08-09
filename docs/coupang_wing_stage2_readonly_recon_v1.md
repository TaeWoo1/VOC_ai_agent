# Coupang WING Stage-2 READ_ONLY Recon v1

> **Status:** offline. Builds the capability to measure the real Stage-2 purpose-selection surface read-only. No
> live run in this unit, no browser, no marketplace contact. No selector change, no Stage-2 selector promotion,
> no guided tutorial or stage-ordering change, no deletion tooling change.

## What is being answered, and what is not

Reveal Live v3 established that Stage-2 exists and that something with 1–3 choice controls appears
(`choiceControlCountBucket none → few`, one capture). It could not say **what** those controls are. This unit
builds the instrument for that question and nothing beyond it.

It cannot answer it offline. The output of this unit is a capability plus a manifest; the answer needs a live
grant.

## Reused, not rebuilt

Almost all of it already existed, and the honest summary is that this unit is mostly wiring:

| need | reused |
|---|---|
| candidate label sets | `WING_STAGE2_RECON_CANDIDATES` — declared inert in a prior unit, now wired |
| read-only match counting | the driver's existing `probeFixedLabelMatch` seam — the same call the baseline probe makes |
| verdict folding | `interpretWingRecon`'s logic, generalised over a candidate map rather than copied |
| structural census | `EXTRACT_WING_CENSUS`, unchanged |
| sentinel walk, bootstrap, preflight, manifest | the existing probe harness, phase-parameterised already |

**Exactly one new measurement primitive**: `EXTRACT_WING_CHOICE_CONTROL_SHAPES`.

## The one new measurement

It answers "what KIND of controls are these" — the thing a bucket delta cannot say:

```
visibleChoiceControlCount   painting + enabled, same rule as choiceControlCount
hiddenChoiceControlCount    matched the selector but does not paint
shapes[]                    (tag, inputType, role) → count
groupContainerCount         painting fieldset / [role=radiogroup] / [role=listbox]
scanTruncated               the scan hit its cap with candidates unexamined
```

**Closed vocabularies are the whole sanitization argument.** `tag`, `inputType` and `role` are each mapped
against a fixed allow-list, and anything else becomes `OTHER` / `other`. An open vocabulary would let the page
choose the strings in our record — a `role="사용목적-자체개발"` would arrive as page text wearing a category's
clothes. A closed list can only emit words we wrote, whatever the DOM contains. A test feeds exactly that hostile
role through the real script and asserts it does not appear in the output.

Re-validated **host-side** as well, so the record's vocabulary is guaranteed by code the page cannot influence
even if a future edit to the in-page script forgets to map.

Deliberately absent, each for a stated reason: element text or accessible names (that is the candidate sweep's
job, and it compares against labels *we* fixed), `id` / `class` / `name` / `data-*` (site-authored strings — the
`issue` calibration already got burned adopting one), `value` / `placeholder`, geometry, and **`checked`**, which
would leak whether the operator selected something.

## The precondition, and why it refuses rather than warns

The operator presses 발급 themselves and then signals ready, so nothing structurally prevents a sweep of Stage-2
hypotheses running against the **initial** surface. That would produce six confident `ABSENT` verdicts for labels
that were simply never on screen — worse evidence than none, and precisely the non-transferability the previous
recon already established in the other direction.

`wingStage2Precondition` requires the one thing the reveal run actually measured: a visible choice control
(`choiceControlCountBucket !== "none"`). On anything but `OK` **no candidate is probed and no census is taken** —
the sweep does not run, rather than running and being annotated. `undefined` is treated as `NOT_OBSERVED`, never
as an empty Stage-2.

It is a **necessary** condition, not a sufficient one: it cannot prove the surface is Stage-2, only rule out the
surface we know it is not.

## Its own phase, its own namespace

`COUPANG_WING_STAGE2_RECON` is separately approvable, and the reason is not a stronger capability — the agent's
is if anything narrower (no highlight, no shipped-label baseline). It is the **surface**: the operator has
pressed 발급, so this runs on a screen from which the final, key-creating `확인` is reachable. The manifest has to
say that, and the operator has to grant against it.

The gate refuses a **one-sided phase in both directions**. That check earns its place here more than anywhere:
without it, a Stage-2 manifest whose phase failed to reach the run would fall through to an ordinary baseline
probe — measuring three shipped labels on the Stage-2 screen, printing a sanitized record, exiting 0, and
spending a live grant on a reading nobody asked for.

Stage-2 targets (`purpose`, `self_dev`, `vendor_info`, `vendor_url`, `call_ip`, `confirm`) live in their own
namespace with their own env var and their own manifest field. `purpose`, `vendor_url` and `confirm` are **not**
added to `WING_PROBE_TARGET_NAMES`: widening the canonical set so one parser could be shared would let an
ordinary selector probe be pointed at them too.

## A latent bug this unit's own tests found

`WING_STAGE2_RECON_CANDIDATES` used `Object.freeze`, which is shallow. `readonly` is erased at runtime, so
`WING_STAGE2_RECON_CANDIDATES.purpose[0].exactText = <anything>` **succeeded** — and that string is shipped
straight into the live page as an exact-match query. Survivable while the set was inert; load-bearing the moment
it was wired to a runner. Now `deepFreezeCandidates`, the same helper the initial-surface sets already used.

## What a reading may and may not do

Every candidate that resolves is **evidence only**. This unit adds no promotion path, and a test re-asserts the
recon module still names neither `WING_HIGHLIGHT_LABELS` nor `WING_DELETION_LABELS` outside comments. The
operator-transcribed sentence stays a candidate; the census contains no Stage-2 text.

`확인` is measured for **presence and count only** — located so a future unit knows where it is, never pressed,
and this run has no tooling that could press it.

## Verification

typecheck green. Full collector suite: **310 files / 7657 tests passed**, 18 files + 142 skipped (was 7603 —
**+54**). `wing-probe-selfcheck` **PASS / exit 0 on a clean tree, 58 cases**, including 13 new Stage-2 ones;
`wing-reveal` 0; `wing-deletion` 2 (PARTIAL by design).

**Mutation battery: 32/32 caught.**

### The capability had no output path

Independent review found the blocking defect: **the Stage-2 measurement was computed and thrown away.** A live
run under a granted manifest would sweep six candidate sets, take the shape census, fold every verdict — and
print a record containing none of it. `result.stage2` was referenced nowhere outside the orchestrator, and no
test covered `main()`'s emitted record, which is why the suite was green. The measurement is the entire product
of the grant.

Now emitted via `stage2RecordFor`, with the **precondition first** — every count below it is meaningless without
it, since zero targets beside a failed precondition means "no sweep ran", never "Stage-2 is empty".

### The manifest described the run as something else

`approval-manifest-cli.ts` has per-phase `operation` / `maxActions` chains and the Stage-2 phase had no branch,
so both fell through to the default. The two most prominent operator-read lines announced a read-only recon with
`allowsHighlight: false` as **"API issuance highlight proof · max: 1 highlight proof session"**.

And `SELLEROPS_WING_STAGE2_TARGETS` never reached the manifest at all: `requestedStage2Targets` had no producer,
so the resolver always saw `undefined` and returned all six. A narrowed bootstrap printed one target while the
preflight bound and printed six. The narrowing this document claimed was **dead on the harness route**.

Both were invisible offline because the phase shipped with **zero selfcheck coverage** against seven cases for
the label recon. There are now 13, and an end-to-end case is exactly what catches manifest wording.

### The selfcheck was certifying coverage that never ran

Worse: this harness printed `SELFCHECK PASS` and exited 0 while skipping every PASS-path case on a dirty tree —
so the new Stage-2 block silently did not execute on its first run. Recorded above as pre-existing; adding cases
made it load-bearing, so it now reports `PARTIAL` / exit 2, matching the reveal and deletion harnesses.

### Three more surviving mutations

- The driver's `choiceControlCensus` was **called by no test**, so deleting the host-side re-sanitization — this
  document's central sanitization claim — was invisible.
- The DOM double dispatched on `sel.includes("radio")` and always returned a visible computed style, so widening
  the census query and deleting the `display:none` / `visibility:hidden` branch both survived. It now matches the
  selector exactly and carries per-element style.
- The promotion guard was source-text and survived appending an `adoptStage2Candidate()` writing a new
  shipped-labels map. Replaced with the namespace-scanning form the sibling test already used — whose own comment
  records that source text was rejected in review for this exact reason.

### Claims corrected

"NOT WIRED TO ANY RUNNER, and this note is accurate" (this unit wired it, and a comment ten lines below already
contradicted it) · "the set of scripts this driver may run is a property tests assert" (true of the reveal
driver, not this one — seven `evalStr` sites, no bound) · `hiddenChoiceControlCount` documented as not-painting
when it is the union with disabled · `visibleChoiceControlCount` "the same rule" when this scan caps at 4000 and
`countVisible` does not. Bucket loss now reports `bucketsTruncated` instead of dropping silently.

## Not in this unit

No live run, no browser, no WING contact. No selector change, no Stage-2 selector promoted, no census field
changed on the existing census, no guided tutorial or stage-ordering change, no deletion/NAVER/credential/
connect/sync work.

## Next

The live Stage-2 recon, under its own fresh bootstrap → manifest → single-use grant: the operator logs in,
presses `API Key 발급 받기` themselves, stops on the purpose screen choosing nothing, and signals ready. One
read-only pass. Then, and only then, an offline unit redesigns the guided tutorial step plan from what was
measured.
