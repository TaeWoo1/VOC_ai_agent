# Coupang WING Stage-2 Recon Evidence Landing v1

> **Status:** offline. Lands the first structural measurement of the Stage-2 purpose-selection surface. No live
> run, no browser, no marketplace contact. No selector promoted, no ordering changed, no tutorial redesign.

## The run

| | |
|---|---|
| git | `277220f7` |
| run / approval | `wt-2b984a46c298` / `apr-188a2831bc7b` |
| record | `wingrec_0f296204926c` |
| phase | `COUPANG_WING_STAGE2_RECON`, agent `READ_ONLY` |
| operator | pressed `API Key 발급 받기` themselves, left the purpose screen untouched |
| agent click / type / submit / highlight / tag | **0** |
| precondition | `OK` |
| teardown | sentinels swept · window closed · tree clean · grant consumed |

## MEASURED

**The purpose selection is two native radio inputs.**

```
visibleChoiceControlCount   2
hiddenChoiceControlCount   10
visibleShapes               INPUT · type=radio · role=none  ×2
groupContainerCount         0
scanTruncated               false
bucketsTruncated            false
```

Not role-option cards, not a listbox — plain `<input type="radio">` with no ARIA role and **no painting
`fieldset` / `radiogroup` / `listbox` container**. Ten further controls matched the selector but were excluded
(not painting, or disabled); that is the larger number, and omitting it would misdescribe the DOM as containing
two.

> **Not "the radios are ungrouped."** HTML groups radios by their shared `name` attribute, which the census
> deliberately never reads, and `[role=group]` is not in the selector either. Three specific painting container
> kinds were absent. The code comment claimed the stronger thing and has been corrected.

Both of the **shape census's** bounds were clear. Those flags say nothing about the candidate sweep below — see
the limits on ABSENT.

**Candidate labels: one resolved, seven measured absent.**

| target | candidate | count | verdict |
|---|---|---|---|
| confirm | `확인` | 1 | **UNIQUE** · sig `c1b87128024cdec8` |
| purpose | the transcribed sentence | 0 | ABSENT |
| self_dev | `직접입력`, `자체개발` | 0, 0 | ABSENT |
| vendor_info | `업체명` | 0 | ABSENT |
| vendor_url | `URL` | 0 | ABSENT |
| call_ip | `IP 주소`, `호출 IP` | 0, 0 | ABSENT |

`candidatesMeasured: 8`, `candidatesNotMeasured: 0`, `probeFaults: 0`. These are **measured zeros**, and the
arithmetic is what proves it: 7 absent + 1 unique = 8, none unmeasured, nothing faulted. Without that, an
`ABSENT` is indistinguishable from a probe that never ran.

### What an ABSENT does NOT bound — `absenceBounds`

Two real limits, neither stated in the first draft:

1. **It counts painting matches only.** The locate script also returns a `hiddenCount`, and the Stage-2 sweep
   **discards it**. So `ABSENT` cannot distinguish "no element carries this text" from "an element carries it
   but does not paint" — the same visible/hidden ambiguity the `issue` locator was burned by, and the reason the
   shape census carries `hiddenChoiceControlCount` at all.
2. **The locate script caps its scan at 4000 elements and reports no truncation flag.** So an absence is not
   provably a whole-document absence.

Recorded rather than fixed: carrying `hiddenCount` through the sweep is a capability change and this unit lands
evidence. It is the first thing the label-calibration unit should close.

## What is deliberately NOT claimed

**`확인` is located, not promoted.** It matched exactly one painting element and has a signature. What it *does*
is unmeasured: nothing pressed it, and this phase has no tooling that could. Its role as the key-creating
control comes from the product owner's description of the official flow, and the record says exactly that —
`isFinalIssuanceControl: "OPERATOR_FLOW_DESCRIPTION_ONLY_NOT_MEASURED"`, `effectMeasured: false`,
`pressed: false`, `signatureRole: "EVIDENCE_ONLY"`. Locating a button is not learning its effect; the `발급`
calibration already made the inverse mistake by asserting a role it never read.

**The two radios' meaning is unmeasured.** `purposeOptionSemanticsMeasured: false`. Two controls were counted;
no label, no accessible name, no association was read. Deciding which one is 자체개발 from a count of two would
be inventing a product decision. A test asserts no purpose wording appears anywhere in the record.

**The ordering is untouched.** `WING_STAGE2_RECON_TARGETS` is byte-identical. A measurement is not a licence to
re-sequence a product-facing list, in either direction.

**No selector promoted.** The module still has no promotion path.

## Provenance, kept in three classes

| class | content |
|---|---|
| **MEASURED** | every count, shape, verdict and signature above |
| **OPERATOR_REPORTED** | that the purpose screen was visibly open and persistent, and the sentence's wording |
| **INFERRED** | *why* seven candidates missed |

The inferred item is the one worth naming precisely. `exactText` compares an element's **whole** normalized
text, so a sentence rendered across nested nodes matches nothing — the same shape as `발급` failing against
`API Key 발급 받기`. It is the leading explanation and it is **untested**:
`absenceExplanation: { provenance: "INFERRED", tested: false }`.

`keyCreationRuledOut` stays `false`; `issuedStateReason` stays `NO_DISCRIMINATING_SIGNAL`. One capture,
`SINGLE_CAPTURE_NOT_ESTABLISHED`.

## The refused attempt is on the record

The first attempt returned `NO_VISIBLE_CHOICE_CONTROL` and swept nothing — the operator signalled ready before
pressing 발급, and the census read the initial surface (`choiceControlCountBucket: none`).

It is retained as `precedingRefusal` because it is the only evidence the precondition fires on a real surface.
Without the gate, that run would have produced **eight confident ABSENT verdicts for a screen nobody was looking
at** — and in the record they would have been indistinguishable from the seven real absences measured here.
That distinction is the entire reason the gate exists, and this is the run that demonstrated it.

## Verification

typecheck green. Full collector suite: **310 files / 7671 tests passed**, 18 files + 142 skipped (was 7657 —
**+14**).

**Mutation guards: 33/33 caught** — `확인` promoted to the issuing control, its effect or press claimed, the sig
promoted to a runtime anchor, purpose semantics claimed measured, a purpose option named, inferred upgraded to
measured, operator-reported upgraded to measured, an unmeasured candidate counted as measured, the absence list
padded, a fabricated candidate id, the visible count disagreeing with the shape counts, capture count inflated,
the stability caveat upgraded, `keyCreationRuledOut` softened, the refusal rewritten as a pass, the ordering
re-sequenced, and the record only shallow-frozen.

### The battery reported false survivors, twice

Five mutations first reported SURVIVED and **four were the runner's fault**: `replace(old, new, 1)` hit the first
occurrence, which for `captureCount`, `signatureStability` and `keyCreationRuledOut` lives in the sibling
`WING_STAGE2_LIVE_EVENT` record and for the candidate id lives in the interface's tuple type. The mutation never
reached the constant under test, so "SURVIVED" meant "was never applied there". After re-aiming, two more did
the same thing on the second round. A battery that reports a false survivor is as misleading as one reporting a
false catch, and this file now has three sibling records sharing a field vocabulary — any future
`indexOf`-based source slicing over it is ambiguous by construction.

### Twelve real survivors, found by review

The first battery's 20/20 was measuring less than it claimed. Independent review demonstrated twelve mutations
passing with the suite green, and the pattern is one shape: **tests that assert around a value instead of the
value.**

- `scanTruncated` / `bucketsTruncated` — the doc's headline bound claim rested on two flags **no test read**.
- `sig16`, `observedOn`, the refusal's `cause`, the inferred `hypothesis` — never asserted.
- **`precedingRefusal.recordId` was pinned only as "different from the other id"**, so `wingrec_deadbeef0000`
  passed. This is a verbatim regression of a bug already fixed in the sibling record, whose test carries a
  comment saying review caught exactly this shape once before. Now pinned by value.
- **A duplicated absent id satisfied every arithmetic check** — length 7, membership, `7 + 1 = 8` — while the
  record claimed a candidate was measured absent that was not in the list. Closed with a distinctness assertion.
- **`candidatesMeasured: 8` was tied to nothing**; a ninth candidate left the record claiming complete coverage
  of a set it did not cover. Now derived from the candidate set.
- **"A test asserts no purpose wording appears anywhere in the record" was a four-string denylist.** `업체연동`
  (unspaced) and `자체 개발` (spaced) both walked through it, as did the transcribed page sentence. Replaced with
  an exact field-set assertion plus a Hangul scan over the whole serialized record, allowlisting the single
  deliberate occurrence. That also catches an added field re-labelling the signature as the issuance anchor —
  which the doc had listed as caught while it was not.

## Not in this unit

No live run, no browser, no WING contact. No selector change or promotion, no ordering change, no census change,
no guided tutorial or stage-plan work, no deletion/NAVER/credential/connect/sync work.

## Next

`Stage-2 Purpose Label Calibration v1` — determine what the two visible radios actually are. Freeze the
operator-visible option wording as fixed candidates and measure **association and accessible name** read-only,
rather than dumping DOM or text. The whole-text hypothesis above is the first thing that instrument should be
able to distinguish.

**No radio is selected until the purpose labels are established.**
