# Coupang WING Issue Selector Calibration Landing v2

**Status:** landed · offline unit · no live run
**Lands:** the READ-ONLY live measurement taken on 2026-08-09 at `e8e62981`
**Predecessors:** `docs/coupang_wing_issue_selector_recalibration_v1.md` (the withdrawal this closes) ·
`docs/coupang_wing_issuance_form_reveal_v1.md` (the record it falsified)

## What this unit is, and what it is not

It is **evidence landing**. The selector was already corrected and the locator already fixed, in the previous
offline unit. Neither of those was a measurement, which is why the flag stayed `false` through them. A live
read-only probe has now taken the measurement, and this unit writes it down.

It is **not** a selector redesign. `WING_HIGHLIGHT_LABELS.issue` is byte-identical to the commit before this one —
the spec that was measured is the spec that ships, and a test now pins those two together rather than trusting
the sentence you just read.

## The measurement

```
git      e8e62981                       record   wingrec_f5ff0c250e44
surface  real no-key open_api_issuance  spec     { candidateQuery: "button", exactText: "API Key 발급 받기" }

visibleCount  1        hiddenCount  0        observedTag  BUTTON
canHighlight  true     fault        null     sig16        e9da2c58eb9fc190  (EVIDENCE_ONLY)
```

`hiddenCount: 0` is the one worth naming separately: there is no second, non-painting `API Key 발급 받기` node for
the locator to prefer. It is **silent about the 2026-08-09 decoy**, whose whole text was `발급` and which the
shipped spec does not match at all — the decoy is out of scope, not measured absent. Before the visibility filter,
"matched nothing visible" and "matched nothing" were both `count: 0`, and the failure hid in that collapse.

`observedTag: "BUTTON"` agrees with `WING_TARGET_EXPECTED_ROLE.issue` (`"button"`), where the refuted record
copied the expectation into a field named like an observation so the two could not disagree. Be precise about what
that fixes, because an earlier draft of this document was not: **both sides are source constants**, so the test
that asserts they match guards *the record* — it fires if someone edits `observedTag`, and it cannot fire because
of anything on a live page. There is no runtime tag assertion. What constrains identity on the page is the triple
of a tag-only `candidateQuery` (`"button"`, so a match can only ever be a button), the whole-text `exactText`
compare, and the visibility filter. The measured tag is what let the failure be **diagnosed**; it is corroboration
in the record, not an enforcement layer. See "Limits" below.

## One capture, and why that is enough here — and only here

`captureCount: 1`. Not four.

The refuted record had four agreeing captures across both account states, and that is a weaker basis than this
one, not a stronger one. Four measurements of uniqueness say nothing more about *identity* than one does; they
multiplied confidence in a claim none of them tested. Capture count was never the missing ingredient — measuring
the right property was.

So the claim is deliberately narrow: **on one live no-key surface, the shipped spec resolved to exactly one
painting element, and that element is a `BUTTON`.** No cross-surface, cross-session, or stability claim is made,
and none may be inferred. The already-issued surface has **not** been re-measured under the corrected spec.

One capture suffices for the same structural reason it suffices for 삭제: nothing in the runtime requires the
signature to be stable across runs. `signatureRole: "EVIDENCE_ONLY"` is what makes that true, so it is enforced
rather than promised — a test walks `collector/src/` and asserts no module outside the record's own file names
`WING_ISSUE_CALIBRATION_EVIDENCE` or the literal `sig16`. Introducing a cross-run signature comparison would
create a stability requirement one capture cannot honestly satisfy, and that test is what makes the attempt fail
loudly rather than silently.

That sweep has to exempt the record's own file, and review caught the exemption being transitive: the home file is
a runtime module (it already returns signature constants from the guided walk), so two lines inside it —
`export const X = WING_ISSUE_CALIBRATION_EVIDENCE.sig16;`, consumed elsewhere — rebuilt the anchor with the sweep
still green. Closed: the exemption is now by resolved path rather than basename, and inside the home file the
record may be **declared and nothing else** — no member access, and the signature literal may appear exactly once.
Both directions are mutation-tested.

## What was NOT adopted

The operator's sighting reported `id="policyAgreementWithAutoCategoryBtn"` and
`class="wing-web-component btn-api-key-gen"`. Those were candidate evidence for correcting the *label*. They are
not anchors, and this unit does not promote them: nobody has watched WING's generated ids or component classes
across releases, so anchoring on one would be the same species of unmeasured stability guess that produced the
refuted record in the first place. A test asserts no id/class/attribute anchor appears in `WING_HIGHLIGHT_LABELS`.

The strings are also gone from the source — leaving them in a constant beside the selector is a standing
invitation to reach for one. **This document is now their only record**, together with the test that names them
in order to forbid them. Nothing is lost that a future reader needs, but a reader following the source comment to
`supersedes` will not find them there, and the comment says so.

## Limits — what this record does not establish

Stated here rather than left for a future reader to discover, because the refuted record's defect was an
unmarked gap, not a false number.

- **`surface: "no_key_initial_surface"` is operator-attributed, not measured.** The probe structurally cannot
  produce it: `wingIssuedStateFrom` answers `NO_DISCRIMINATING_SIGNAL` because no sanitized signal separates a
  no-key page from an issued one, and `pageCategory` is `open_api_issuance` on both. It carries an explicit
  `surfaceAttribution: "OPERATOR_REPORTED_NOT_MEASURED"` beside it, and a test pins that label — an unlabelled
  outside-the-apparatus value sitting among measured ones is precisely how `role: "button"` happened. The
  `credentialAnchorPresentOnNoKeySurface` reading is therefore corroboration of the standing conclusion, not an
  independent proof of it.
- **"Painting" is weaker than "a human can see it".** `paints()` rejects `display:none`, `visibility:hidden`,
  zero client rects and zero-area boxes. It does not test `opacity`, occlusion, clipping by an `overflow:hidden`
  ancestor, or viewport position. A unique match that is `opacity: 0` would still count as `visibleCount: 1`.
- **`canHighlight: true` is a restatement of `visibleCount === 1`.** No ring was painted on this read-only run,
  so nothing here confirms a highlight is *visible*. The operator's own visual confirmation in the reveal run is
  the check for that, and it is the one the 2026-08-09 run did not have.
- **No probe artifact is committed.** All five values are hand-transcribed into a TypeScript constant, exactly as
  the refuted ones were. What changed is that the apparatus can now *produce* every field under `measured`; the
  transcription step itself is unguarded.

## What the flag does and does not assert

`WING_ISSUE_SELECTOR_CALIBRATED = true` asserts **selector readiness**. It is not an authorization and not a claim
about the press:

| still true after this unit | |
|---|---|
| `pressOutcome: "UNCONFIRMED"` | nobody has ever pressed 발급. A calibrated locator cannot imply otherwise. |
| `createsKeyMaterial: false` / `keyCreationRuledOut: false` | the two non-collapsible manifest claims, untouched |
| `issuedStateReason: "NO_DISCRIMINATING_SIGNAL"` | the classifier's answer, unchanged |
| agent click/type/submit budget | zero |
| `WING_HIGHLIGHT_CALIBRATION` | still `LIVE_DOM_CALIBRATION_PENDING` — `self_dev` / `vendor_info` / `call_ip` are unresolved on every surface measured so far |

**`credentialAnchorPresent` is still not an issued discriminator**, and this capture is fresh corroboration rather
than a reason to revisit it: the probe read `credentialAnchorPresent: true` on a surface confirmed to hold **no
key**. The conclusion now travels with the evidence — it is a field on the calibration record
(`credentialAnchorPresentOnNoKeySurface: true`) rather than a paragraph somewhere else.

## The withdrawal is retained, as a retraction

`WING_ISSUE_CALIBRATION_EVIDENCE.supersedes` keeps the refuted record: the four withdrawn record ids, the refuted
spec, what it actually observed (`visibleMatchCount: 0, nonPaintingMatchCount: 1`), the decoy's signatures, and
the withdrawn claim named in full as `FOUR_AGREEING_CAPTURES_WITH_AN_UNMEASURED_ROLE`.

It is history, never support. `captureCount` is 1 and does not include them; a test asserts the live record id is
not among the withdrawn ones, and that the refuted spec is still not the shipped spec.

## Verification

- `typecheck` green; full collector suite **7539 passed / 142 skipped, 0 failed**
- `wing-reveal-selfcheck.sh` **PASS** — and the PASS path it exercises is the point: the harness derives its
  expectation from the shipped constant, so flipping the flag automatically restored the manifest half (manifest,
  disclosure, complete Korean copy, descriptor display, `selectors calibrated: true`, the grant line) that the
  withdrawn commit correctly skipped and accounted for as `PARTIAL`.
- probe and deletion regressions unchanged
- mutation guards on the flag and the evidence provenance — see below
- independent adversarial review, which found **no** fail-closed regression, scope violation, or sanitization
  issue, and eight over-claims or gaps in the first draft. All are closed above: the unmarked `surface`
  attribution, the transitive sweep exemption, the constants-only tag "agreement", a docstring pointing at a
  deleted field, `canHighlight` described as an inference inside an inference-free block, "the decoy is gone",
  the `paints()` vocabulary, and a stale paragraph in the predecessor doc.

## Mutation battery — 19/19 caught

Each mutation applied to the landed tree, targeted tests run, tree restored and byte-compared. Every mutation
carries `as never` where the literal types would otherwise reject it, so what is being measured is whether a
**test** catches it, not whether `tsc` does — several are caught by both.

| # | mutation | caught by |
|---|---|---|
| L1 | flag silently withdrawn again (`false`) | reveal-driver + gate |
| L2 | `status` reverted to `LIVE_DOM_CALIBRATION_REFUTED` under a `true` flag | reveal-driver |
| L3a | issue `captureCount` inflated 1 → 4 | reveal-driver |
| L3b | deletion `captureCount` inflated 1 → 4 | deletion-driver |
| L4 | shipped spec reverted to the refuted `발급` | spec-equals-measured-spec |
| L5 | shipped spec widened to `button,a` | spec-equals-measured-spec |
| L6 | id anchor adopted into the shipped selector | no-id/class-anchor |
| L7 | `measured.hiddenCount` doctored to `1` | measured-record equality |
| L8 | `observedTag` → `"DIV"` | expected-role agreement |
| L9 | `signatureRole` → `"RUNTIME_ANCHOR"` | EVIDENCE_ONLY assertion |
| L10 | a runtime module imports the evidence record | the `src/` walk |
| L11 | `withdrawnClaim` renamed so the retraction stops naming itself | laundering guard |
| L12 | `pressOutcome` upgraded to `CONFIRMED` | press-outcome assertion |
| L13 | `issuedStateReason` softened off `NO_DISCRIMINATING_SIGNAL` | issued-state assertion |
| L14 | gate hardcodes `selectorsCalibrated: true` | gate source assertion |
| L15 | `main()` starts injecting the calibration seam | gate source assertion |
| R1 | alias export of `sig16` inside the exempt home file | home-file declaration-only guard |
| R2 | `sig16` literal duplicated in code inside the home file | home-file literal-count guard |
| R3 | `surfaceAttribution` softened to `"MEASURED"` | attribution assertion |

One process note, recorded because it is the same shape as the bug this unit exists for. The first run of L3
reported SURVIVED. It had not survived — the mutation string `captureCount: 1,\n  signatureStability:` matches the
**deletion** record first, so a first-occurrence replace hit a record the reveal tests do not read. A mis-aimed
mutation reporting green is exactly the "the check never ran" failure mode. Re-aimed with the preceding `sig16`
line as a unique anchor, both records' guards fire (L3a, L3b above).

## Not in this unit

No live run, no WING window, no highlight, no press. No Stage-2 recon, no guided 7-step restructure, no deletion
tooling change, no selector change beyond the calibration record itself.

## Still open

The **삭제 calibration** rests on the same unmeasured `role: "button"` and a single capture, and it gates the
destructive path. It is frozen/internal-only and was excluded from this unit by the product owner. Its withdrawal
is a decision, not a finding.

Sharpened by review, and worth stating exactly: `WING_DELETION_CALIBRATION_EVIDENCE.role` is documented in source
as *"The candidate's accessible role, **as measured**"*. It was not measured — it came from the same expectation
table, through the same `role`-named field, as the 발급 claim that was refuted. So source and this document now
contradict each other on that record. Deliberately not touched here (deletion tooling is out of scope for this
unit), and a source reader who consults only the comment gets the wrong answer until it is.

> **Closed in the next unit** (`docs/coupang_wing_delete_calibration_withdrawal_v1.md`), which also found the
> harder problem: that record's `matchCount: 1` was captured at `a666ad1`, **before** the visibility filter
> landed at `a3ef479e`. The 삭제 calibration is withdrawn and the destructive path is fail-closed.

`wing-probe-selfcheck.sh` and `wing-deletion-selfcheck.sh` still print `SELFCHECK PASS` with exit 0 while skipping
their clean-tree halves on a dirty tree — the fail-open the reveal harness closed with `PARTIAL`/exit 2. Recorded,
not a blocker: the runtime preflight fail-closes on clean-tree and repo identity directly.

## Next

`Coupang WING Issuance Form Reveal Live v2` — fresh bootstrap, fresh manifest, fresh single-use grant, operator
navigation, `ready`, highlight the real `API Key 발급 받기` button, **the operator confirms the highlight visually**
before anything else, the operator presses it, one sanitized observation, STOP. That visual confirmation step is
new, and it is there because it is the only check the 2026-08-09 run did not have.
