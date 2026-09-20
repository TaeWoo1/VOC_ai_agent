# Inquiry Architecture v3 — WP-3: Resolution Planner Contract Hardening & Split-Tolerant Eval

**2026-09-20 · branch `feat/review-decision-workspace-v1` · no model call · no marketplace call · no DB write · no migration · nothing pushed**

WP-2 measured the planner for the first time (201 calls, `apr-e7d1b459`, commit `70786fe4`) and the measurement said two
things at once: **the authority decision was strong and the plan's shape was not.** WP-3 does not try to improve the
decision. It changes what a plan is allowed to look like, moves one field off the model and onto the registry, separates
seller authority from operational handoff, and replaces the scorer that could only read 43 of 67 cases cleanly.

The baseline is frozen. `wp2-shadow`'s raw observations are read here and never written; every number below is derived
from them or from a fixture in this repository.

---

## 0. What this package did not do

No planner prompt tuning for quality, no reasoning-effort change, no model change, no Jev, no resolver work, no
production shadow wiring, no PROCEDURE executor, and **no actual-model call**. The instruction did change, in one
direction and for one reason each — §2 accounts for every character.

---

## 1. The step is now one shape per capability class

### 1.1 What the shadow actually measured

| violation | count | rows (of 201) | what it is |
|---|---|---|---|
| `FIELDS_ON_NON_ENTITY` | 15 | 13 | `fields` filled on a step that reads no state — every one on `KNOWLEDGE.CATALOGUE` |
| `FIELD_OF_OTHER_CAPABILITY` | 15 | 13 | the same 15 steps, counted again under the second rule they broke |
| `SCOPE_MISMATCH` | 4 | 3 | all `SELLER → COMPANY` |
| `PROCEDURE_WITHOUT_ORDER_PRECONDITION` | 4 | 4 | a procedure that never reads the order it changes |
| `BAD_DEPENDENCY` | 1 | 1 | `depends_on` pointing at the step itself |
| **total** | **39** | **20** | |

**A correction to the WP-2 report.** That report wrote "34 contract violations". The recorded total is **39 across 20
rows**; 34 was the sum of the first three lines. The disposition below is unaffected — it is per code — but the figure
was wrong and is corrected here rather than quietly restated.

### 1.2 The change

`ResolutionPlan.Step` is a **sealed union with one record per capability class**, and a slot exists only where a choice
exists:

| shape | capability | carries | does not carry |
|---|---|---|---|
| `Knowledge` | the three `KNOWLEDGE.*` | role; `scope` **only** for `KNOWLEDGE.CATALOGUE` | fields, effect, dependency |
| `Entity` | `ENTITY.ORDER` · `ENTITY.LISTING` | role, its **own** fields (≥1) | scope (one instance each), effect, dependency |
| `Procedure` | `PROCEDURE.ORDER_ACTION` | role | everything else |
| `Seller` | `SELLER` | role | everything else |

Every constraint is a compact-constructor check, so a wrong-shaped step **cannot be constructed**, not merely cannot be
accepted. The vendor-facing JSON schema emits one closed branch per capability, generated from the same two declarations
the record and the validator read (`ResolutionPlan.SCOPES`, `EntityField.capability()`), so schema and contract cannot
drift. `ResolutionPlannerContractTest.shapePerCapability` reads the guarantee off the schema the vendor is actually sent.

**The validator lost seven codes and gained two.** Gone, because no object with that fault exists: `FIELDS_ON_NON_ENTITY`,
`ENTITY_WITHOUT_FIELDS`, `FIELD_OF_OTHER_CAPABILITY`, `SCOPE_MISMATCH`, `PROCEDURE_WITHOUT_EFFECT`,
`EFFECT_ON_NON_PROCEDURE`, `BAD_DEPENDENCY`. Added, because they are relationships *between* steps and no shape can
express them: `MULTIPLE_CLOSING_AUTHORITIES` (§4) and `PRECONDITION_AFTER_CLOSER` (§2).

### 1.3 What strict Structured Outputs guarantees, and what it does not

Strict mode honours `enum`, `additionalProperties:false` and `required`; it is documented as **ignoring** `minItems`,
`maxItems` and `maxLength`. So:

- **Structural** — a knowledge step has no `fields` property; `KNOWLEDGE.ORG` has no `scope` property to get wrong; an
  order step's `fields` enum contains only order fields.
- **Not structural, and enforced elsewhere** — "an entity step reads at least one field" (the `Entity` constructor and
  the parser), "an ask is ≤120 characters" (the parser truncates).

This is stated in the prompt's own javadoc because it is exactly the difference between a failure being *impossible* and
merely *unlikely*, and a package that claims the first while shipping the second is the kind of claim this work exists to
avoid.

### 1.4 Disposition of the 39 (ESTIMATED — see §6)

| code | disposition | evidence |
|---|---|---|
| `FIELDS_ON_NON_ENTITY` · `FIELD_OF_OTHER_CAPABILITY` | **removed by shape** | there is no `fields` slot on a knowledge step |
| `SCOPE_MISMATCH` | **removed by shape** | `SELLER` has no `scope` slot |
| `BAD_DEPENDENCY` | **removed by shape** | there is no dependency index |
| `PROCEDURE_WITHOUT_ORDER_PRECONDITION` | **survives** | a fact about two steps, not about one |

**35 of 39 violations, on 17 of 20 rows, become inexpressible. 4 survive.** Each is pinned as a fixture row in
`contracts/inquiry-planner/v2/synthetic/planner-scenarios.jsonl`, which now has three kinds of row — `P` the validator
accepts, `V` the validator refuses, **`X` the parser cannot build at all** — and every `X` records the v2 code it
replaces, so the file itself is the before/after.

---

## 2. Effect left the plan; order became the dependency

**`effect` is now registry metadata.** `CapabilityId.effect()` declares it once
(`PROCEDURE.ORDER_ACTION → EXTERNAL_STATE_CHANGE`, everything else `NONE`) and no step carries one. The measurement that
decided it: the planner wrote `BOUNDED_WORKFLOW` 38 times against `EXTERNAL_STATE_CHANGE` 4, the frozen gold says
`EXTERNAL_STATE_CHANGE` for all 7 of its procedure steps, and **nothing downstream read the difference**. The division of
labour is the one the architecture already states: the model says which capability a need requires, the registry says
what that capability does.

`BOUNDED_WORKFLOW` stays in the vocabulary with **no declaring capability**, and
`AuthorityVocabularyContractTest.effectIsTheRegistrys` pins that count at zero — the same switch pattern this repository
uses for `AI_EXTRACTED_FROM_SELLER_IMAGE`. The product-owner invariant is untouched and now rests on the capability's own
declaration plus `PROCEDURE_WITHOUT_ORDER_PRECONDITION`, not on a token the model supplies.

**`depends_on` left the wire.** In the whole frozen gold it appears exactly 7 times, on exactly the 7 procedure steps,
and every one points at the `ENTITY.ORDER` read the registry already requires — it carried no information a reader did
not have, while being the one integer a model could point at itself. Step order is the dependency, and
`PRECONDITION_AFTER_CLOSER` enforces it. **That rule caught 2 recorded needs** (`S:N8`, reps 1 and 3) where the planner
wrote the order read *after* the procedure — legal under v2, because the index was null.

### The instruction, accounted for character by character

2,501 → 2,302 characters: **201 removed, 43 added**.

| line | change | why |
|---|---|---|
| `effect=EXTERNAL_STATE_CHANGE` / `(BOUNDED_WORKFLOW)` | **removed** | the tokens no longer exist |
| `fields는 ENTITY step에만 … 빈 배열([])입니다` | **removed** | the shape enforces it |
| `그 권한의 필드만 씁니다` · `scope는 그 권한이 허용하는 값만` | **removed** | the shape enforces it |
| `depends_on은 … 예: …` (2 lines) | **replaced** | same rule, new representation: `step은 실행 순서대로 적습니다` |
| `need를 닫는 권한은 정확히 하나입니다 …` | **added** | §4's contract; the model cannot follow a rule it is not told |

**Nothing about splitting a message into needs, and nothing about customer inputs, was touched** — those are the two
behaviours §3 and §5 measure against the frozen shadow, and changing them would have destroyed the comparison.

---

## 3. Split-tolerant gold and scorer

### 3.1 Why positional alignment had to go

The WP-2 scorer compared gold need *i* with predicted need *i*. The shadow split the message differently in 27 of 67
cases — **always by splitting further, never by merging** — so its headline numbers were read off 43 cases and quietly
mis-aligned the rest.

### 3.2 The contract

The unit is a **resolution goal**: one thing the customer needs resolved. Each predicted need is assigned to **at most
one** goal; a goal may receive several. So **splitting is free and merging is not** — a planner that answers two distinct
goals with one need can have it counted for only one, and the other is reported as `MERGED_INTO_ANOTHER_GOAL`.

Assignment is an exhaustive search over a tiny space (≤6 needs × ≤3 goals) resolved by a fixed lexicographic objective:
most goals covered → most capability overlap → fewest needs left over → fewest unnecessary authorities → lexicographically
smallest. **Deterministic. No LLM judge, no embedding, no text.** Compatibility is at the **authority** level, because
that is the unit the architecture is about; a need that answers a catalogue question with the product's spec reached for
the right kind of answer and is scored as a covered goal with a named `capability_mismatch`, not as a goal gone unplanned.

### 3.3 Gold v3.2 — a re-expression, not a re-labelling

`contracts/inquiry-resolution-plan/v3.2/` · 72 goals · 67 cases · sha256 `ff20922e…`. **v3.1 stays frozen and is not
withdrawn** — it is the gold `wp2-shadow` was scored against and an evidence row still points at it.

The builder asserts that every capability, role, scope, field, customer input and expected terminal survives unchanged,
**and** that all 72 rows already satisfy the two rules WP-3 added. They did. **Zero rows needed adjudication and none was
invented.**

### 3.4 What the scorer cannot do, stated

Where one case has two goals naming the same capabilities and asking for the same inputs, no scorer that reads only a
plan can tell which predicted need answers which. In v3.2 that is **4 goals in 2 cases** (`R:77a91fab` n1/n2 ·
`R:f403e606` n1/n2). Coverage across them is a claim about **count**, not identity, and `scoreGoals` reports
`goals_indistinguishable` on every run so the figure is never read as more than it is.

**One product-owner question follows from this, and is not resolved here** (§10).

---

## 4. Seller authority vs operational handoff

**SELLER is an authority: a new seller judgment determines the answer.** It is not the name for running out of knowledge,
running out of capability, low model confidence, or handing the case over — those are **resolution outcomes**
(`NEEDS_SELLER`, `CAPABILITY_GAP`) the runtime records after the plan has run.

The separation is structural and is **not** a ban on any pair of capabilities:

> **Exactly one *authority* closes a need.**

Two steps of the **same** authority may both close — the frozen gold does this in 4 of 72 goals, where a listing's
options and the product's spec answer one question together. Two **different** authorities closing means the plan states
two endings and lets the runtime pick, which is the `4181864b` shape with a different pair. And the legitimate
multi-authority plan remains expressible, because it has one closer: `KNOWLEDGE.ORG` **PRECONDITION** → `SELLER`
**CLOSES**.

### The recorded seller closers, replayed

**A correction to the WP-2 report.** It said "SELLER planned as a step beside KNOWLEDGE 8/43" — that was rep 1, matched
needs only. Across all 201 rows there are **49 occurrences on 31 distinct (case, need) pairs**.

**Every one of the 31 has `SELLER` with role `CLOSES` beside another `CLOSES` step.** Not one is the legitimate shape.
Classified under the new contract:

| class | count | example |
|---|---|---|
| **invalid fallback** — the other closer is an authority that already ends the goal | **31 / 31** | `S:T4a` `KNOWLEDGE.PRODUCT CLOSES + SELLER CLOSES`, gold `KNOWLEDGE.PRODUCT CLOSES` |
| **legitimate seller judgment** — policy read first, seller decides | **0 / 31** | none produced |

The rule also catches **12 multi-closer needs that contain no SELLER at all**: `ENTITY_STATE + KNOWLEDGE` ×6 — *the
`4181864b` confusion inside a single need* — `KNOWLEDGE + PROCEDURE` ×5, `ENTITY_STATE + PROCEDURE` ×1. That is the
argument for writing the rule about endings rather than about the word SELLER: the same defect arrives without it.

The gold's own 3 SELLER goals are all sole closers and all still validate.

---

## 5. Customer-input quality

The prompt was **not** changed here. Four questions, deliberately never averaged into one score:

| rep | exact | over-asks | under-asks | required recall | unnecessary inputs | **forbidden (identity)** |
|---|---|---|---|---|---|---|
| 1 | 28 / 72 | 44 | 4 | 1 / 5 | 98 | **0** |
| 2 | 34 / 72 | 38 | 3 | 2 / 5 | 87 | **0** |
| 3 | 29 / 72 | 43 | 3 | 2 / 5 | 93 | **0** |

Over-asking by type (rep 1): `USE_CONTEXT` 23 · `MODEL` 21 · `MEASUREMENT` 19 · `SIZE` 16 · `QUANTITY` 15 · `OPTION` 4.

**A correction to the WP-2 report.** It reported "over-asking 36 vs **0** under-asking". Under goal alignment the planner
**does** under-ask: 3–4 goals per rep, and of the 5 (goal, input) pairs the gold actually requires it recalls only
**1–2**. The old figure was per-need exactness under positional alignment. The planner is not "always safe, just
talkative" — it asks for a great deal and still misses most of what the answer genuinely depends on.

**The identity prohibition held on all 201 calls**: 0 forbidden inputs. It is counted apart from quality and always will
be — asking a customer for an order number on public Q&A is a safety failure, not a precision one.

### Entity fields have the same habit, and it is worse

The gold's entity steps ask for what the question needs; the planner reads widely — `ORDER_FULFILLMENT + ORDER_TRACKING +
ORDER_PAYMENT + ORDER_CANCELLATION` where the gold asks for fulfilment alone.

| rep | exact | over-read | under-read | of |
|---|---|---|---|---|
| 1 | 6 | 8 | 0 | 14 |
| 2 | 2 | 12 | 1 | 14 |
| 3 | 3 | 10 | 1 | 14 |

`ORDER_TRACKING` was added where the gold did not ask **42 times**, and it is `NOT_SUPPORTED` on every channel — so an
over-read can turn a readable question into a recorded `CAPABILITY_GAP`.

**The mechanism is real; the harm is not observed in this set.** Of the 12 steps where the over-read did produce
`NOT_SUPPORTED`, all fall in 3 cases (`R:7a8136b2`, `R:83e607e0`, `R:9b8cc5a5`) whose gold terminal is **already** a
capability gap for another reason. **Zero resolvable goals were flipped to a gap here.** Recorded as a mechanism to watch,
not as a defect observed.

---

## 6. Offline replay of `70786fe4`

`eval-store:runs/wp3-offline/replay-wp2-shadow.json`, derived from `wp2-shadow.jsonl` (sha256 `deb65abd…`). **Model calls
0 · marketplace 0 · DB writes 0.** `wp2-shadow` re-verified intact afterwards.

Every block is labelled:

- **`MEASURED_SCORER_CHANGE`** — the model's own plans, compared differently. As real as the shadow's own numbers.
- **`ESTIMATED`** — the plans **projected** into the WP-3 shapes (`contract.mjs project`: drop `effect`, drop
  `depends_on`, drop `fields` from non-entity steps, drop the scope slot where the capability has one instance). The
  projection is deterministic, but the model was never asked under the new schema. **An estimate here is a claim about
  the shape, never about what a planner given that shape would write.** It can never invent a step the model did not.

### Contract (ESTIMATED)

| | rows invalid | violations |
|---|---|---|
| v2 contract, as recorded | **20 / 201** | 39 |
| WP-3 shapes, projected | **57 / 201** | 67 |

- **Removed by shape:** 30 rows' worth — `FIELDS_ON_NON_ENTITY` 13, `FIELD_OF_OTHER_CAPABILITY` 13, `SCOPE_MISMATCH` 3,
  `BAD_DEPENDENCY` 1.
- **Survived:** `PROCEDURE_WITHOUT_ORDER_PRECONDITION` 4.
- **Introduced by the new rules:** `MULTIPLE_CLOSING_AUTHORITIES` on **61 needs across 54 rows**,
  `PRECONDITION_AFTER_CLOSER` 2.

**Read that honestly: the shape change removes what it was built to remove, and the new closing rule refuses 54 rows the
old contract accepted.** That is not a regression — it is a rule the model was never told, catching a behaviour §4 says
is wrong. It is also the single strongest reason the next step must be an actual-model run: nothing offline can say
whether a planner told the rule will follow it.

### Positional vs split-tolerant (MEASURED)

| | rep 1 | rep 2 | rep 3 |
|---|---|---|---|
| positional authority recall | 0.958 | 0.972 | 0.931 |
| positional ORDER misses | 2 | 2 | 1 |
| positional procedure-for-read | 0 | 0 | 0 |
| **goal coverage** | **72/72** | **72/72** | **72/72** |
| **required-authority recall** | **1.000** | **1.000** | **1.000** |
| uncovered goals · lost to a merge | 0 · 0 | 0 · 0 | 0 · 0 |
| capability mismatch (right authority, wrong capability) | 9 | 9 | 10 |
| **ORDER misses** | **0** | **0** | **0** |
| **procedure-for-read** | **3** | **2** | **2** |
| goals with an authority the gold never asked for | 22 | 20 | 22 |
| goals served by more than one need | 26 | 24 | 25 |
| needs serving no goal at all | 7 | 7 | 7 |

Three things in that table matter.

1. **The ORDER misses were alignment artifacts.** WP-2 said so as a caveat; the new scorer shows it as a number: 2/2/1 →
   0/0/0. Every goal that required the order got it.
2. **`procedure_for_read` was not 0.** The WP-2 "0/201" was an artifact of comparing only matched needs. `R:4181864b.n1`
   fails it in **all three repetitions**: the gold is one goal closed by `ENTITY.ORDER`, and the planner split it into as
   many as four needs — one of which is a `KNOWLEDGE.ORG CLOSES`, *the `4181864b` failure itself*, and another a
   procedure. **Over-splitting is not harmless: it re-creates the authority confusion this architecture exists to stop.**
   The deterministic fence still blocks it downstream (WP-1), but the planner should not be producing it.
3. **Coverage 1.000 with 0 merges** is a stronger and more honest result than the positional 0.93–0.97, and it is
   stricter, not more generous: it counts every goal in all 67 cases rather than the 43 that aligned.

---

## 7. Eval artifact safety

`wp2-shadow` is untouched and re-verified (`run-verify wp2-shadow → ok`). The derivation lives in a **new** append-only
run, `wp3-offline`, with a `SOURCE.md` naming its input hash, the two kinds of claim, and the command to reproduce it.
Gold v3.2 is a new frozen dataset beside v3.1; v3.1 is **not** withdrawn, because an evidence row still points at it.
No real customer or seller text entered the repository — the repo holds the 8-row synthetic subset, the manifest, hashes
and the schema.

---

## 8. Tests

**Backend: 3,900+ · failures 0.** Tools: `goals.test.mjs` 21 · `mutations.test.mjs` 12 · `plan.test.mjs` 8 ·
`eval.test.mjs` 9 · `judge.test.mjs` 12 · `store.test.mjs` 9 — **failures 0**.

Covering, by name: a capability class cannot express a field it has no use for (schema **and** record); an entity step
requires its own fields; procedure dependency validation; procedure-for-read; seller authority vs operational handoff;
a legitimate `KNOWLEDGE → SELLER` plan is accepted; an unnecessary seller closer is refused; many-to-one scoring; the
merge false positive is prevented; customer-input over/under/exact/forbidden; and the public-Q&A identity prohibition.

**Mutation testing: 12 mutations, 12 caught, 0 survivors.** Each breaks one rule at source level, loads the broken
module and asserts a named property stops holding — including "the closing-authority rule allows two endings", "a
retired slot is quietly accepted", "any need may serve any goal", "an entity step read too widely counts as correct" and
"goals this scorer cannot tell apart stop being counted".

**The JS contract mirror is pinned to the Java**, not trusted: `goals.test.mjs` reads the very fixture file the Java
scenario tests read and requires the same verdict on all 30 rows, including which 8 cannot be parsed at all.

### Contracts and tests rewritten, stated

- `contracts/inquiry-planner/v1/…` → **v2**, restructured around the three row kinds. v1 is left in place.
- `ResolutionPlanValidatorScenarioTest` — 14 valid / 8 refused / **8 inexpressible** (was 12 / 9).
- `ResolutionPlannerContractTest` — the universal-step assertions became per-branch assertions **about absence**; two
  tests added (`shapePerCapability`, `shapeInTheRecord`). **No safety assertion was weakened; the payload-floor test is
  unchanged and `user()` is byte-identical.**
- `plan.mjs` kept as the WP-2 baseline, edited in exactly one place (`step_effects` → `execution_effects`).

---

## 9. Why the next experiment must call the model

Everything above is a contract and a scorer. Three questions are now **unanswerable offline**:

1. **Does the vendor accept the `anyOf` branch schema in strict mode at all?** Seven branches, single-value discriminator
   enums, per-branch `required`. This repository cannot verify it without a call, and if it is refused the whole shape is
   moot.
2. **Does the planner, freed of the slots, still choose the same authorities?** Authority recall was 1.000 under a schema
   that also asked for five other things. That it survives a different schema is an assumption.
3. **Told that exactly one authority closes a need, does it stop bolting the seller on?** 54 rows currently fail that
   rule and none of them was told about it.

---

## 10. Open, for the product owner

1. **`R:77a91fab` n1/n2 and `R:f403e606` n1/n2** — each pair names the same capabilities and asks for the same inputs.
   Are they genuinely two goals, or one goal the gold split? If one, the gold merges and the scorer's blind spot
   disappears; if two, it stays and is reported every run. **I have not guessed, and nothing is frozen either way.**
2. **Over-asking** now has a metric and a distribution (§5). Whether to spend a prompt change on it is the next
   package's decision, not this one's.
3. The WP-1 open parameters (listing freshness bound, "unknown surface = public", identity askable nowhere in v3.0) are
   still open.

---

## 11. Smallest smoke manifest for the next actual-model run

**Not approved and not run.** The smallest thing that answers §9.1 and §9.2:

| field | value |
|---|---|
| purpose | does the vendor accept the per-capability `anyOf` schema, and does the planner still choose the same authorities |
| calls | **3** — `P01` (entity read), `P03` (procedure + order precondition), `P07` (knowledge + customer input) from `contracts/inquiry-planner/v2/synthetic/planner-scenarios.jsonl` (`smoke: true`) |
| prompt | `resolution-planner/v3` |
| model | `gpt-5-2025-08-07` @ `minimal` — unchanged |
| inputs | synthetic fixtures only; **no customer text** |
| marketplace calls | 0 |
| DB writes | 0 |
| production Cases touched | 0 |
| output | append-only `eval-store:runs/wp3-smoke/`, raw answers stored **before** scoring |
| pre-registered bar | 3/3 parse, 3/3 contract-valid, 3/3 authority sets equal to the fixture's plan |
| on failure | report and stop; do not run anything larger |

The 67×3 shadow under `resolution-planner/v3` is the run that would answer §9.3, and it is not requested until this
smoke passes.
