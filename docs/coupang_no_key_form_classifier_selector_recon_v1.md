# Coupang No-Key Form — Classifier Correction + Selector Recon v1

> **Status:** offline. Corrects a classifier verdict that was **wrong on real data**, and designs — and, since
> 2026-08-08, **wires** — the read-only recon that would narrow three unresolved WING labels. No live run, no
> browser, no marketplace contact.
>
> **Updated 2026-08-08 (Selector Recon Runner v1).** Two changes to what this document said:
> the issued-page structural buckets, recorded here as *not transcribed*, were **recovered from retained
> session scrollback** across four agreeing captures — so the comparative audit is now complete on both sides
> and every row matches; and the sweep is **wired to a gated READ_ONLY runner** under its own approval phase
> `COUPANG_WING_LABEL_RECON`, replacing the "not wired to a runner" warning below.
>
> Evidence status of the 2026-08-08 live probe:
> **`REAL_NO_KEY_WING_FORM_OBSERVED_SELECTOR_CALIBRATION_PARTIAL`**
> — `issue`: LIVE UNIQUE · `self_dev` / `vendor_info` / `call_ip`: NEEDS RECALIBRATION · issued-state
> classifier: **FALSE POSITIVE FOUND**. Deliberately **not** recorded as
> `REAL_NO_KEY_WING_ISSUANCE_FORM_CALIBRATION_PASS`: one of four targets resolved.

## The new fact

The operator confirmed directly that the 2026-08-08 live screen was the **real no-key issuance form**,
immediately after the key deletion. The probe read `credentialAnchorPresent: true` on that screen.

So the anchor — an exact-text match on "Access Key" — is a **false positive for issued-state**. The no-key form
carries those words too. **This is not evidence the deletion failed.** The deletion succeeded; the instrument
was wrong.

## The comparative audit

Both real captures, side by side. This is the whole basis for what follows, and it is recorded in code as
`WING_REAL_EVIDENCE_ISSUED_2026_08_07` / `WING_REAL_EVIDENCE_NO_KEY_2026_08_08` so it can be asserted rather
than believed.

| Signal | real ISSUED page (2026-08-06/07) | real NO-KEY form (2026-08-08) | separates? |
|---|---|---|---|
| `pageCategory` | `open_api_issuance` | `open_api_issuance` | no |
| `credentialAnchorPresent` | `true` | **`true`** | **no — false positive** |
| `openApiMarkerPresent` | `false` | `false` | no |
| `self_dev` matchCount | 0 | **0** | no |
| `call_ip` matchCount | 0 | **0** | no |
| `vendor_info` matchCount | 9 | 8 | no (non-unique on both) |
| `issue` matchCount | 1 | 1 | no |
| `issue` sig16 (2026-08-07 vs 08-08) | `b7ba43a8…` | **`b7ba43a8…`** | **no — byte-identical** |
| `readonlyFieldCountBucket` | `none` | `none` | **no** |
| `editableTextInputCountBucket` | `many` | `many` | **no** |
| `formCountBucket` | `few` | `few` | **no** |
| `listLikeContainerCountBucket` | `many` | `many` | **no** |
| `submitAffordancePresent` | `false` | `false` | **no** |

**The table is complete on both sides, and every row matches.**

### Updated 2026-08-08 — the missing side was recovered, without a grant

The four bottom rows read *not transcribed* until 2026-08-08. Naming that precisely — measured, printed, never
written down; **not** unmeasured — is what made a recovery search worth running, and the search succeeded: the
issued-page observation survives in retained session scrollback across **four independent captures**
(`wingrec_fc4cbafb42c8`, `wingrec_b2e87f42abd1`, `wingrec_42985b029ddd`, `wingrec_c01e673ebc61`), all reporting
the same four buckets. No live run was needed. The values are now transcribed into
`WING_REAL_EVIDENCE_ISSUED_2026_08_07` with `bucketsRetained: true`.

`markerScanTruncated` stays **absent** on the issued side rather than `false`: that census field did not exist
in 2026-08-06/07, so there is no reading to transcribe.

**What this changes.** `indeterminate / NO_DISCRIMINATING_SIGNAL` was a fail-closed default over missing data.
It is now a **measured result**: across every sanitized signal this recorder captures, the two surfaces are
indistinguishable. That is a stronger and less comfortable statement than "not known yet".

**Why they match — a hypothesis, not a finding.** The census counts the whole document, so the WING shell
(navigation, search, menus) supplies most forms, inputs and list containers and the open-API region cannot move
a coarse bucket. Note `readonlyFieldCountBucket: none` on the *issued* page: the displayed keys are not readonly
inputs at all. The `issue` button's structural signature being byte-identical across the two surfaces points the
same way. If correct, the fix is a **region-scoped census**, not a cleverer predicate over these numbers.

**And a caution about sig16.** The 2026-08-06 captures reported `d3f775e8…` / `2b2479a8…` for `issue` /
`credentials`; the 2026-08-07 capture reported `b7ba43a8…` / `de6d3578…` for the same targets on the same page,
with no change to the signature code in between. sig16 tracks the page **as rendered that day** — it is a drift
detector, not a cross-session identity. Do not build on an unchanged sig across sessions.

### A previous conclusion this falsifies

`coupang_wing_live_calibration_v1.md` recorded that `self_dev` / `call_ip` are "form-only controls,
`matchCount=0` on the already-issued page", and inferred from that a "coherent already-issued shape" in which
the issuance-form controls are absent while the keys and 발급 are present.

The real form gives **0 for both as well**. So those zeros never showed form-only-ness — the labels simply match
nothing on either surface. The inference built on them is withdrawn, and that doc now carries the correction.

## Goal 1 — what changed in the classifier

`wingIssuedStateFrom` no longer returns `issued` or `not_issued`. On the open-API surface it returns
`indeterminate` / `NO_DISCRIMINATING_SIGNAL`.

**This is fail-closed, not unfinished.** Writing any replacement predicate today would mean inventing the
issued-page side of it. The rule from `collector/CLAUDE.md` §6 — correct markers from observed findings, never
tune them speculatively — applies to state predicates exactly as it applies to selectors.

Three deliberate details:

- **`credentialAnchorPresent` survives as a surface signal.** `classifyWingPage` still uses it to reach
  `open_api_issuance`, and that use is untouched and still correct: both pages genuinely *are* the open-API
  surface. What it may no longer do is stand alone as a state verdict.
- **`SCAN_TRUNCATED` stays a separate reason** from `NO_DISCRIMINATING_SIGNAL`. Both are `indeterminate`, but
  one is an incomplete reading that a better read might fix, and the other needs new evidence. Collapsing them
  would hide which is which in a record.
- **`wingDeletionEvidenceFrom` keeps its rule and loses its input.** It can no longer return
  `confirmedNotIssued: true`, because nothing emits `not_issued`. The two-reading corroboration standard is
  still right and stays intact for when a real discriminator exists. Callers must read post-delete state as
  **unavailable**, not as `false`.

### What would restore a verdict

Not the buckets — those are now known to be flat on both sides. Two leads remain, both **measurements to take**
rather than rules to ship:

1. **The `credentials` target on the no-key form.** It matched 1 on the issued page (role `readonly-region`,
   under a `tagAncestor: "tr"` locator) and has **never been probed on the no-key form** — that run's approved
   scope was `self_dev,vendor_info,call_ip,issue`. A credential shown in a table **row** is structurally
   different from the same words as static form text, so its count/role/signature may differ where the
   page-global census does not. **This needs no new code**: `credentials` is already a probe target, so an
   ordinary `COUPANG_WING_SELECTOR_PROBE` run scoped to it settles the question. It is the cheapest untested
   discriminator available, and the account is in the no-key state *right now* — the only state in which this
   particular reading can be taken.
2. **A region-scoped census.** New code and a new sanitization review; it should not be built before (1) is
   tried.

## Goal 2 — the recon design

`src/action-window/coupang-wing-label-recon.ts`. Three unresolved targets become **candidate sets**, measured in
one read-only pass: WING returns integers, and every string in the exchange is one we wrote.

**No new browser tooling.** Each candidate is measured through the driver's existing read-only
`probeFixedLabelMatch` seam — literally the same call the shipped baseline probe makes, running the audited
`buildFixedLabelLocateScript`, whose entire output is `{ count, sig? }`. A source guard asserts the runner
builds no in-page script of its own.

> **Changed 2026-08-08 (was: the batch `buildFixedLabelProbeScript`).** The v1 design shipped one batch script
> for the whole sweep. Two properties this module claims are unobtainable that way:
>
> 1. **No signature.** The batch script returns counts only, so two simultaneously-unique candidates — the case
>    the module deliberately refuses to auto-resolve — could not be resolved offline either, and the grant
>    would have to be spent again. The locate seam returns the opaque structural sig for a unique match.
> 2. **A malformed `candidateQuery` reads as a real zero.** The batch script's `try { querySelectorAll } catch
>    { els = [] }` emits `matchCount: 0` for a query the browser rejected, so `NOT_MEASURED` — which fires on a
>    *missing row* — could never catch it. The v1 doc claimed the opposite. Neither in-page script can tell the
>    two apart at runtime, so validity is now proven **offline** instead: a guard test requires every shipped
>    `candidateQuery` to be a comma-separated list of bare element names.

`EXTRACT_VISUAL_CONTROLS` — the heavier structural census — was considered and **rejected**: it returns raw
attribute values and bounding boxes that then need a screening gate. That is a larger sanitization surface than
this question needs, and a needlessly larger one on a page that may hold company data.

Candidate sets are mechanical rather than imaginative on purpose — spacing, case and container variants of the
same word, plus the field-label-vs-option distinction — because inventing different wording would be guessing
at WING's copy, which is what the measurement is for. Each set **leads with the currently shipped label**, so
the baseline is re-measured in the same conditions; otherwise a candidate could look better only because the
page changed.

### It can only measure

There is no promotion path from a recon result into `WING_HIGHLIGHT_LABELS`. A candidate may be promoted only
by a human in a reviewed diff, justified by a recorded live reading. Two structural tests hold that line: the
module exports no `promote`/`apply`/`write` surface, and a full interpretation leaves the shipped labels
byte-identical.

**Two unique candidates is not a winner.** Two labels each matching one element says nothing about whether it is
the *same* element, and a highlight aimed at the wrong one is a real defect — so `resolvedUnambiguously` is true
only when exactly one candidate resolves.

**A candidate missing from a reading is `NOT_MEASURED`, with a null count.** The first version folded it into
`0` / `ABSENT`, which made a partial reading byte-identical to a complete all-miss one — the same
unmeasured-versus-measured-zero conflation corrected above, inverted. With the sweep now probing candidates one
at a time, this is reachable for real: a candidate whose read-only probe **throws** (the page navigated or
closed under it) contributes no row and is recorded as `NOT_MEASURED` plus a sanitized fault fingerprint, so a
page that moved mid-sweep cannot report the remaining labels as "confirmed absent". A junk count (negative,
fractional, `NaN`) is `INVALID_COUNT` for the same reason.

Review also found the promotion guard **could not fail**: it scanned a hardcoded list of the four exports it
already knew about, so adding `export function promoteCandidateToShippedLabel()` passed every test. It now
scans the module's real namespace. Similarly, `Object.freeze` is shallow — each candidate object is frozen
individually, because otherwise `CANDIDATES.call_ip[0].exactText = <anything>` succeeds and that string is
shipped straight into the page.

## The live recon runner (wired 2026-08-08)

The v1 warning — *"the sweep is NOT wired to a runner; do not book a grant expecting recon results"* — is
**resolved**. The sweep now runs under its own approval phase.

```bash
SELLEROPS_APPROVAL_PHASE=COUPANG_WING_LABEL_RECON tools/coupang-local/wing-probe-bootstrap.sh
tools/coupang-local/wing-probe-preflight.sh          # prepares + displays the recon manifest
# then, on "Seated and ready.", the command the preflight prints — which carries the PHASE inline
```

**Recon is armed by the approved PHASE, never by a flag.** The manifest is what the operator reads before
granting, so "measure the 3 shipped labels" and "sweep 12 hypotheses for those 3 labels" must be different
manifests. `COUPANG_WING_LABEL_RECON` is a separate `CalibrationPhase` with its own operator summary (which
states in Korean that the run changes no selector); the recorder derives recon mode from
`SELLEROPS_APPROVAL_PHASE`, and the preflight prints that variable on the run command for exactly that reason —
a command missing it would run a baseline probe under a recon manifest.

Two fail-closed rules, both **before Chrome launches**:

- **Every approved target must be sweepable.** Not the intersection — the whole approved set. A scope of
  `self_dev,delete` refuses (`RECON_TARGET_NOT_APPROVED`) rather than sweeping one target while the manifest
  described two, so `approved scope == swept scope` stays a readable identity.
- **The manifest gate refuses the same scope**, so a manifest the runner would reject is never displayed. The
  reflex when an approved run dies at the gate is to widen the scope until it starts; this keeps that failure
  on the preparation side, where widening is a reviewed edit.

The phase defaults its scope to the three unresolved targets and never to the full WING set. `issue` is
excluded: it already resolves uniquely on the real no-key form, and re-measuring it would invite retuning
something already proven.

**What the run records per candidate:** id, our own fixed label, expected role, `matchCount`, closed verdict,
`canHighlight`, opaque sig16, and `NOT_MEASURED` distinguished from a measured zero — plus the sanitized surface
observation. **No promotion.** A candidate that resolves uniquely is evidence; changing a shipped label is a
later offline edit with its own tests and PR.

**A cheaper ordering is still worth considering.** The next planned unit — the WING-resident issuance tutorial
and the operator's own key issuance — must visit this same form anyway, and it produces the issued-page capture
Goal 1 needs. Running recon as part of that visit costs one grant instead of two. The trade-off is real: a
failed recon inside the issuance unit is a distraction at the moment the operator is trying to issue a key.
Product-owner call. **If recon does get its own grant, add `credentials` to it** — see *What would restore a
verdict* above; it is measurable today, only in the current no-key state, and needs no new code.

## Not done in this unit

No live run. No 발급 / 재발급, no form input, no credential value read, no credential replacement, no
connect-test, no order sync, no marketplace write. No selector was changed: `WING_HIGHLIGHT_LABELS` is
byte-identical, and the three unresolved labels stay exactly as they were until a live reading justifies a
change.

The recon runner is wired and gated but **has never been run against WING**. Every candidate in
`WING_LABEL_RECON_CANDIDATES` remains an unmeasured hypothesis.
