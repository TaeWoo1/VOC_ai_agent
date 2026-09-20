# Inquiry Architecture v3 — WP-3.1: Closing Authority Semantics & Replay Diagnostics

> **Status: diagnosis complete · Candidate C BUILT and offline-validated · no model has seen it · planner still NOT
> frozen.**
> **Model calls 0.** Marketplace 0 · DB writes 0 · migrations 0 · production Cases 0 · external writes 0.
> Everything below comes from the raw answers WP-2 and WP-4 already bought, re-read offline.
>
> **The headline of WP-4 was wrong in direction.** Measured on who actually *closes* a goal rather than on
> who appears in the plan, the v3 contract did not regress from 1.000 to 0.875 — it improved from
> **0.722 → 0.875**. The 1.000 was never a measurement of closing. §6.

Predecessors: [WP-1/2](inquiry_architecture_v3_wp2.md) · [WP-3](inquiry_architecture_v3_wp3.md) ·
[WP-4](inquiry_architecture_v3_wp4.md).

§0–§11 are the diagnosis, written before anything was changed. **§12 onwards is Candidate C as built** — the contract,
what it makes impossible, what it does not, and the 8-call smoke that has not been run.

---

## 0. What this package did, and what it refused to do

WP-4 found that the closing contract fixes *how many* authorities close and *in what order* steps appear,
but never *which* authority closes — so the last step written became the closer, and the planner's habit of
writing `SELLER` last turned into a semantic decision. The obvious next move was a new prompt. This package
does not make one. Before any contract is redesigned it separates four questions that WP-4 had entangled:

| | question | answer |
|---|---|---|
| A | why did four answers truncate? | **unanswerable, permanently** — and now observable next time (§1) |
| B | does planner over-read cost real answers? | **yes structurally, 0 times in this corpus** — and the corpus cannot measure it (§2) |
| C | who closes, and why is the seller there? | **all 5 failures are one shape**, and it is not about the seller (§3) |
| D | can a contract forbid the seller fallback? | **no — the legitimate and illegitimate plans are identical** (§4) |

Zero model calls. `PLAN_MODE=replay` hands the runner a transport that throws and re-reads the recorded raw
answers with the current parser, validator and registry, refusing any row whose rebuilt user turn does not
hash to the recorded `input_fp`. **Verdict parity was checked before anything was concluded from it**: every
`failure`, `valid`, `plan`, `violations` and `availability` value in the replay is identical to the original
run. The replay adds fields; it changes no verdict.

Artifacts: `eval-store:runs/wp31-replay` (append-only, `run-verify → ok`).

---

## 1. Truncation observability

### 1.1 The defect

`InquiryDecisionGenerator.Envelope.of` read the vendor's message content and then threw it away:

```java
if ("length".equals(finish)) {
    return new Envelope(null, finish, "TRUNCATED");   // the content is right there, one line up
}
```

A row that records only *that* something went wrong turns a diagnosis into a re-run, and a re-run of a
planner is a new sample, not the same one.

### 1.2 The fix

`Envelope` now has two content fields, because there are two questions.

- **`content`** — "may this be read as a plan". Non-null only when `failure` is null. Every fail-closed
  caller is therefore unchanged **by construction**, not by care.
- **`said`** — "what did the vendor actually send". Filled in every case where anything came back: the
  truncated prefix, the refusal sentence, an HTTP error body, the unreadable envelope's own bytes.

`said` is evidence and never an input. Nothing repairs, completes or parses it. **A truncated JSON object
mended into a plan would be a plan the model never finished writing, and the authority set of a half-written
plan is not a smaller version of the right answer — it is an unknown one.** The harness writes it to a
`said` column beside `raw`; the two are the same string on a success and differ exactly where a call failed
with something in hand.

### 1.3 Five endings, five rows

`ResolutionPlannerEnvelopeTest` drives the real runner with a fake vendor and asserts the artifact, not the
Envelope — nine tests. The property is not that a bad answer is refused (that was already true and is
asserted here only so it cannot be traded away) but that the endings are **distinguishable afterwards**:

| vendor sent | `failure` | `finish` | `raw` | `said` |
|---|---|---|---|---|
| a plan | — | `stop` | the plan | the same bytes |
| a cut-off plan | `TRUNCATED` | `length` | null | **the prefix, unrepaired** |
| nothing, cut off | `TRUNCATED` | `length` | null | null |
| a refusal | `REFUSAL` | `stop` | null | the refusal sentence |
| known shape, not a plan | `UNPARSEABLE` | `stop` | the bytes | the same bytes |
| HTTP 429 | `HTTP_429` | null | null | the vendor's error body |

The last two rows of the *third* case matter: `TRUNCATED` with a prefix and `TRUNCATED` with nothing are
different observations, and `(finish=length, said=null)` is what tells them apart. **The shadow's four rows
could have been either, and now cannot be told.**

### 1.4 What is known about the existing four, and what is not

| | |
|---|---|
| **known** | `R:0c582144`, `R:83e607e0`, `R:9b8cc5a5`, `S:T12a`; `finish=length`; exactly **1,600** completion tokens each — the cap, reached precisely; prompt tokens 1,479–1,513, unremarkable; `reasoning_tokens` 0 |
| **known** | the cap is **1,600 in both v2 and v3** (`ResolutionPlannerPrompt.MAX_OUTPUT_TOKENS`, byte-identical at `70786fe4`). The ceiling did not move |
| **known** | under v2 these same four questions produced 153–347 completion tokens, three times each, nine of nine `stop`. The largest of all 201 v2 answers was 647 |
| **known** | all four are order-related; three of the four gold goals are `ENTITY.ORDER PRECONDITION → PROCEDURE CLOSES` |
| **unknown, permanently** | whether the model was looping, emitting an enormous `ask`, or writing many needs. **The content was discarded at the time and the replay confirms the loss rather than repairing it** — `said` is null on all four |

**No claim is made that these four are explained.** The next one will be.

### 1.5 The scorer no longer reads a truncation as a planning miss

`plansFromObservation` used to drop a failed row entirely, which made "the envelope never produced an
answer" indistinguishable from "the planner did not cover this goal". Both landed in `goal_coverage`. The
row is now kept, carrying its failure word and no needs, and the scorer reports
`envelope_failures: {TRUNCATED: 4}` with `uncovered: why = NO_ANSWER:TRUNCATED`. A truncated plan still
enters **no** quality metric as a plan: it contributes no closer verdict, correct or wrong.

---

## 2. Over-read and partial availability

### 2.1 What the harness could not previously answer

`StepAvailability` has carried `unavailableFields` — the precise truth behind an all-or-nothing verdict —
since WP-2, and no row ever wrote it down. `registry_fp` identified the snapshot and nothing could read it.
So every question of the form *"would this step have been available had the plan asked for less?"* required
either a second copy of `CapabilityRegistry.derive` in the scoring tools or a JVM. Both rows now carry the
snapshot's own answer — `registry.capabilities`, `registry.fields`, `availability[].unavailable_fields` —
so `tools/inquiry-need-eval/availability.mjs` holds **no second copy of the registry policy**.

### 2.2 The classes

Each entity read in a recorded run, against what the gold says that goal required:

| class | meaning |
|---|---|
| `A_EXACT` | the fields named are the fields required |
| `B_HARMLESS_OVER_READ` | extra fields, all of them readable here — costs a read, costs no answer |
| `C_HARMFUL_OVER_READ` | extra fields include an unreadable one, **and every field the goal required was readable**: the plan asking for more than it needed did not cost an extra read, it cost the answer |
| `D_GENUINELY_UNAVAILABLE` | a field the goal itself requires cannot be read here; no semantics can change that |
| `CAPABILITY_GAP` | the capability cannot act at all (unbound order, unsupported) — the field question is moot, and blaming the planner here would be wrong |

### 2.3 Result — 67-case shadow

23 entity steps across 63 answered rows.

```
PLANNER_ONLY_ENTITY_READ   6     (an entity read the gold does not ask for at all)
D_GENUINELY_UNAVAILABLE    7
CAPABILITY_GAP            10
C_HARMFUL_OVER_READ        0
B_HARMLESS_OVER_READ       0
A_EXACT                    0
```

**Harmful over-reads: 0. Goals flipped from resolvable to gap by over-reading: 0.**

Over-reading itself is rampant — 26 extra field namings, led by `ORDER_TRACKING` (7) and `ORDER_PAYMENT`
(7) — but every one of them is masked by a larger gap. **The corpus cannot measure this defect**, and the
reason is its composition, not the planner's behaviour:

| | |
|---|---|
| cases where an `ENTITY.ORDER` read can actually act (available **and** order-bound) | **2 of 67** |
| those 2 are NAVER, where `ORDER_FULFILLMENT` is `NOT_SUPPORTED` | so the only readable order field is payment |
| `ORDER_TRACKING` status across all 67 snapshots | `NOT_SUPPORTED` × 67 — no source in this repository reads a carrier number, on any channel |

### 2.4 Result — the smoke, where the case exists

`P01` is order-bound Cafe24 with an exact lookup: the one shape in which the defect is observable. The
recorded model answer produces it.

```
P01  ENTITY.ORDER CLOSES   named [ORDER_FULFILLMENT, ORDER_TRACKING]   gold [ORDER_FULFILLMENT]
     → C_HARMFUL_OVER_READ, blamed on ORDER_TRACKING alone
     → ALL_OR_NOTHING: NOT_SUPPORTED   FIELD_LEVEL: readable   NEED_MINIMUM: readable
P03  ENTITY.ORDER PRECONDITION  named [ORDER_FULFILLMENT]  → A_EXACT
```

So: **1 harmful over-read in 2 comparable entity steps**, and it flips a goal the system could have
answered. The defect is real. Its measured frequency on the 67-case corpus is zero because the corpus has
almost no answerable order.

### 2.5 The three availability semantics, priced on the same rows

| | 67-case shadow (72 goals) | smoke (3 goals) |
|---|---|---|
| **1. `ALL_OR_NOTHING`** (today) | 54 resolvable · 14 blocked · 4 no answer | 1 · 2 · 0 |
| **2. `FIELD_LEVEL`** | 56 · 12 · 4 | 2 · 1 · 0 |
| **3. `NEED_MINIMUM`** | 54 · 14 · 4 | 2 · 1 · 0 |

Read the middle column carefully. `FIELD_LEVEL` unblocks two goals in the shadow — and **both are
unblocked wrongly.** The measurement that shows it is a controlled pair on one goal, `R:7a8136b2`, whose
gold requires `ORDER_FULFILLMENT` on a snapshot that cannot read it:

```
need N2  named [ORDER_FULFILLMENT]                  → FIELD_LEVEL: GAP
need N1  named [ORDER_FULFILLMENT, ORDER_PAYMENT]   → FIELD_LEVEL: no gap
```

Same goal, same snapshot, opposite verdicts — decided by whether the planner happened to name one extra
field it did not need. **Under field-level availability, over-reading stops being a cost and becomes a way
to silence a gap**, and the system reports that it answered a question it cannot observe. That is a worse
failure than the one it fixes, and it is why candidate 2 is not recommended. `R:ae41a418` repeats the shape
exactly. A test pins it (`wp31.test.mjs`: *field-level availability can hide a gap the goal actually has*).

### 2.6 The architectural question, answered

> *"Is it right that code gives up on a resolvable inquiry because the planner asked for more fields than
> it needed?"*

**No.** And the reason is a boundary this architecture has already drawn everywhere else. `CapabilityId`
owns effect; the registry owns availability; the plan says what a need *requires* and never what the system
*can do*. But `gapOf` reads the planner's field list as an **instruction about what to read**, and then
holds the plan to it. The planner's field list is a claim about what the need is about — it is not a
resolver work order, and nothing should treat a planner's over-specification as a constraint on the
resolver.

**Recommendation: candidate 3 (`NEED_MINIMUM`) — the resolver decides the minimum fields the need
requires; the planner's list informs it and does not bind it.** It is the only one of the three that both
fixes P01 and leaves `R:7a8136b2` honestly blocked. It is also the only one that needs no new vocabulary:
availability stops being a function of the plan's precision.

**Nothing was changed.** Per the brief, the semantics are priced and left as a decision. Candidate 3 belongs
to the resolver package, not to the planner contract, and it is recorded here so WP-4 E2E does not inherit
`gapOf` unexamined.

---

## 3. Who closes — the taxonomy

`tools/inquiry-need-eval/closers.mjs`, over every gold goal and the needs the split-tolerant scorer assigns
to it. Independently implemented from the corrected `goals.mjs` scorer; the two agree exactly on every
figure below, which is the only reason either is quoted.

| | WP-2 r1 | WP-2 r2 | WP-2 r3 | **WP-4 (v3)** |
|---|---|---|---|---|
| `CORRECT_CLOSER` | 33 | 33 | 34 | **40** |
| `CORRECT_CLOSER_VIA_SPLIT` | 16 | 21 | 18 | **20** |
| `A_GENUINE_MULTI_AUTHORITY` | 2 | 2 | 2 | **3** |
| `D_TRUE_SELLER_ONLY` | 1 | 1 | 1 | 0 |
| `WP2_AMBIGUOUS_CO_CLOSER` | **14** | **12** | **15** | **0** |
| `AMBIGUOUS_CLOSER_OTHER` | 6 | 3 | 2 | **0** |
| `B_OPERATIONAL_FALLBACK` | 0 | 0 | 0 | **3** |
| `B_SELLER_SUBSTITUTED` | 0 | 0 | 0 | **0** |
| `C_CAPABILITY_GAP_FALLBACK` | 0 | 0 | 0 | **0** |
| `WRONG_CLOSER_NON_SELLER` | 0 | 0 | 0 | **2** |
| `NO_PLAN` (truncation) | 0 | 0 | 0 | 4 |
| **correct closer / 72** | **0.722** | **0.792** | **0.764** | **0.875** |

Three things this table says that WP-4 did not.

**The seller is never used to paper over a missing capability.** `C_CAPABILITY_GAP_FALLBACK` = 0 and
`B_SELLER_SUBSTITUTED` = 0, in every run. The failure mode the architecture most feared — a capability gap
dressed up as an authority — **does not occur**. (Both categories are reachable: they are unit-tested, and
`C05` in the shared fixture is the shape. The planner just does not produce it.)

**The mechanism reproduces.** In WP-2's 201 calls, `SELLER` closed beside another authority **49 times and
was the last step written 49 of 49 (100%)**. In WP-4, 6 goals involve the seller, 6 of 6 with the seller
written last. Recomputed here from the raw rows, at need level, independent of the goal scorer.

**The projection is neutral for this measurement.** WP-2's rows are v2-shaped and `contract.mjs`'s
projection is an estimate — but it does not touch roles, and roles are all this tool reads. Run with and
without `--project`, the taxonomy is byte-identical. Stated because it was checked, not assumed.

### 3.1 All five WP-4 failures are one shape

| goal | kind | gold closer | what the plan wrote |
|---|---|---|---|
| `R:8989a9d0.n1` | `B_OPERATIONAL_FALLBACK` | KNOWLEDGE | `KNOWLEDGE.CATALOGUE/PRECONDITION > SELLER/CLOSES` |
| `S:T1a.n1` | `B_OPERATIONAL_FALLBACK` | KNOWLEDGE | `KNOWLEDGE.CATALOGUE/PRECONDITION > KNOWLEDGE.ORG/CONTEXT > SELLER/CLOSES` |
| `S:T1b.n1` | `B_OPERATIONAL_FALLBACK` | KNOWLEDGE | same |
| `R:4181864b.n1` | `WRONG_CLOSER_NON_SELLER` | ENTITY_STATE | `ENTITY.ORDER/PRECONDITION > KNOWLEDGE.ORG/PRECONDITION > PROCEDURE.ORDER_ACTION/CLOSES` |
| `S:N7.n1` | `WRONG_CLOSER_NON_SELLER` | KNOWLEDGE | `KNOWLEDGE.CATALOGUE/PRECONDITION > ENTITY.LISTING/CLOSES` |

**In all five, the authority the gold says should close is present — and demoted to `PRECONDITION`, with
whatever was written last taking the ending.** The corrected scorer reports `demoted: true` on 5 of 5.

That is a sharper diagnosis than "the seller is a fallback", and it changes what the fix has to be. **Two
of the five have no seller in them at all.** A rule aimed at `SELLER` would leave those two exactly as they
are. The defect is not the seller; the seller is the most common thing the model writes last.

### 3.2 The failures are concentrated, not scattered

The gold has exactly **four** goals whose answer requires two knowledge capabilities acting together
(`KNOWLEDGE.CATALOGUE` + `KNOWLEDGE.PRODUCT` — "is this spec the same across the range?"). They are
`R:b30d57be`, `R:8989a9d0`, `S:T1a`, `S:T1b`.

**Three of those four are the three `B_OPERATIONAL_FALLBACK` failures**, and the fourth is one of the
capability mismatches. The planner hands a goal to the seller precisely where the goal needs *two* of its
capabilities to close together — the one shape the contract permits and never explains. This is not a
random 4% error rate; it is one unhandled case, hit three times out of four.

---

## 4. Can the contract forbid a seller fallback?

### 4.1 The honest answer first

**No contract can, and the reason is a fact about the world rather than about the schema.** Compare:

```
legitimate   KNOWLEDGE.ORG/PRECONDITION  >  SELLER/CLOSES     (the policy is read, the seller judges the exception)
illegitimate KNOWLEDGE.CATALOGUE/PRECONDITION > SELLER/CLOSES (the catalogue answers it; the seller was appended)
```

These are the same shape. The difference is whether a new seller judgment is genuinely required — which the
plan cannot state, because if the model knew that reliably it would not have written the second one. Both
are in the shared fixture, `C02` and `C03`, both **contract-valid today**, and `C03` carries the note that
what refuses it is the scorer and not the validator.

So the goal is not "make the fallback inexpressible". It is **make the ending a decision instead of a
side-effect of where the model stopped writing.**

### 4.2 The four candidates

| | expressible for all 72 gold? | structurally stops the measured defect? | legitimate KNOWLEDGE→SELLER still expressible? | schema / token cost | deterministic validation | extensible |
|---|---|---|---|---|---|---|
| **A** — required authorities only; `SELLER` removed from the schema | **no — 3 goals close with SELLER** | no: the same choice reappears as the role on the knowledge step | **no** | −1 enum value | yes | poor |
| **B** — `SELLER` kept, plus a `seller_reason` enum admitting only semantic reasons | yes | **no** — 0 of the 5 failures are seller-substitution; the 3 seller failures already *look* like `JUDGMENT_REQUIRED`, and 2 have no seller at all | yes | +1 enum per seller step | only that the token is legal | fair |
| **C** — `closing_authority` named per need; steps say what is read | **yes, all 72** | **yes for the mechanism**: the ending is a field, not a position | yes | +1 enum field per need (~4 tokens) | **yes, cross-checkable against the step list** | good |
| **D** — drop positional meaning, move resolution requirement to a separate structure | yes | yes | yes | largest; a second structure beside steps | yes | unclear — it is C with more parts |

**A fails on the gold.** Three of the 72 goals close with the seller; removing the token makes them
inexpressible. And it does not even work: with `SELLER` gone, "the seller judges after reading the policy"
has to be written as *knowledge demoted to `PRECONDITION` with no closer* — which is the failing shape,
renamed.

**B addresses a failure mode that does not occur.** `C_CAPABILITY_GAP_FALLBACK` and
`B_SELLER_SUBSTITUTED` are 0 in every run (§3). Asking the model to self-report why it chose the seller,
when the shape it produced already reads as a legitimate reason, buys a token and no guarantee.

**D is C with more parts**, and nothing measured here needs the extra structure.

### 4.3 Chosen: **C — `closing_authority` as a named field**

```
need := { id, ask, closing_authority: KNOWLEDGE|ENTITY_STATE|PROCEDURE|SELLER,
          steps: [...], customer_inputs: [...] }
```

with the validator rule: **every `CLOSES` step's authority must equal `closing_authority`, and at least one
must exist.** What this buys, precisely:

- **`MULTIPLE_CLOSING_AUTHORITIES` becomes inexpressible rather than refused.** The ending is a single
  enum value; two endings cannot be written. That is the WP-3 discipline (`ResolutionPlan.Step`'s sealed
  union) applied to the one rule WP-3 had to leave as a check.
- **Position stops deciding.** The model answers "what ends this need?" directly instead of by running out
  of steps. All five WP-4 failures are position artifacts; this is the only candidate that removes position
  from the semantics.
- **All 72 gold goals are expressible**, including the four with two closing *capabilities* — they share
  one closing *authority*, which is what the field carries.
- **It is checkable offline**, against the step list, with no model and no judge.

One design detail, offered as a **hypothesis to test and not a claim**: place `closing_authority` *before*
`steps` in the schema. A left-to-right decoder then commits to the ending before writing the reads, which
is the opposite of the dynamic that produced these five. Whether that matters is exactly the sort of thing
the targeted smoke in §10 can answer, and it is not asserted here.

**What C does not do, stated plainly:** it does not make the seller fallback impossible. `C03` remains
writable. It makes it *deliberate*. The remaining distance is the scorer's (§6) and, eventually, the
resolver's.

---

## 5. The closing-authority gold — already there

The brief asked whether the gold's real closing authority needs a new annotation. **It does not, and adding
one would be a second copy of a truth the gold already carries.** Computed over all 72 frozen rows:

| gold closing authority | goals |
|---|---|
| KNOWLEDGE | 57 |
| PROCEDURE | 7 |
| ENTITY_STATE | 5 |
| SELLER | 3 |

**Every one of the 72 has exactly one closing authority.** Prerequisites are already separate and explicit:

| shape | goals |
|---|---|
| KNOWLEDGE closes, nothing read first | 57 |
| ENTITY_STATE precondition → PROCEDURE closes, KNOWLEDGE as context | 5 |
| ENTITY_STATE closes | 5 |
| ENTITY_STATE precondition → PROCEDURE closes | 2 |
| SELLER closes, ENTITY_STATE as context | 2 |
| SELLER closes alone | 1 |

Four goals have two closing *capabilities* of the same authority (§3.2). **No row is ambiguous and no
adjudication table is needed** — v3.2's own `build.py` already asserts the one-closing-authority property,
which is why this is a computation and not a re-labelling. **No gold version was created**, no row was
re-labelled, and the `R:77a91fab` / `R:f403e606` scorer blind spot (4 indistinguishable goals) is carried
forward unchanged and still not adjudicated, per WP-4's instruction.

---

## 6. The scorer correction — how 1.000 was reached

### 6.1 What the old number measured

`goals.mjs` credited a goal when the gold's closing authority appeared **among** the closers. A WP-2 need
that wrote `KNOWLEDGE.CATALOGUE/CLOSES` **and** `SELLER/CLOSES` satisfied that: the right authority was in
the closing set, so the goal counted as covered, and recall was 1.000.

That plan names two endings and says nothing about which is the answer. **Ambiguity is within a need** —
a goal *split across* needs legitimately has a different ending in each, which is what split-tolerance
means; two closers *inside one need* is the shape the v3 contract made inexpressible. The corrected scorer
separates them, and the separation is mutation-tested.

### 6.2 The size of the overestimate

| | WP-2 r1 | WP-2 r2 | WP-2 r3 | **WP-4 (v3)** |
|---|---|---|---|---|
| goal coverage *(the old headline)* | 1.000 | 1.000 | 1.000 | 0.875 |
| authority **presence** (in any role) | 1.000 | 1.000 | 1.000 | 0.944 |
| **correct closer** | **0.722** | **0.792** | **0.764** | **0.875** |
| ambiguous closer (two endings in one need) | 20 | 15 | 17 | **0** |
| seller ending inserted where gold does not end with the seller | 15 | 14 | 19 | **3** |
| envelope failures | 0 | 0 | 0 | 4 `TRUNCATED` |

**20 of 72 goals in rep 1 — 27.8% — were credited to a plan that offered two endings.** That is the whole
of the gap between 1.000 and 0.722.

### 6.3 The direction of the WP-4 verdict was wrong

WP-4 reported *"recall 1.000 → 0.875"* and classified it as a regression caused by the v3 contract. On the
metric that describes what the customer receives:

> **correct closer: 0.722 / 0.792 / 0.764 (v2) → 0.875 (v3).**
> **Ambiguous endings: 20 / 15 / 17 → 0. Seller endings inserted: 15 / 14 / 19 → 3.**

The v3 contract did not damage authority semantics. **It removed an ambiguity that the old scorer had been
counting as success**, and what remains — 5 demoted closers — is a smaller and better-defined defect than
what it replaced. WP-4's finding stands: the closing contract decides the closer by position, and that must
be fixed. Its *headline* does not.

WP-4's own correction was half of this: it said 1.000 "was partly the ambiguity, not the competence". The
half it missed is that the comparison ran the other way.

### 6.4 The metrics from here

Headline, in this order:

1. **goal coverage** — was every resolution goal planned at all
2. **correct closer rate** — did the authority that should end it, end it
3. **wrong closer rate**, split into *demoted* (the authority is present, not closing) and *substituted*
4. **missing required authority** — presence, reported beside closing so the distance is visible
5. **invalid / fallback authority insertion** — a seller ending where the gold does not end with the seller;
   a seller-closing need the assignment could not place at all (`seller_only_extra_needs`)

`required_authority_recall` is **kept unchanged** so every historical figure stays reproducible, and
reported beside `correct_closer` precisely so the two can never again be read as the same claim. Envelope
failures are counted on their own and never averaged into quality.

**WP-2's published numbers are preserved as historical fact.** They are not restated, and this document
records that the old metric overestimated semantic correctness rather than editing the figures it produced.

---

## 7. Customer input — measured, untouched

Per the brief, no prompt or schema change. One thing needs saying about the numbers themselves:

| | |
|---|---|
| exact / over / under | 25 / 43 / 3 of 68 goals |
| over-ask by type | MODEL 19 · MEASUREMENT 18 · SIZE 17 · USE_CONTEXT 17 · QUANTITY 13 · OPTION 4 |
| **required input recall** | **2 of 5** |
| forbidden identity input | **0** |

**`required_input_recall = 0.4` is a rate over five data points.** The entire gold requires exactly five
customer inputs across 72 goals — four `OPTION` and one `MEASUREMENT` — so this number cannot carry a
headline and should not have been near one. It is reported, with its denominator, and nothing is concluded
from it.

The `OPTION` story is a precision/recall inversion: `OPTION` is **over-asked 4 times** on goals that do not
need it and **under-asked on 3 of the 4 goals that do** (`R:ae51c7f8`, `S:T9a`, `S:T9b`, `S:X9a` require
it; three did not get it). Under-asking an input the resolution genuinely needs is the blocker half of this
metric, and three instances is the whole of it. Backlog, after the closing contract settles.

---

## 8. Regressions

Six rows added to `contracts/inquiry-planner/v2/synthetic/planner-scenarios.jsonl` (30 → 36), read by both
the Java scenario tests and the offline mirror, so the two cannot drift.

| | |
|---|---|
| `C01` | the `R:8989a9d0` shape written correctly — the catalogue closes it and nothing is appended behind it |
| `C02` | a genuine two-authority resolution: `KNOWLEDGE.ORG/PRECONDITION → SELLER/CLOSES` |
| `C03` | **the defect**: the same authorities as `C01`, knowledge demoted so the seller may close. **Contract-valid today.** The fixture says so, and says that the scorer is what refuses it |
| `C04` | the required capability cannot act here and the plan **keeps** it → recorded gap, no substitution |
| `C05` | the same, answered by putting `SELLER` in the missing capability's place. **Also contract-valid today** |
| `C06` | the P01 over-read: one unreadable extra field makes the whole step a gap |

`C03` and `C05` are the important ones, and they are deliberately marked *valid*: **a regression fixture
that lied about what the contract refuses would be worse than none.** They pin what is currently
expressible, so that when candidate C lands, what changes is visible as a diff rather than as a claim.

The scorer-level regressions are in `goals.test.mjs` — `C03` must score `wrong_closer` +
`fallback_authority_inserted` + `goal_coverage 0` while reporting `required_authority_present = 1` and
`demoted = true`; `C05` must report `seller_only_extra_needs = 1`; `C02` must score **correct**, because
the rule is about endings and not about pairs.

**`R:8989a9d0` is fixed as the representative regression.** Expected: `KNOWLEDGE` closes; `SELLER` is not
appended.

---

## 9. Tests

| | |
|---|---|
| `ResolutionPlannerEnvelopeTest` | **new** — 9 tests; five endings, five distinguishable rows; the registry block; `unavailable_fields` naming the field that caused a gap |
| `ResolutionPlanValidatorScenarioTest` | valid-plan count 14 → **20** (the six new fixtures all validate with the expected availability) |
| `tools/.../test/wp31.test.mjs` | **new** — 10 tests over both diagnostics, including the controlled pair that shows field-level availability hiding a real gap |
| `tools/.../test/goals.test.mjs` | +5 tests for the corrected scorer; mirror count 22 → 28 |
| `tools/.../test/mutations.test.mjs` | **+5 mutations**, all caught: demotion counted as a correct close; the seller fallback un-named; the substituted seller uncounted; a truncation folded back into planning misses; presence and closing collapsed into one number |

Tooling: **91 tests, 0 failures.** Backend: **4,503 tests, 0 failures**, 54 skipped (the env-gated live runners, unrun).

**One contract change required a test to be rewritten**, and it is the count guard in
`ResolutionPlanValidatorScenarioTest` — a deliberate guard against silently adding fixtures, updated with
the fixtures it guards. No safety assertion was weakened; the new scenarios add 6 valid plans and 0
exemptions.

---

## 10. The next actual-model experiment

**A targeted smoke, not 67 cases, and not before candidate C is built.** Nothing in §11 has been executed
and no approval is held.

Proposed manifest (to be presented for approval in its own turn, after the contract lands):

| | |
|---|---|
| calls | **8**, cap 8 |
| cases | `C01` (knowledge closes, nothing appended) · `C02` (knowledge precondition → true seller judgment) · `C03`-shaped (the `R:8989a9d0` synthetic equivalent — **the representative regression**) · `P01` (pure entity read, exact fields) · `P03` (entity precondition → procedure) · `C04` (unavailable capability → gap, not seller) · `P07` (knowledge + customer input) · one two-knowledge-capability goal (§3.2's unhandled shape) |
| inputs | **synthetic only** — no customer text |
| model | `gpt-5-2025-08-07` @ `minimal`, strict `json_schema` — unchanged, per the brief |
| prompt | the new `resolution-planner/v4`, whatever it turns out to be |
| marketplace / DB writes / external writes / production Cases / judge / draft / retrieval | 0 |
| raw | stored before scoring, append-only, new run id |

Pass bar: **correct closer 8/8 · seller fallback 0 · contract violation 0 · envelope failure 0.**
Only if that holds is a 67 × 1 re-verification proposed — and that will be a separate manifest.

---

## 11. Acceptance

| the brief asked for | where | result |
|---|---|---|
| truncation storage fix | §1 | done; five endings distinguishable, 9 tests |
| what is knowable about the existing four | §1.4 | token counts, the unchanged cap, the v2 comparison — **and the content is gone for good** |
| over-read frequency | §2.3 | 26 extra field namings; 0 harmful |
| harmful resolvable→gap count | §2.3–2.4 | **0** in the 67-case corpus (which cannot measure it), **1 of 2** in the smoke |
| availability candidate comparison | §2.5–2.6 | priced; **candidate 3 recommended**, nothing changed |
| multi-authority / seller fallback taxonomy | §3 | 5 categories; capability-gap substitution **0 in every run** |
| the five wrong closers | §3.1 | all five are one shape — the right authority demoted; **two have no seller in them** |
| contract candidates A/B/C/D | §4.2 | compared on seven criteria |
| chosen candidate and why | §4.3 | **C**; A fails on the gold, B addresses a failure that does not occur |
| closing-authority gold / scorer | §5, §6.4 | gold already unambiguous — **no new version**; scorer corrected |
| how 1.000 overestimated | §6.2–6.3 | 20 of 72 goals were ambiguous endings; **the verdict's direction was wrong** |
| regressions / synthetic tests | §8 | 6 fixtures + 5 scorer tests |
| backend / tools test suites | §9 | backend **4,503 / 0 failures** · tools **91 / 0** |
| mutation tests | §9 | 5 new, all caught |
| next targeted smoke manifest | §10 | 8 calls, synthetic only, **not executed, no approval held** |
| why not WP-4 E2E yet | below | |

### Why this still does not go to WP-4 E2E

The planner is **not frozen**. WP-4's gate failed on seven conditions and this package changed none of the
planner's behaviour — it changed what can be *seen*. Specifically: the contract that decides the closer by
position is still in force, `R:8989a9d0` still hands an answerable catalogue question to the seller, and
the goal shape that causes three of the five failures (two knowledge capabilities closing together) is
still unexplained by the contract. Running an end-to-end resolver against that would produce a
Wrong-Automation / Safe-Resolution / Correct-Handoff headline that measures this defect rather than the
resolver.

What has changed is that the next step is a contract edit with a named candidate, a representative
regression, and a bar — instead of a prompt edit with a hope.

### Not proposed

67 × 3 · prompt micro-tuning · a model change · a reasoning-effort change · a new gold version · any change
to `gapOf` inside this package · customer-input tuning · WP-4 E2E.

---
---

# Part II — Candidate C, built

> **Model calls 0 in this part too.** Marketplace 0 · DB writes 0 · migrations 0 · production Cases 0.
> Contract, validator, schema, gold, scorer, fixtures and tests. No model has been shown `resolution-planner/v4`.

## 12. The contract

```
need := { id, ask, closing_authority, steps[], customer_inputs[] }
step := { capability, scope?, fields? }          // no role
closing_authority ∈ { KNOWLEDGE, ENTITY_STATE, PROCEDURE, SELLER }
```

`ResolutionPlan.Need.closingAuthority()` is the **single source of truth** for who resolves a goal. The step-level
`CLOSES` / `PRECONDITION` / `CONTEXT` role is **gone** — not deprecated, not tolerated: `ResolutionPlan.Role` does not
exist, so nothing can read one, and the parser refuses an answer that carries one (`PLAN_SHAPE`, the same word
`effect` and `depends_on` earned when they left in WP-3).

**There is deliberately no second place the ending is written.** A goal-level declaration beside a step-level one is
two truths that can disagree, and the disagreement would have to be settled by a rule — which is precisely how
position became meaning the first time.

**Which steps close is derived, and cannot be reordered into a different answer.** `Need.closingSteps()` returns the
steps whose capability belongs to the declared authority. Several may qualify, and that is the point: §3.2 found that
3 of the 4 gold goals needing **two knowledge capabilities together** were WP-4 failures, and there was no way to say
"both of these answer it". Now there is, in one field.

**Order still expresses order.** A step's place is its place in the execution sequence — an order read stands before
the procedure that changes that order. It expresses nothing else.

**`closing_authority` is declared before `steps`**, in the record, in the serialiser and in the vendor schema. Strict
Structured Outputs generates properties in declaration order, so a left-to-right decoder commits to the ending before
it writes what the ending requires — the opposite of the order that let the last step written become the closer. That
ordering is a **design hypothesis the smoke tests**; the structural part (position carries no meaning) holds either way
and is proven by test, not by argument.

### 12.1 What the model is now told

`resolution-planner/v4`. Two v3 sentences left — "exactly one authority closes a need" and "a PRECONDITION comes
before the CLOSES step it enables", the pair that made the last step the closer — and four arrived:

- decide `closing_authority` **first**; which step closes is not the order or the position of the steps;
- name at least one capability of that authority, and **name both when two capabilities of one authority together make
  the answer**;
- `SELLER` is the ending only when a new seller judgment **is itself the answer** — not when knowledge is thin, a
  connector is missing, or the model is unsure, because those are recorded by the system afterwards;
- steps are in execution order, and that is all order means.

The payload floor is **unchanged to the byte**: `user()` is untouched, and `ResolutionPlannerContractTest.payloadFloor`
still asserts that the same message under a deployment that can do none of it produces the identical payload.

## 13. Validator invariants

| | |
|---|---|
| **removed** | `NO_CLOSING_STEP`, `MULTIPLE_CLOSING_AUTHORITIES`, `PRECONDITION_AFTER_CLOSER` |
| **added** | `CLOSING_AUTHORITY_UNSUPPORTED` — a need must require at least one capability of the authority it says resolves it |
| **restated** | `PROCEDURE_WITHOUT_ORDER_PRECONDITION` → `PROCEDURE_WITHOUT_ORDER_READ`. Same rule; the word "precondition" left because roles did. What makes it a violation is the read's **absence**, never its position — so the two steps in either order are both valid, and a test asserts exactly that |
| **unchanged** | `NO_NEEDS`, `TOO_MANY_NEEDS`, `NEED_ID_ORDER`, `EMPTY_ASK`, `NO_STEPS`, `TOO_MANY_STEPS`, `DUPLICATE_STEP`, `IDENTITY_INPUT`, `UNNAMED_INPUT`, `DUPLICATE_INPUT` |

The three removals are removals for the WP-3 reason: **a rule describing an object that cannot exist is not a guard.**
`closing_authority` is one enum value, so "no ending" and "two endings" are not writable, and "a precondition after its
closer" is not a sentence the shape can form.

**Availability is untouched.** An unavailable capability does not change `closing_authority`; it becomes a recorded gap
and no other authority is put in its place. `gapOf` — including the all-or-nothing field clause §2 recommends
changing — is **byte-identical**, so availability figures stay comparable across this package. That is a resolver
decision and this package moves closing semantics and nothing else.

**Registry-bound, and nothing domain-specific.** `closing_authority` is `Authority`, the four values the registry has
had since WP-1. No shipping rule, no refund rule, no product rule entered the contract.

## 14. Gold v3.3 — a re-expression, not a re-labelling

`eval-store:inquiry-resolution-plan/v3.3`, `verify → ok`. The same 72 goals. `build.py` derives it from frozen v3.2 and
asserts the change is **lossless in both directions**:

- **forward** — `closing_authority` is the single authority among v3.2's `CLOSES` steps (v3.2's own build already
  asserted there is exactly one, and this asserts it again rather than trusting it);
- **backward** — the `CLOSES` set is recomputed as "every step whose capability belongs to `closing_authority`" and
  compared index by index with v3.2's. **72 of 72 match.** No fact is lost.

Capability, scope, fields, customer inputs, `v2_type`, `status` and `expected_terminal` are carried through and
asserted equal. Role is dropped, and what it carried beyond the ending — `PRECONDITION` vs `CONTEXT` — is read by no
contract rule once the closer is named.

```
KNOWLEDGE 57 · PROCEDURE 7 · ENTITY_STATE 5 · SELLER 3        (72, one ending each)
goals resolved by two capabilities of one authority: 4
```

v3.2 stays frozen and readable: it is the gold the `wp4-shadow` run and the whole of Part I were scored against.
**Evidence for the re-expression being lossless in practice as well as in the builder:** every figure in §2.3 and §2.5
reproduces byte-identically when the same recorded run is scored against v3.3 instead of v3.2.

## 15. Offline replay — what Candidate C would and would not have changed

**Candidate C changes no old model answer, and nothing here pretends otherwise.** The WP-2 and WP-4 raw answers were
written against older contracts; they are read through `contract.mjs`'s projection, which derives the ending from the
roles the model actually wrote and **refuses to choose when the model wrote two** (`closing_authority: null`, and the
result does not parse as a WP-3.1 plan — a test pins this, because a projection that picked one would be inventing a
decision the model never made).

**Made structurally impossible.** Counted on the recorded runs:

| shape | occurrences | under Candidate C |
|---|---|---|
| a need naming **two endings** | **61 of 361** WP-2 needs (16.9%) | unwritable — one enum value |
| a need naming **no ending** | **2** WP-4 needs (`NO_CLOSING_STEP`) | unwritable — the field is required |
| a precondition after its closer | **1** WP-4 need | unsayable — there are no roles to order |

So **3 of the 5 contract violations in the 67-call shadow become inexpressible.** The other two —
`PROCEDURE_WITHOUT_ORDER_READ` and `DUPLICATE_STEP` — remain rules, because they are about what a plan contains rather
than about shape.

**Still the model's choice — all five wrong closers.** Projected into the WP-3.1 representation, the taxonomy is
identical to §3: `CORRECT_CLOSER` 40 · `CORRECT_CLOSER_VIA_SPLIT` 20 · `A_GENUINE_MULTI_AUTHORITY` 3 ·
`B_OPERATIONAL_FALLBACK` 3 · `WRONG_CLOSER_NON_SELLER` 2 · `NO_PLAN` 4 — **correct closer 63 of 72, unchanged.**

That is the honest ceiling of this contract. Every one of the five is "the authority the gold requires is present and
something else resolves the need", and under Candidate C that sentence becomes *"the model declared the wrong
`closing_authority`"*. It is now **a single stated decision** instead of an accident of ordering — visible, scorable,
and still the model's to get right. **Whether it does is exactly what the smoke buys, and nothing before the smoke may
claim it.**

**Positional interpretation is gone from the code, and a test says so.** `ResolutionPlan.Role` does not exist, so the
Java side is compile-enforced. On the scoring side a structural test pins the count of every runtime read of the
retired token: `goals.mjs` 1 (the legacy fallback that scores runs recorded before WP-3.1), `contract.mjs` 1 (the
projection), `closers.mjs` 0, `availability.mjs` 0 — and the one remaining read of "the last step" is
`seller_last_written`, the measurement that proved the mechanism (49/49, then 6/6). **A measurement of the habit is the
opposite of obeying it**, and the count is pinned so a second read cannot appear without someone saying why.

## 16. Tests

| | |
|---|---|
| `ResolutionPlannerContractTest` | the need's properties are `id, ask, closing_authority, steps, customer_inputs` **in that order**; no branch has a `role`; the `SELLER` branch is `capability` alone; a retired `role` is `PLAN_SHAPE`; a missing ending is `UNPARSEABLE`; the vocabulary's `closing_authorities` is the `Authority` enum |
| — **new** | `positionCarriesNoClosingMeaning`: three steps, **all six permutations**, one answer for `closingSteps()` and one validation verdict in every one of them |
| `ResolutionPlanValidatorScenarioTest` | 25 valid · 5 refused · 13 inexpressible; `neverSubstitutes` now asserts the **declared** resolution is unchanged by a gap |
| `goals.test.mjs` | two endings are no longer refused but **unwritable**; two capabilities of one authority resolve together; a projection **cannot choose** between two recorded endings; the v3.3 synthetic gold is a set of legal plans |
| `wp31.test.mjs` | any order gives the same verdict through both scorers; an unavailable capability does not change the declared resolution; **the structural guard** on positional reads |
| `mutations.test.mjs` | 19 mutations, all caught, including **"POSITION DECIDES AGAIN"** — take the closer from the last step written and the R:8989a9d0 shape starts scoring correct |

The notation in the tool tests is worth stating plainly: a test still writes which step closes, because that is what
the test means; the helpers read that, derive the declared ending, and emit roleless steps. **Every existing call site
says what it always said, and what reaches the scorer is the shape the contract now has.**

**Suites: backend 4,504 / 0 failures · tools 98 / 0.**

**Tests rewritten because the contract changed**, all in the same direction — from "the role says who closes" to "the
need says who closes". No safety assertion was weakened: identity refusal, payload floor, availability-never-substitutes
and fail-closed parsing are asserted exactly as before, and the suite gained the permutation property and the
structural guard. Fixture counts moved because the fixture grew (v3: 43 rows).

**The v2 planner fixture is frozen, not edited.** `contracts/inquiry-planner/v3/synthetic/` is the new one; under
WP-3.1's parser every row of v2 carries a retired slot, which is what a superseded fixture should look like. The
retired shapes are all carried forward as X rows so nothing stopped being tested.

## 17. Deferred, deliberately

| | |
|---|---|
| **over-read / availability** | `gapOf` unchanged. §2's recommendation (resolver-owned need-minimum fields) stands and belongs to the resolver package. The finding that must not be lost: **field-level availability lets an extra readable field hide a genuinely unavailable required one** — measured on `R:7a8136b2`, pinned by a test |
| **truncation** | the WP-3.1 fix stands: `said` retained, fail closed, never repaired, excluded from quality scoring. The four historical truncations remain permanently unexplained and no speculation is offered |
| **customer inputs** | untouched. Metrics kept; the `OPTION` inversion (over-asked 4 times, under-asked on 3 of the 4 goals that need it) stays backlog. The reminder from §7 stands: `required_input_recall` has a denominator of **5** |
| **the seller fallback** | still writable (`C11`). No contract can forbid it, because the legitimate and illegitimate plans are the same shape. The scorer refuses it; the smoke measures it |

## 18. The 8-call targeted smoke — proposed, not run

**No model call has been made and no approval is held.** The manifest below is what will be presented for a single-use
approval in its own turn; its request fingerprints are derived offline at the pinned commit and shown with the request.

| | |
|---|---|
| calls | **8**, hard cap 8, one per case |
| cases | `C1` product knowledge · `C2` company policy · `C3` **two knowledge capabilities together** · `C4` entity state · `C5` entity read → procedure · `C6` policy → true seller judgment · `C7` catalogue-answerable (the R:8989a9d0 shape) · `C8` unavailable capability |
| inputs | **synthetic only**, from `contracts/inquiry-planner/v3/synthetic/planner-scenarios.jsonl` — no customer text |
| model | `gpt-5-2025-08-07` @ `reasoning_effort=minimal`, strict `json_schema` — **unchanged, for a controlled comparison** |
| prompt | `resolution-planner/v4` |
| marketplace · DB writes · external writes · production Cases · judge · draft · retrieval · migrations | **0** |
| output | new append-only run id; raw answers stored **before** scoring |

**Pass bar — all of it, or the smoke fails:**

1. 8/8 answered · envelope failures 0 · parse failures 0 · contract violations 0
2. correct `closing_authority` **8/8**
3. `C3` resolves as `KNOWLEDGE` **naming both knowledge capabilities** — the shape 3 of 4 gold instances failed on
4. `C5` resolves as `PROCEDURE`, not `ENTITY_STATE`, and reads the order
5. `C6` resolves as `SELLER` — a genuine judgment is not scored as a fallback
6. `C7` **seller fallback insertion = 0**
7. `C8` keeps `KNOWLEDGE` and records the gap — **seller substitution = 0**
8. forbidden identity input = 0

**If it fails:** the 67 cases are not run. The failure is classified as **schema/contract** vs **closing semantics** vs
**capability planning**, and there is no automatic prompt tweak and no retry.

**If it passes:** a 67 × 1 final planner validation is proposed, as a separate manifest. **Not 67 × 3.**

### 18.1 The freeze gate after the smoke

Unchanged from WP-4's seven conditions, with items 1 and 7 restated on the metric that replaced authority recall:

1. wrong closing authority = 0 — *replaces "wrong authority substitution", and is strictly stronger*
2. ORDER required-authority miss = 0
3. `procedure_for_read` = 0
4. forbidden identity input = 0
5. unresolved required goal = 0, or explainable as a clear annotation defect
6. contract / schema failure = 0
7. **correct closer ≥ 0.875** — the v3 figure; a contract that moves the ending into a declared field may not score
   worse on the ending than the contract that inferred it

**The planner is not frozen and WP-4 E2E is not proposed.** What changed in Part II is that the contract no longer
decides the ending by accident. Whether the model decides it correctly is unmeasured, and will stay unmeasured until
the smoke runs.
