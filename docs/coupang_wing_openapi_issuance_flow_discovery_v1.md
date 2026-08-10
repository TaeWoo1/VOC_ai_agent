# Coupang WING OPEN-API Issuance Flow Discovery v1 — evidence landing

> **Status:** offline **in this commit**. The evidence below comes from three granted live runs; nothing here
> opens a browser. No selector promoted, no tutorial changed yet, **no key created, and the key-creating control
> has never been pressed.**

## The runs

| | run / approval | git | record | what it added |
|---|---|---|---|---|
| 1 | `wt-7ecf33125088` / `apr-5ad6d4a1216b` | `f9189d89` | `wingrec_fd5caf3ca4ae` | the two purpose options IDENTIFIED |
| 2 | `wt-4bfd9f532ab1` / `apr-91e4ab7eb849` | `82b3e0f7`* | `wingrec_567b2fdb26c5` | 확인 opens a TERMS screen, not the vendor form |
| 3 | `wt-4bfd9f532ab1` / `apr-778d…` | `82b3e0f7` | `wingrec_781f8ebd996d` | the terms screen measured |
| 4 | `wt-e21e586da7d4` / `apr-…` | `769def89` | `wingrec_30ca56ad3443` | the checkbox↔consent pairing; **the gate stopped this run** |

\* run 2 was granted on `38e3a0c7`; run 3 on `82b3e0f7`. Agent selections across all four: **0**. Faults: **0**.

## The flow, as measured

```
발급 (operator)  →  PURPOSE screen        radio 0 = OPEN API · radio 1 = 플레이오토 웹 솔루션
   ?             →  TERMS screen          2 checkboxes · 취소 · 약관 동의 및 Key 발급받기
                     ↑ the run stops here
```

**WHAT CAUSES THE PURPOSE → TERMS TRANSITION IS NOT ESTABLISHED, and this document said it was.** It read
`확인 (operator) → TERMS`. Run 2 supports that — its checkpoint 2 was still the purpose screen and checkpoint 3,
after the operator pressed 확인, was the terms screen. But runs 3 and 4 both arrived at the terms screen at
checkpoint 2, *before* the 확인 step, and on run 4 the operator states they pressed nothing at all: `OPEN API`
was already the default, so they did not click the radio either. Run 3's operator action at that step is not
recoverable.

So the transition has at least two live readings the "확인 does it" account does not explain, and the honest
status is **UNMEASURED**. A dedicated minimal run settles it: reach the purpose screen, touch nothing, press
only 확인, and read whether the screen changes.

**The product owner's account of this flow was wrong twice**, and both corrections are measured:

- the options are not 자체개발 / 직접입력 — see below;
- 확인 does not submit 업체명 · URL · IP 주소 — whatever else it does. **That form never appears.** Its three labels read
  `PRESENT_HIDDEN_ONLY` at every one of the seven checkpoint readings taken across runs 2 and 3, with identical
  quads. It exists in the DOM and is not part of this flow.

Nothing on the earlier records is rewritten. They said what they measured; the flow description was the thing
that was wrong.

## MEASURED — the purpose screen

`OPEN API` is radio 0 and `플레이오토 웹 솔루션` is radio 1, by exact **and** containment match, at indices 4
and 5, both `LABEL_FOR` with one `label[for]` each, one shared `name` group. **The reading was predicted
field-for-field before the grant was spent** — a test built a fake Stage-2 from the operator's transcription and
ran the real generated script against the real shipped list. Run 1 returned exactly that.

`OPEN API` is also the **default selection** — OPERATOR_REPORTED, not measured: the instruments never read
`checked`, deliberately. The measured shadow of it is that run 2's checkpoints 1 and 2 are byte-identical.

The verbatim heading `키의 사용 목적을 골라주세요` resolves UNIQUE; the 08-09 report of it
(`이제 키의 사용 목적을 골라주세요.`) stays `ABSENT_EVERYWHERE`. The difference is exactly a leading `이제 ` and
a trailing period, which is why both are kept.

## MEASURED — the terms screen

| candidate | painting | non-painting | verdict |
|---|---|---|---|
| `약관 동의 및 Key 발급받기` under `button,a` | **1** | 0 | **UNIQUE** · sig `223db3783fae8ce4` |
| `약관 동의 및 Key 발급받기` under the heading query | **1** | 0 | UNIQUE · sig `9cd0eaf0d2df9781` |
| `취소` | 1 | 8 | unique among painting · sig `29427e60f5f21c90` |
| `API 이용 약관에 동의합니다.` | **2** | 2 | not unique |
| `카테고리 자동 매칭 서비스 이용에 동의합니다.` | **2** | 3 | not unique |

**The heading and the key-creating button carry the identical string**, and the element query is what separates
them: one painting match in each family. Text alone could not have named the control that creates a key.

`취소`'s signature **differs between the purpose and terms screens** (`5988c4d8…` → `29427e60…`) — two different
cancel elements. A single shipped locator would have conflated them.

**Both checkboxes have no accessible name at all**: `nameSource: NONE`, `labelForCount: 0`,
`ancestorLabelCount: 0`, `ariaLabelledbyRefCount: 0`, no shared `name` group. The consent sentences are on the
page and painting, but they are not associated with the inputs by any mechanism the accname subset follows, and
neither sentence is unique.

**Run 4 established the pairing STRUCTURALLY instead** — the reason the consent-block instrument exists:

```
checkbox 0 → consent 0 (API 이용 약관)         depth 1 · 1 visible checkbox in that block
checkbox 1 → consent 1 (카테고리 자동 매칭)     depth 1 · 1 visible checkbox in that block
consentsMatchedExactlyOnce: 2 / 2
```

Both rows `NEAREST_BLOCK_HOLDS_EXACTLY_ONE_CONSENT`, at the **immediate parent**, and that parent holds exactly
one visible checkbox. Each box sits in its own block with its own sentence, so this is a measured 1:1 map and
not an inference from document order — which is precisely what the instrument's two refusal verdicts exist to
prevent it from becoming.

**It is a structural pairing, not an accessible association.** The boxes still have no accessible name. A
tutorial may name each block; it may not claim the label is wired to the input, and
`WING_TERMS_CHECKBOX_PROMOTION_BLOCKED` still stands for that stronger claim.

**The signatures are not stable across sessions.** Run 4 read the issue button as `777499e0668e9fe8` where run 3
read `223db3783fae8ce4`; the heading and 취소 differ too. Same page, different session — so `sig16` is evidence
that two readings within one session saw the same element, and is not element identity. Nothing may key on it.

## The defect this unit produced, and what it cost

**Run 3's gate cleared the operator to press 확인 while the browser was already on the terms screen.** Run 4 met
the identical situation with the fix in place and **halted** — `STOP_ALREADY_PAST_THE_PURPOSE_SCREEN`, with the
instruction never printed. The two runs are the before and after of the same defect.

`wingConfirmAdvisory` asked one question — are 업체명 / URL / IP visible? — and those labels are hidden on *every*
screen in this flow. So it answered ADVANCE regardless of where the flow was. Run 3's checkpoints 2, 3 and 4 are
identical in every field, which is how it is visible after the fact: the screen had already advanced before
checkpoint 2's reading, and the instruction to press 확인 went out against a screen whose visible control was
`약관 동의 및 Key 발급받기`.

Nothing was pressed, because 확인 was no longer there to press. **That is luck, not design.**

It is this workstream's recurring defect for the ninth time — a guard reasoning about what is on a screen
without first establishing *which* screen. The fix inverts the order: `wingFlowScreenFrom` identifies the screen
first, `TERMS` wins an ambiguous reading because it is the screen where stopping is right, and a missing marker
reads `NOT_MEASURED` rather than resolving by default. Generalised past 확인:
`WING_CHECKPOINT_EXPECTED_SCREEN` gives every checkpoint the screen its copy assumes, and a mismatch halts
**before the instruction is printed**.

Each reading now also carries its own measured `screen`, so a 확인 that silently did nothing shows up as
`PURPOSE` instead of being narrated as `TERMS` by the checkpoint's name — the thing that hid this for a whole run.

**Two smaller ones, both found by running the harness rather than reading it.** The bootstrap printed the shared
Stage-2 note ("choose nothing, and never press 확인") under a discovery banner, contradicting the manifest the
next command prints. And the manifest said "3 read-only checkpoint readings" while the code had four — the
undescribed fourth being the one standing in front of the key-creating button. Both counts are now interpolated
from the constant, and a literal fails a guard.

## The key-creation boundary

`약관 동의 및 Key 발급받기` is named once in the leaf as `WING_KEY_CREATION_CONTROL_ID`. It is **located and never
pressed**. `TERMS_CHECKED_BY_OPERATOR` is the last checkpoint, `WING_FLOW_LAST_CHECKPOINT` says so as a checked
constant, and the runner **throws** on a fifth rather than halting — a caller who adds one made a code mistake,
and a code mistake must not be reported as a cautious measurement. Discovery cannot reach key issuance by
adding a step; issuance is a separate phase, manifest and grant.

**SellerOps does not read, evaluate, agree to, or advise on the terms.** Two consents, kept as two candidates,
never bundled. Nothing reads `checked`.

## Provenance, kept in three classes

| class | content |
|---|---|
| **MEASURED** | every count, quad, presence verdict, association row, signature and screen identity above |
| **OPERATOR_REPORTED** | the five terms strings and the two option strings, transcribed verbatim; that `OPEN API` is the default selection; that each screen was open and untouched when ready was signalled |
| **INFERRED** | that `OPEN API` is the flow description's self-developed path — **not acted on**; nothing selects or defaults to either option |

## Verification

typecheck green. Full collector suite: **313 files / 7837 tests passed**, 18 files + 142 skipped. Live-harness
selfcheck: **75 PASS** on a clean tree.

## Next

1. **TERMS recon** — the consent-block instrument, live and READ_ONLY, to establish the checkbox↔consent
   pairing or record that it cannot be established. Fresh manifest, fresh grant. If the pairing is ambiguous,
   nothing is promoted.
2. **Guided tutorial redesign**, once that evidence is in — in one pass, on this branch.
3. **Key issuance** stays a separate, explicitly approved step. It is not reachable from discovery.
