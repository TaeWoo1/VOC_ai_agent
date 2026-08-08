# Coupang No-Key Form — Classifier Correction + Selector Recon v1

> **Status:** offline. Corrects a classifier verdict that was **wrong on real data**, and designs the read-only
> recon that would narrow three unresolved WING labels. No live run, no browser, no marketplace contact.
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
| `issue` matchCount | 1 (sig `d3f775e8…`) | 1 (sig `b7ba43a8…`) | no |
| `readonlyFieldCountBucket` | **not transcribed** | `none` | unusable |
| `editableTextInputCountBucket` | **not transcribed** | `many` | unusable |
| `formCountBucket` | **not transcribed** | `few` | unusable |
| `submitAffordancePresent` | **not transcribed** | `false` | unusable |

**Every signal recorded on both sides is identical**, and the four that might have discriminated are not in
hand for the issued page.

### Corrected after review: "not transcribed", not "unmeasured"

The first version of this document said those four were **never measured**. That was wrong, and the error is
worth naming because it is the same mistake the document exists to correct. Checking the code at the capture
commit shows `formCount` / `editableTextInputCount` / `readonlyFieldCount` / `submitAffordancePresent` were
already in the census on 2026-08-06, and the probe CLI printed the whole observation to stdout. **The numbers
existed.** Nobody wrote them into a doc, and the run output is not in the repository.

So the honest statement is *not available here*, and — importantly — **possibly recoverable without a live
run**, from operator scrollback or a local run log. That should be checked before any grant is spent
re-measuring it. The consequence for code is unchanged: the numbers are not in hand, so a predicate written
today would still be inventing the issued-page side.

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

A capture on a page **known** to hold a key, recording what we already record on the no-key form:
`readonlyFieldCountBucket`, `editableTextInputCountBucket`, `formCountBucket`, `submitAffordancePresent`, and
the `credentials` target's matchCount under its `tagAncestor: "tr"` locator.

That last one is the most promising untested lead: a credential displayed in a table **row** is structurally
different from the same words appearing as static form text. It is a **measurement to take**, not a rule to
ship — writing it as a predicate now would repeat exactly the mistake being corrected.

**First, check whether it needs a live run at all.** Per the correction above, the 2026-08-06/07 runs printed
these values; if that output survives in operator scrollback or a local log, the issued-page side can be
recovered for free. Only if it does not is a fresh capture needed — and since the account now has no key, that
capture is only possible **after the next issuance**, which puts it in the issuance unit rather than a separate
live run.

## Goal 2 — the recon design

`src/action-window/coupang-wing-label-recon.ts`. Three unresolved targets become **candidate sets**, measured in
one read-only pass: WING returns integers, and every string in the exchange is one we wrote.

**No new browser tooling.** The in-page half is the existing audited `buildFixedLabelProbeScript` from the NAVER
visual-recon calibration, whose entire output is `{ targetId, matchCount }`. A test asserts the WING recon
script *is* that shared script, so a fork would have to be argued for.

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
unmeasured-versus-measured-zero conflation corrected above, inverted. It matters concretely: the shared in-page
probe swallows a malformed `candidateQuery` and reports nothing for it, so a partly-failed script would
otherwise read as "all candidates confirmed absent" and send a reviewer off to rewrite labels that were never
tested. A junk count (negative, fractional, `NaN`) is `INVALID_COUNT` for the same reason.

Review also found the promotion guard **could not fail**: it scanned a hardcoded list of the four exports it
already knew about, so adding `export function promoteCandidateToShippedLabel()` passed every test. It now
scans the module's real namespace. Similarly, `Object.freeze` is shallow — each candidate object is frozen
individually, because otherwise `CANDIDATES.call_ip[0].exactText = <anything>` succeeds and that string is
shipped straight into the page.

## If a live recon run is wanted

Not required by this unit, and not started here. It would be its own unit with a fresh bootstrap and a fresh
grant:

```bash
SELLEROPS_WING_PROBE_TARGETS=self_dev,vendor_info,call_ip tools/coupang-local/wing-probe-bootstrap.sh
```

Scope is exactly the three unresolved targets (`WING_RECON_APPROVED_SCOPE`). READ_ONLY: no highlight, no click,
no form input, no 발급, no credential value read.

> **The sweep is NOT wired to that command yet, and the command alone would not run it.**
> `wing-probe-bootstrap.sh` drives `probe-wing-issuance-selectors.ts`, whose labels come from
> `WING_HIGHLIGHT_LABELS` — the **baselines**. Running it with the three recon targets re-measures
> `self_dev 0 / vendor_info 8 / call_ip 0`, which we already have, and sweeps no candidates. Wiring the sweep
> into a runner is deliberately left to the unit that spends the grant, so this module stays a design plus its
> tests rather than half-connected live machinery. Do not book a grant against the command above expecting
> recon results.

**A cheaper ordering is worth considering first.** The next planned unit — the WING-resident issuance tutorial
and the operator's own key issuance — must visit this same form anyway, and it produces the issued-page capture
that Goal 1 needs. Running recon as part of that visit costs one grant instead of two. The trade-off is real
though: a failed recon inside the issuance unit would be a distraction at a moment when the operator is trying
to issue a key. Product-owner call.

## Not done in this unit

No live run. No 발급 / 재발급, no form input, no credential value read, no credential replacement, no
connect-test, no order sync, no marketplace write. No selector was changed: `WING_HIGHLIGHT_LABELS` is
byte-identical, and the three unresolved labels stay exactly as they were until a live reading justifies a
change.
