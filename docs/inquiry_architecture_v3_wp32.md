# Inquiry Architecture v3 — WP-3.2: Planner Boundary & Scope Hardening

> **Status: three residuals given owners · one new invariant (audited first) · scope is now a first-class metric ·
> the vendor request CHANGED, so a new 8-call smoke is required before 67×1.**
> **Model calls 0.** Marketplace 0 · DB writes 0 · migrations 0 · production Cases 0. 67×1 not run.
> Planner still **NOT frozen**.

Predecessor: [WP-3.1](inquiry_architecture_v3_wp31.md), whose Candidate C smoke passed 8/8 on closing authority and
left three residuals. This package does not try to fix all three. It decides **who owns each**, and only then changes
anything.

| | residual | owner | done here |
|---|---|---|---|
| **A** | `C6` planned the execution that *might follow* a judgment | **planner instruction** + a measurement. **Not structurally preventable** (§1.3) | boundary sentence, and `procedure_for_read` pinned as the metric |
| **B** | `C3`/`C7` right capability, wrong instance | **scorer** — it could not see this | scope/instance is now first-class, in the gate |
| **C** | `C4` one extra field turned a readable order into a gap | **Entity Resolver (WP-4)**, not the planner | priced three designs, changed nothing |

---

## 1. The PROCEDURE boundary — audited before it was written

### 1.1 The audit

All 72 frozen gold goals, read offline. No meaning was changed and nothing was inferred.

| | |
|---|---|
| goals containing a `PROCEDURE.ORDER_ACTION` step | **7** |
| of those, resolved by PROCEDURE | **7** |
| **PROCEDURE step present, another authority resolves** | **0 — no counterexample** |
| resolved by PROCEDURE with no procedure step | **0** |

The 7:

| goal | v2_type | steps |
|---|---|---|
| `R:0c582144` | SELLER_DECISION | ENTITY.ORDER · PROCEDURE · KNOWLEDGE.ORG |
| `R:83e607e0` | ORDER_ACTION | ENTITY.ORDER · PROCEDURE |
| `R:9b8cc5a5` | SELLER_DECISION | ENTITY.ORDER · PROCEDURE · KNOWLEDGE.ORG |
| `R:515dd536` | SELLER_DECISION | ENTITY.ORDER · PROCEDURE · KNOWLEDGE.ORG |
| `S:T10b` | SELLER_DECISION | ENTITY.ORDER · PROCEDURE · KNOWLEDGE.ORG |
| `S:T11a` | ORDER_ACTION | ENTITY.ORDER · PROCEDURE · KNOWLEDGE.ORG |
| `S:T12a` | ORDER_ACTION | ENTITY.ORDER · PROCEDURE |

Worth noting because it argues against a domain rule: **4 of the 7 are labelled `SELLER_DECISION` and 1 of the 4
`ORDER_ACTION` goals is resolved by ENTITY_STATE.** The v2 topic label does not decide the authority — reading an
order can resolve an "action" question, and a "decision" question can require an action. Any rule keyed on the
category would have got those wrong. This one is keyed on the plan's own shape.

### 1.2 The invariant

```
closing_authority != PROCEDURE  AND  a PROCEDURE step exists   →   PROCEDURE_NOT_CLOSING
```

Added to the validator and the offline mirror. It is not a new opinion: it is a property the gold already has,
made checkable. What it forbids is a procedure carried as somebody else's optional follow-up — *"the policy says no,
and then we would cancel it"*. **An external state change is not a footnote to an answer**: either performing it is
what the customer is asking for, in which case it resolves the need, or it is something that might happen afterwards,
in which case it is not this plan's business.

How often it would have fired, measured rather than guessed:

| run | needs | with a PROCEDURE step | would violate |
|---|---|---|---|
| WP-2 (201 calls, two endings still writable) | 361 | 42 | **8** |
| WP-4 (67 calls) | 111 | 7 | 0 |
| Candidate C smoke (8 calls) | 9 | 2 | 0 |

The exactly-one-closer contract had already removed most of this shape. The rule closes the remainder.

### 1.3 It does **not** fix `C6`, and that is the finding

`C6` asked whether an exception could be approved. The model wrote two needs:

```
N1  closing SELLER      KNOWLEDGE.ORG > ENTITY.ORDER > SELLER      ← satisfies the invariant
N2  closing PROCEDURE   ENTITY.ORDER > KNOWLEDGE.ORG > PROCEDURE   ← satisfies the invariant
```

**Every need is legal on its own.** The over-reach is between needs, and no per-need rule can see it. A test asserts
exactly this: each half of `C6` validates clean, and only the scorer reports anything.

Could a plan-level rule catch it? Only one of the form *"a plan with a SELLER-resolved need may not also have a
PROCEDURE-resolved need"* — and that forbids a customer asking two real things at once ("can you make an exception,
and if not how do I send it back?"). **That is a legitimate plan, so the rule would be wrong.** The honest position:

- **structural** — the invariant, for a procedure inside the need;
- **instruction** — §2, for the reach past the request;
- **measurement** — `procedure_for_read` and `unnecessary_authority_goals`, which is how the 67-run will report it.

No rule is invented that the gold does not support. This is recorded as a **known limit of the contract**, not a fix.

## 2. The instruction boundary

Added to `resolution-planner/v5`, domain-neutral, no worked example:

> 외부 상태를 **바꾸는 일 자체가 고객이 지금 요청한 결과일 때만** PROCEDURE를 쓴다. …
> **지금 요청한 것을 해결하는 데 필요한 것만 계획한다.** 안내나 판단 뒤에 이어질 수 있는 실행은 지금의 요청이
> 아니므로 step으로도 need로도 만들지 않는다.

A test asserts no category is named — naming one would teach the category instead of the boundary.

**Fingerprints before and after, derived offline with 0 model calls:**

| | v4 | v5 | |
|---|---|---|---|
| `system_fp` | `7eca18df…` | `b9c1c024…` | **changed** |
| `schema_fp` | `efc402fd…` | `efc402fd…` | **unchanged** — no new field |
| `input_fp` | | | **8/8 identical** — the payload floor did not move |
| `request_fp` | | | **0/8 identical** — the request changed |

**So §8 is answered: a new smoke is required.** The previous 8-call result was bought against different bytes.

## 3. Scope and instance — a first-class metric

The capability comparison answers *"did the plan reach for the right kind of answer"*. It does not answer *"about
which instance"*, and the Candidate C smoke showed the cost: `C3` and `C7` both chose
`KNOWLEDGE.CATALOGUE/THIS_LISTING` where the gold says `SELLER_CATALOGUE` — the seller's whole range asked of one
listing. **`capability_mismatch` reported 0, correctly and uselessly.**

Every required step is now compared as capability **and** instance:

| | Candidate C smoke |
|---|---|
| `capability_accuracy` | **11/11 = 1.000** |
| `scope_accuracy` | **0/2 = 0.000** — `C3.n1`, `C7.n1`, both `SELLER_CATALOGUE` → `THIS_LISTING` |
| `capability_extra` | 6 |
| `unavailable_but_correct` | 2 — `C8`, planned exactly right on a capability that cannot act here |

`scope_decidable` is the **honest denominator**: only a capability about more than one kind of instance can have its
scope got wrong, and in this vocabulary that is `KNOWLEDGE.CATALOGUE` alone. A scope rate quoted over every step would
be mostly made of steps that had no choice to make, and would read far better than the truth.

`C7` (range) and `C13` (this listing) are both fixtures, so a scorer that simply preferred one value cannot pass both.

## 4. Over-read — ownership, and nothing changed

`gapOf` is untouched. What this section decides is **whose problem it is**.

| | Planner | Entity Resolver |
|---|---|---|
| which authority / entity state the need requires | **yes** | no |
| which state dimensions are relevant | **yes** | no |
| what this deployment can actually read | no | **yes** |
| the minimum sufficient state for the goal | no | **yes** |
| may an unsupported extra field discard an answerable goal | — | **no** |

Three designs, priced on every recorded run:

| | A: planner fields are exact requirements *(today)* | B: planner fields are candidates, resolver checks the need's minimum | C: planner names the capability only, resolver decides fields |
|---|---|---|---|
| WP-4 67-case, goals blocked | 14 | 14 | 14 |
| WP-3 smoke, blocked | 2 | **1** | **1** |
| Candidate C smoke, blocked | 4 | **3** | **3** |
| resolvable→gap false negatives | **P01, C4** | 0 | 0 |
| risk of calling a truly missing field resolved | none | none | none |
| contract complexity | — | same wire, different reading | **simpler wire** (no `fields`), but the planner loses the ability to say a need is about *tracking* rather than *fulfilment* |

**B and C produce identical availability outcomes.** They differ only in what the planner may still say. B keeps the
planner's field list as a statement of relevance and lets the resolver decide sufficiency; C removes the list.
**Recommendation: B** — the relevance signal is real (the gold distinguishes `ORDER_FULFILLMENT` from
`ORDER_TRACKING` goals) and it costs nothing to keep once it stops binding the resolver.

**The measured harm, across everything ever run:** 2 of 2 comparable entity steps over-read harmfully — `P01` under
v3, `C4` under v4 — and each flipped one goal from resolvable to a gap. The 67-case corpus scores 0 because only
**2 of 67** cases have an order that can be read at all.

**Field-level availability stays rejected**, and the counterexample stays a regression: on `R:7a8136b2` a spare
*readable* field hides a genuinely *unavailable* required one, and the goal is reported answerable when it is not. On
the 67-case run field-level shows 12 blocked against need-minimum's 14 — and those two extra "resolvable" goals are
the wrong ones.

**This is input to the WP-4 Entity Resolver design. No runtime semantics changed here.**

## 5. Customer input — recorded, untouched

`required input recall` · `over-ask` · `exact` · `forbidden` kept as they are. No prompt tuning. The Candidate C smoke
added one data point worth keeping with its denominator: 6 unnecessary inputs across 8 cases, **0 forbidden**, and
`C6` alone asked for five the gold does not want.

## 6. The freeze gate, updated

**Safety — all must be 0:**

1. wrong closing authority
2. ORDER required-authority miss
3. `procedure_for_read` / a procedure on a goal whose answer is not an action
4. forbidden identity input
5. capability gap answered by substituting SELLER

**Coverage:**

6. unresolved required resolution goal = 0, or an adjudicated annotation defect
7. required capability presence, reported
8. **correct closer rate ≥ 0.875** (the WP-4 measured figure)

**Scope — new:**

9. **wrong scope / entity binding = 0 on the critical scenarios**
10. aggregate scope accuracy reported separately, with `scope_decidable` as its denominator

**Contract:**

11. parse / envelope / contract violations = 0 target

**Diagnostics only — never a headline, never a gate:** over-splitting · over-asking · entity field over-read ·
**exact need count**.

## 7. Regression fixtures

`contracts/inquiry-planner/v3/synthetic/planner-scenarios.jsonl` — 45 rows (26 valid · 6 refused · 13 inexpressible).

| | |
|---|---|
| `C12` **new** | a judgment need that also plans the execution which might follow → **`PROCEDURE_NOT_CLOSING`** |
| `C13` **new** | knowledge about **this listing's** options — the other direction of the scope choice from `C7` |
| `C5` | explicit action → PROCEDURE resolves, order read required |
| `C6` | seller judgment; the over-split is a scorer test, since both halves are legal |
| `C1` / `C2` | pure product knowledge · company policy |
| `C7` | seller-catalogue-wide knowledge |
| `C8` / `C9` | unavailable capability keeps its authority · the substitution that must not pass |
| `C10` | the `C4`/`P01` over-read false gap |
| `R:7a8136b2` | a spare readable field hiding a real missing requirement (in `wp31.test.mjs`) |

## 8. Tests

**backend 4,504 / 0 · tools 105 / 0 · mutations 22 / 22 caught.**

The backend count is unchanged from WP-3.1: this package added fixtures and assertions, not new JUnit methods — the
scenario tests loop over the fixture file, so growing it raises the assertions inside a test rather than the test
count. The fixture counts it now pins are 26 valid · 6 refused · 13 inexpressible.

New mutations: a procedure may be a follow-up again · the wrong instance stops being distinguished · scope is scored
over steps that never had a choice. New scorer tests: right capability wrong instance is its own verdict; the same
fixture against the gold it *does* answer scores clean; a capability that cannot act here but was planned exactly
right is counted as such; and the `C6` split — **each half validates clean, and only the measurement sees it**.

One assertion was rewritten (the instruction test, for the new sentence and `v5`); no safety assertion was weakened.

## 9. The next smoke — 8 calls, proposed, **not run**

The request bytes changed (§2), so the previous smoke does not carry over. **No approval is held.**

| | |
|---|---|
| calls | **8**, hard cap 8 |
| cases | `C1` pure knowledge · `C3` two knowledge capabilities · `C4` entity state · `C5` entity → procedure · **`C6` seller judgment with a possible later action** · `C7` seller-catalogue scope · `C13` this-listing scope · `C8` unavailable capability |
| inputs | synthetic only, regenerated from the committed fixture |
| model | `gpt-5-2025-08-07` @ `minimal`, strict `json_schema` — unchanged |
| prompt | `resolution-planner/v5` · `system_fp b9c1c024…` · `schema_fp efc402fd…` (unchanged from v4) |
| marketplace · DB · external · Cases · judge · draft · retrieval · migrations | **0** |
| output | new append-only run id; raw stored before scoring |

`C2` leaves the smoke set so `C13` can enter it and both scope directions are bought; `C2`'s shape stays a fixture.

**Bar:**

1. 8/8 answered · envelope 0 · parse 0 · contract violations 0
2. correct `closing_authority` 8/8
3. **`C6`: SELLER resolves it and no PROCEDURE appears anywhere in the plan — `procedure_for_read` = 0.** The residual this package exists for
4. `C5`: PROCEDURE resolves it and the order is read
5. **`C7` → `SELLER_CATALOGUE` and `C13` → `THIS_LISTING`: scope accuracy 2/2**
6. `C8`: keeps KNOWLEDGE, records the gap, seller substitution 0
7. `C3`: KNOWLEDGE naming both knowledge capabilities
8. forbidden identity input 0

**If it fails:** the 67 cases are not run; classify as schema/contract vs closing semantics vs boundary vs scope; no
automatic prompt tweak, no retry.
**If it passes:** propose 67 × 1 as a separate manifest. **Not 67 × 3.**

**The planner is not frozen and WP-4 E2E is not proposed.**
