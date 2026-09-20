# Inquiry v3 WP-2 — Resolution Planner: Contract to Shadow

2026-09-20 · branch `feat/review-decision-workspace-v1` · design `docs/inquiry_architecture_v3.md` · previous
`docs/inquiry_architecture_v3_wp1.md`

**Steps 1 and 2 are done; step 3 (shadow) is not started** — it begins with the first model call, and that needs the
approval manifest in §9.

**Zero-counts for this package:** model calls **0** · marketplace calls **0** · external writes **0** · migrations **0** ·
changes to the dev DB `sellerops` **none**. The eval runs used throwaway copies of the S0 clone, dropped afterwards.

---

## 1. The product owner's adjudication, applied — Plan Gold v3.1 is frozen

| row(s) | decision | in the gold |
|---|---|---|
| `f81ad84a` n1 | **ENTITY_STATE only.** A tracking/fulfilment lookup is a read, not a procedure. With no linked order it is a capability gap and then a seller handoff | one step: `ENTITY.ORDER` CLOSES, fields `ORDER_FULFILLMENT` + `ORDER_TRACKING`, terminal `CAPABILITY_GAP:UNBOUND` |
| `8989a9d0` n1 · S `T1a` · `T1b` | **KNOWLEDGE** | `KNOWLEDGE.CATALOGUE` + `KNOWLEDGE.PRODUCT` CLOSES, terminal `NEEDS_SELLER` |
| `f403e606` n2 | **KNOWLEDGE** | `KNOWLEDGE.PRODUCT` CLOSES, terminal `NEEDS_SELLER` |
| S `N6` | **KNOWLEDGE (company policy)** — with no such knowledge the runtime goes to the seller, and the gold stays KNOWLEDGE so a policy taught once is reused | `KNOWLEDGE.ORG` CLOSES, terminal `NEEDS_SELLER` |

**All 72 rows are FROZEN; nothing is pending.** Stored as `eval-store:inquiry-resolution-plan/v3.1`
(`contracts/inquiry-resolution-plan/v3.1/dataset.meta.json`); v3 is kept and marked SUPERSEDED because the WP-1 diagnostic
used it.

**The new architecture invariant** (product owner, 2026-09-20) is in the vocabulary, the instruction, the validator and the
scorer:

> A PROCEDURE is never used for a plain read or answer. When reading entity state resolves the request, the plan ends at
> ENTITY_STATE. A procedure is required only for an external state change or a bounded business workflow.

It is enforced structurally: every step carries an `effect`, a PROCEDURE with `effect = NONE` is refused
(`PROCEDURE_WITHOUT_EFFECT`), a non-procedure with an effect is refused (`EFFECT_ON_NON_PROCEDURE`), and the scorer reports
`procedure_for_read` by name.

Each step also carries the instance it is about (`scope`), which is what makes entity/scope accuracy measurable:
`KNOWLEDGE.CATALOGUE` about **this listing** (its options) is a different claim from the same capability about the
**seller's catalogue** (does such a model exist at all). Nine gold rows are catalogue-wide.

## 2. Step 1 — the planner contract (model 0)

| piece | where | what holds it |
|---|---|---|
| instruction | `ResolutionPlannerPrompt.system()` (`resolution-planner/v1`) | need splitting, the seven capabilities, roles, the procedure invariant, the teachable-answer rule, identity never asked, **availability never considered** |
| payload | `ResolutionPlannerPrompt.user()` | the customer's message + four situation facts: surface, whether a listing is resolved, that listing's option count, and which product-context inputs may be asked here. **No identifier of any kind**, no seller text, no past answer |
| schema | `ResolutionPlannerPrompt.schema(snapshot)` | strict Structured Outputs: every object closed, every property required, every token an enum built from the registry — capabilities, fields, scopes, roles, effects, and the askable inputs for this surface |
| parser | `ResolutionPlanParser` | strict: one unknown token fails the whole plan (`PLAN_SET`), never a dropped step |
| validator | `ResolutionPlanValidator` | 16 contract rules + per-step availability |
| door | `InquiryDecisionGenerator.resolutionPlan` / `resolutionPlanBody` | the same capability, key, transport and Envelope failure words as v2 — no second LLM egress |
| harness | `ResolutionPlannerRunner` (test) | oracle · replay · model, five fingerprints per row, no-overwrite output |

**Three payload decisions worth stating.**

1. **Availability is not in the payload.** A plan states what the need requires. If the planner were told what this
   deployment can do, an order question would quietly become a policy question wherever the connector is missing — the
   `4181864b` failure. A test asserts the payload is byte-identical for two deployments with the same surface and
   completely different capabilities.
2. **Identity is not expressible.** The customer-input enum is built from the surface policy, so `ORDER_NUMBER`, `PHONE`,
   `ADDRESS`, `EMAIL` and `NAME` are not in the schema on any surface — and the validator refuses them anyway, for plans
   that arrive from a replay or a fixture.
3. **A capability this deployment cannot use is still offered** to the planner (`ENTITY.ORDER` with no order bound,
   `PROCEDURE.ORDER_ACTION` with no executor). The validator records the gap; nothing is substituted.

**The validator's rules** (each with a violation code): need ids in order, non-empty ask, 1–3 steps, at least one CLOSES,
no duplicate step, scope allowed for that capability, fields only on entity steps and only that capability's fields, an
entity step names its fields, a procedure declares its effect, only a procedure has one, a procedure that closes reads its
order first, dependencies point backwards, identity never asked, no bridge placeholder, no duplicate input. **Any violation
invalidates the whole plan** — the same fail-closed outcome as a planner that did not answer.

**Run artifacts** (`ResolutionPlannerRunner`): one row per call with `run_id`, `q`, `rep`, the prompt version, model and
effort, five fingerprints (`system_fp`, `schema_fp`, `input_fp`, `request_fp`, `registry_fp`), the raw answer, the failure
word, the parsed plan, the violations, the per-step availability, and the cost. The output file is created or the run
fails: `FileAlreadyExistsException`, never a silent overwrite.

## 3. Step 2 — offline validation (model 0)

**Metrics** (`tools/inquiry-need-eval/plan.mjs`, all frozen rows only):

| metric | what it counts |
|---|---|
| `authority_recall` | needs whose gold CLOSES authorities are all present in the plan |
| `missing_required_authority` | the needs where one is not, named |
| `order_misses` | **hard fail** — the gold names ENTITY.ORDER and the plan does not |
| `unnecessary_authority` | plans naming an authority the gold does not have in any role |
| `procedure_for_read` | the product owner's invariant, by name |
| `entity_scope_accuracy` | for every gold step the plan also names: same scope **and** same fields |
| `customer_input_correct` | exact set of inputs |
| `sequence_correct` | for needs with more than one acting step: same order and the same dependencies |
| `invalid_capability_selection` | a capability outside the registry |
| `need_count_match` | reported apart — a plan that splits a message differently is not scored as if its second need were the gold's second |

**The offline run.** `InquiryNeedEvalIT EVAL_PLANNER_CAPTURE` produced the planner's inputs for the 67 canonical cases on a
throwaway S0 copy (`eval-store:inquiry-planner-capture/v1`, 67 rows). The harness then ran in **oracle** mode — the gold
plan stands in for the model — against the **real registry snapshots**:

| | |
|---|---|
| rows / model calls | 67 / **0** |
| plans that failed validation | **0** (0 violations of any code) |
| gold validation errors | **0** |
| need alignment | 67/67 cases, need counts match |
| authority recall · entity+scope · customer inputs | **1.00 · 1.00 (90 steps) · 1.00** |
| sequence | **11/11** needs with more than one acting step |
| step availability on S0 | 69 available · 8 `UNBOUND` · 7 `NOT_EXECUTABLE` · 6 `NOT_SUPPORTED` |

This is a pipeline proof, not a quality claim: it shows every frozen gold plan parses, satisfies the contract, and is legal
for the situation it belongs to — and that the scorer reads it the way the gold means it. Artifacts:
`eval-store:runs/wp2-oracle-S0/` (capture, observations, score).

**The v2 bridge against the adjudicated gold**: authority agreement **64/72 (88.9%)**. The eight disagreements are the v2
bridge's known limits, all in the safe direction (none of them closes a need): four order remedies v2 typed
SELLER_DECISION, `f81ad84a` (a read v2 typed ORDER_ACTION), `ae41a418` n1 (listing state typed CATALOGUE_AVAILABILITY), and
`f403e606` n2 + `N6` (teachable knowledge v2 typed SELLER_DECISION). The planner is what fixes them.

## 4. Synthetic coverage — what the DEV set cannot show

The 67 real cases contain no resolved order state and no executable procedure, so those paths are covered synthetically
(`contracts/inquiry-planner/v1/synthetic/planner-scenarios.jsonl`, 20 scenarios; no customer text):

| requested by the product owner | scenario |
|---|---|
| read-only order status | **P01** Cafe24 exact read, fresh → available, ends at ENTITY_STATE |
| tracking lookup | **P02** → `NOT_SUPPORTED` (no source in this repository reads tracking) |
| address change | **P03** procedure + order precondition → `NOT_EXECUTABLE` |
| cancellation | **P04** procedure, and the stored order cannot even prove the precondition |
| missing linked order | **P05** public Q&A → `UNBOUND`, and no identity is asked |
| unavailable procedure | **P03 · P04 · P06** |
| public Q&A identity request prohibition | **V03** → refused `IDENTITY_INPUT` |

Plus: variant-dependent knowledge with an option input (P07), catalogue-wide availability (P08), listing option state
(P09), a teachable company policy (P10), two needs in one message (P11), restock timing as a seller decision (P12); and
seven more invalid plans — a procedure used for a read (V01), a procedure that never reads its order (V02), a company rule
claimed to be about this order (V04), fields in the wrong place (V05), nothing closing the need with a forward dependency
(V06), the bridge placeholder with an out-of-order id (V07), an effect on a step that changes nothing (V08).

## 5. Tests

- **Java** (`inquiry.resolution` + planner harness): 15 — validator scenarios (12 valid plans with their availability, 8
  refused plans, no substitution), strict-schema shape, registry-bound enums, identity not expressible, payload floor,
  instruction contract, parser strictness, vocabulary agreement; harness integrity — oracle reproduces the gold,
  fingerprints separate and join, replay refuses drift, the cap holds, no overwrite.
- **Node**: 38 — plan gold validation and every metric worked out by hand, plus the eval store (including append-only run
  artifacts).
- **Full backend suite**: 4,490 tests, 0 failures (54 skipped — the gated integration entry points, including this package's).

## 6. Run storage and backup

`tools/eval-store/store.mjs` gained `run-put` / `run-verify` / `runs`:
- `runs/<run-id>/` is **append-only** — a file may be added, an existing file is never replaced, and no `RUN.json` entry is
  rewritten.
- Raw model answers are marked `irreproducible`: a re-run produces a different artifact, never that one.
- The rule for a live run is: **put the raw answers in before scoring them.** A score can be recomputed; an answer cannot.
- The redaction gate now ignores hex digests before matching (a sha256 contains digit runs that read as a phone number —
  measured: 54 of 67 fingerprints in the planner capture).
- `tools/eval-store/README.md` carries the off-machine backup runbook: one archive, a hash list, `age`/`gpg` encryption, the
  plaintext archive deleted, and a restore that is verified — a backup nobody has restored is a claim, not a backup.

## 7. Estimated calls, tokens and latency

Measured request sizes (no model): v3 planner body **5,269–5,650 bytes** (p50 5,309), of which the instruction is 3,385 and
the schema 1,436; the user turn is ~254 bytes. Using the ratio from v2's measured plan call (2,345 bytes ⇒ 430 input
tokens, `inquiry_decision_v2.md` §7-A):

| | estimate | basis |
|---|---|---|
| input tokens / call | **≈ 950–1,050** | measured bytes ÷ v2's measured bytes-per-token |
| output tokens / call | ≈ 120–250 (cap 1,600) | one to two needs of closed tokens plus the asks |
| latency p50 / p95 | **≈ 2.0–2.6s / 3.5–4.5s** | v2 plan 1.7–1.8s at 430 in / ~100 out; v2 judge 1.65–2.05s at 1.2–1.5k in |
| smoke | 3 calls ≈ 3k input tokens | §9 |
| shadow (67 × 3) | 201 calls ≈ 200k input / 30–50k output | stability needs repetitions |

**These are extrapolations, not measurements.** The first measured numbers come from the smoke run.

## 8. What WP-2 did not do

- **No shadow wiring in production.** No production path calls the planner: the shadow runs beside v2 **on captures**, in
  the harness. When a production trace is wanted it is its own change, and the planner output will sit beside the v2 result
  as a trace and change no Case.
- No Knowledge Extractor (WP-3), no procedure executor, no change to the judge, its prompt or the draft.
- The authority fence stays default OFF.
- `need_count_match` alignment is positional; a planner that splits a message differently is reported, not re-aligned by
  similarity. That is a scorer limit, recorded rather than papered over.

## 9. Smoke — 3 calls, approval manifest

Before any 67 × 3 shadow run, one 3-call smoke run answers a single question: **does the vendor accept this strict schema
and return a plan this parser and validator read?** It uses three synthetic questions — no customer text.

```
APPROVAL MANIFEST — Inquiry v3 WP-2 planner smoke
  approvalId        apr-6f0b3c21
  runId             wt-3d9ac47e
  capability        sellerops.inquiry-decision (the v2 door; prompt resolution-planner/v1)
  model             gpt-5-2025-08-07 · reasoning_effort minimal · response_format json_schema (strict)
  operation         3 planner calls, one each for synthetic scenarios P01, P03, P07
  inputs            contracts/inquiry-planner/v1/synthetic/planner-scenarios.jsonl (synthetic; no customer text)
  cap               PLAN_MAX_CALLS=3 — the harness throws on the 4th
  marketplace       none · DB writes none · external writes none
  output            eval-store:runs/wp2-smoke/ (append-only, raw answers marked irreproducible)
  expected spend    ≈3k input / ≈0.5k output tokens
  revoked by        any code, branch, model, prompt or schema change
```

Run command (model mode is refused without the key and the cap):

```bash
# 1. the inputs, generated from the committed fixture into a path outside the repository
node tools/inquiry-need-eval/smoke-inputs.mjs > "$WORK/smoke-inputs.jsonl"

# 2. three calls, capped
RUN_RESOLUTION_PLANNER_CAL=true PLAN_MODE=model PLAN_MAX_CALLS=3 PLAN_REPEATS=1 PLAN_RUN_ID=wp2-smoke \
PLAN_INPUTS="$WORK/smoke-inputs.jsonl" PLAN_OUT="$WORK/wp2-smoke.jsonl" \
SELLEROPS_INQUIRY_DECISION_API_KEY=… ./gradlew test --tests '*ResolutionPlannerCalibrationIT'

# 3. the raw answers into the store BEFORE they are scored
node tools/eval-store/store.mjs run-put wp2-smoke "$WORK" --irreproducible --note "planner smoke, apr-6f0b3c21"
```

**Pass** = 3 answers, 0 envelope failures, 0 parse failures, 0 contract violations, and each plan's closing authority is the
one the scenario expects. **Fail** = the schema or the instruction is revised and the smoke is repeated; the 67 × 3 shadow
run does not start until the smoke passes, and it needs its own manifest.

---

## 10. Smoke run — `apr-6f0b3c21` / `wt-3d9ac47e` (2026-09-20, consumed)

3 planner calls, synthetic questions only (P01 · P03 · P07), `gpt-5-2025-08-07` @ `minimal`, strict `json_schema`,
prompt `resolution-planner/v1`, cap 3. Marketplace 0 · DB writes 0 · customer text 0. Raw answers stored **before** they
were scored: `eval-store:runs/wp2-smoke/` (marked irreproducible).

| | P01 read-only order status | P03 address change | P07 variant-dependent fact |
|---|---|---|---|
| answered · envelope · parse | yes · ok · ok | yes · ok · ok | yes · ok · ok |
| closing authority | `ENTITY.ORDER` ✔ | `PROCEDURE.ORDER_ACTION` ✔ | `KNOWLEDGE.PRODUCT` ✔ |
| contract | **valid** | **refused** — 3 violations | **valid** |
| plan | `ENTITY.ORDER/CLOSES` fields `FULFILLMENT`+`TRACKING` | order read → procedure → policy as context | knowledge, asking SIZE · MODEL · MEASUREMENT |
| ms · in · out | 2,631 · 1,221 · 89 | 1,925 · 1,216 · 156 | 1,782 · 1,218 · 93 |

**Verdict: the pre-registered bar was not met** — it required zero contract violations and one plan had three.

**What the smoke actually proved.** The vendor accepts the strict registry-bound schema; the parser read every answer; the
three plans chose the **right authorities**, including the invariant this package exists for — the read-only status
question ended at `ENTITY.ORDER`, and only the address change became a `PROCEDURE` (with its order precondition and the
policy as context, unprompted).

**Why P03 was refused — the instruction, not the model.** Its three violations are clerical, and both causes are rules the
v1 instruction never stated:

1. it copied `fields: [ORDER_FULFILLMENT]` onto the `PROCEDURE` step (`FIELDS_ON_NON_ENTITY`, `FIELD_OF_OTHER_CAPABILITY`);
2. it set `depends_on: 1` on step index 1 — "depends on step 1" in 1-based counting, where the contract means the 0-based
   index of an **earlier** step (`BAD_DEPENDENCY`).

**Closed without another call.** The instruction is now `resolution-planner/v2`, with the two rules said out loud
(non-entity steps carry an empty `fields`; `depends_on` is the 0-based index of an earlier step, first step `null`, never
itself or a later one). The validator was **not** loosened: a step whose meaning is fine but whose shape breaks the
contract still invalidates the plan, fail-closed. The smoke's exact answer is pinned as scenario **V09**, so this shape can
never pass silently again.

**Measured, against the estimates in §7**: input **1,216–1,221** tokens per call (estimate was 950–1,050 — the estimate was
low by ~17%; Korean instruction + JSON schema tokenise worse than the v2 ratio suggested), output 89–156 (estimate
120–250, right), latency **1.78–2.63s** (estimate p50 2.0–2.6s, right). For the 67 × 3 shadow run this means ≈201 calls,
≈245k input / ≈25k output tokens.

## 11. Next — smoke #2, then the shadow run

The prompt changed, so the previous approval is revoked by its own terms. Smoke #2 is the same shape with the corrected
instruction:

```
APPROVAL MANIFEST — Inquiry v3 WP-2 planner smoke #2
  approvalId        apr-2c84f7b0
  runId             wt-91e5d63a
  capability        sellerops.inquiry-decision (v2 door; prompt resolution-planner/v2)
  model             gpt-5-2025-08-07 · reasoning_effort minimal · response_format json_schema (strict)
  operation         3 planner calls — the same synthetic scenarios P01, P03, P07
  cap               PLAN_MAX_CALLS=3
  marketplace       none · DB writes none · external writes none · customer text none
  output            eval-store:runs/wp2-smoke-2/ (append-only, raw answers irreproducible)
  expected spend    ≈3.7k input / ≈0.5k output tokens
  pass              3 answers · 0 envelope/parse failures · 0 contract violations · each closing authority as expected
  revoked by        any code, branch, model, prompt or schema change
```

Only after it passes does the 67 × 3 shadow run get its own manifest (≈201 calls, plan gold v3.1 as the scorer's
reference, no production Case touched).

## 12. Smoke #2 — `apr-2c84f7b0` / `wt-91e5d63a` (2026-09-20, consumed) — **PASS**

Same three synthetic questions, prompt `resolution-planner/v2`, `gpt-5-2025-08-07` @ `minimal`, strict `json_schema`, cap 3.
Marketplace 0 · DB writes 0 · customer text 0. Raw answers stored before scoring: `eval-store:runs/wp2-smoke-2/`.

| | P01 read-only order status | P03 address change | P07 variant-dependent fact |
|---|---|---|---|
| answered · envelope · parse | yes · ok · ok | yes · ok · ok | yes · ok · ok |
| contract | **valid** | **valid** | **valid** |
| closing authority | `ENTITY.ORDER` ✔ | `PROCEDURE.ORDER_ACTION` ✔ | `KNOWLEDGE.PRODUCT` ✔ |
| plan | fields `FULFILLMENT`+`TRACKING` | order read (fields `FULFILLMENT`) → procedure, **fields empty, `depends_on: 0`** | knowledge, asks SIZE · MODEL · MEASUREMENT |
| availability recorded | `NOT_SUPPORTED` (no tracking source) | precondition ok · procedure `NOT_EXECUTABLE` | ok |
| ms · in · out | 2,452 · 1,331 · 90 | 1,926 · 1,326 · 116 | 1,729 · 1,328 · 93 |

**Pass on every pre-registered criterion**: 3 answers, 0 envelope failures, 0 parse failures, **0 contract violations**, each
closing authority as the scenario expects. The two clerical faults of smoke #1 are gone — the instruction was what was
missing, and saying it fixed it.

**Two observations worth recording, neither a failure.**

1. **P03 called the address change `BOUNDED_WORKFLOW`; the gold says `EXTERNAL_STATE_CHANGE`.** Both satisfy the contract
   (a procedure declares a non-NONE effect) and both resolve identically today — there is no executor either way. The
   scorer does **not** compare `effect`, so this would not show up in a shadow score. Added to the shadow run as a
   diagnostic to report, not as a pass criterion: if the two values never separate in practice, the honest move later is
   one value, not two.
2. **P01 asks for tracking as well as fulfilment**, which the registry answers with `NOT_SUPPORTED`. That is the design
   working: the plan states what the need requires, and the gap is recorded rather than the plan being trimmed to what this
   deployment happens to have.

**Measured with the v2 instruction**: input **1,326–1,331** tokens (v1 was 1,216–1,221; the two added rules cost ~110
tokens), output 90–116, latency **1.73–2.45s**.

## 13. Next — the shadow run

```
APPROVAL MANIFEST — Inquiry v3 WP-2 planner shadow (67 × 3)
  approvalId        apr-e7d1b459
  runId             wt-5a0c82f1
  capability        sellerops.inquiry-decision (v2 door; prompt resolution-planner/v2)
  model             gpt-5-2025-08-07 · reasoning_effort minimal · response_format json_schema (strict)
  operation         201 planner calls — the 67 canonical questions of inquiry-planner-capture/v1, 3 repetitions each
  inputs            eval-store:inquiry-planner-capture/v1 (pinned by PLAN_INPUTS_SHA256)
  cap               PLAN_MAX_CALLS=201 — the harness throws on the 202nd
  marketplace       none · DB writes none · external writes none · no production Case touched
  output            eval-store:runs/wp2-shadow/ (append-only, raw answers irreproducible), raw stored before scoring
  expected spend    ≈267k input / ≈25k output tokens · ≈7 minutes wall clock
  scored against    plan gold v3.1 (all 72 rows frozen) — authority recall, missing/unnecessary authority, order miss,
                    procedure-for-read, entity+scope, customer inputs, sequence, invalid capability, need-count match,
                    run-to-run agreement across the 3 repetitions, and the `effect` diagnostic above
  revoked by        any code, branch, model, prompt or schema change
```

This is the measurement WP-2 exists for: the first evidence of whether the planner chooses the right authority on real
customer messages. It changes no production Case — the planner runs beside v2 on captures only.

## 14. Shadow run — `apr-e7d1b459` / `wt-5a0c82f1` (2026-09-20, consumed) — the first measurement

67 canonical questions × 3 repetitions = **201 calls**, prompt `resolution-planner/v2`, `gpt-5-2025-08-07` @ `minimal`,
strict `json_schema`, inputs pinned to `inquiry-planner-capture/v1` (`5850421b…`). No production Case was touched;
marketplace 0 · DB writes 0. Raw answers stored before scoring: `eval-store:runs/wp2-shadow/`.

**Cost**: 270,069 input / 36,076 output tokens · p50 **1,725ms** · p95 3,937ms · max 12,478ms · **7m25s** wall clock.
(§7 estimated ≈267k input — right; ≈25k output — low by a third.)

### 14-A. The authority decision is strong

| | rep 1 | rep 2 | rep 3 |
|---|---|---|---|
| **authority recall** (cases where the planner split the message the same way the gold does) | **1.000** | **1.000** | **1.000** |
| order misses, those cases | **0** | **0** | **0** |
| `procedure_for_read` — the product owner's invariant, all 201 plans | **0** | **0** | **0** |
| entity + scope accuracy, matched cases | 0.927 | 0.818 | 0.974 |

Read against the whole set with positional alignment the same numbers are 0.958 / 0.972 / 0.931 with 1–2 order misses —
**those misses are alignment artefacts**, not decisions: they appear only where the planner split the message into more
needs than the gold, so the gold's need *i* is compared with a different question. The matched-case column is the honest
one, and the scorer's positional alignment is now the measurement's binding limit (§14-D).

The confusion matrix on matched cases (rep 1) shows what it actually did: KNOWLEDGE → KNOWLEDGE 28 · SELLER → SELLER 3 ·
ENTITY_STATE → ENTITY_STATE 2 · PROCEDURE → KNOWLEDGE+PROCEDURE 1 · **KNOWLEDGE → KNOWLEDGE+SELLER 8** ·
KNOWLEDGE → ENTITY_STATE+KNOWLEDGE+SELLER 1. It never substituted a policy for an order's state, and never made a read
into a procedure.

### 14-B. Plan shape is where it is weak — four named causes

| what | count | cause |
|---|---|---|
| **contract-invalid plans** | **20 / 201 (10%)** | below |
| `FIELDS_ON_NON_ENTITY` + `FIELD_OF_OTHER_CAPABILITY` | 15 + 15 | **all on `KNOWLEDGE.CATALOGUE` steps.** Strict Structured Outputs requires every property on every step, so `fields` must be emitted even where it is meaningless, and the model sometimes fills it. This is a **schema shape** problem, not an instruction one: the fix is one step shape per capability class (`anyOf`), so a knowledge step has no `fields` property to fill |
| `PROCEDURE_WITHOUT_ORDER_PRECONDITION` | 4 | a procedure planned without reading its order first |
| `SCOPE_MISMATCH` | 4 | **all `SELLER → COMPANY`** — the seller's own judgment labelled as a company-wide scope |
| `BAD_DEPENDENCY` | 1 | down from smoke #1's shape, but not gone |
| **a SELLER closer added beside KNOWLEDGE** | 8 / 43 matched needs | the instruction says handing to the seller is not a step; the model still plans it as one. It is the main driver of `unnecessary_authority` (10–14 per rep) |
| **over-asking the customer** | 36 over-asked · **0 under-asked** · 31 exact | the planner asks for product context the gold does not need. Direction matters: it never fails to ask, it asks too often |
| **over-splitting needs** | 27 / 67 more needs than gold · **0 fewer** | never merges two questions into one; sometimes splits one into two |

### 14-C. Run-to-run agreement at three levels

| identical across all three repetitions | |
|---|---|
| need count | **41 / 67** |
| closing authorities (multiset) | **27 / 67** |
| the whole plan, token for token | **12 / 67** |

The decision is far stabler than its shape. For a planner whose output feeds deterministic resolvers this is the right way
round, but 27/67 on the authority multiset is still low, and it is inflated by the SELLER-beside-KNOWLEDGE habit above.

### 14-D. The `effect` diagnostic, as promised in §12

Across 201 plans the model wrote `BOUNDED_WORKFLOW` **38** times and `EXTERNAL_STATE_CHANGE` **4**. The gold uses
`EXTERNAL_STATE_CHANGE` for every procedure. Nothing downstream separates them — there is no executor either way — and the
model clearly does not read them as the gold does. **Recommendation: collapse `effect` to one value** (`PROCEDURE` means a
change or a workflow, full stop) and keep the rule that a procedure must declare it. A distinction nobody acts on and
nobody agrees about is a distinction that will be scored one day and mean nothing.

### 14-E. What this changes for WP-3

> **Done in `docs/inquiry_architecture_v3_wp3.md` (2026-09-20, no model call).** All five items below were taken up.
> That package also corrects three figures on this page, from the same frozen observations: the contract-violation
> total is **39 across 20 rows**, not 34; seller-closing needs are **31 distinct (case, need) pairs**, not 8 of 43
> (which was rep 1, matched needs only); and `procedure_for_read` is **not 0** — `R:4181864b.n1` fails it in all
> three repetitions, visible only once goals rather than positions are compared. Under-asking is likewise not 0.


1. **Schema by capability class** (`anyOf`) — removes 30 of the 34 violations at the root, without loosening the validator.
2. **A semantic need alignment** in the scorer (or a gold that accepts a split), so the headline is not hostage to
   positional matching. Today only 43 of 67 cases can be scored cleanly.
3. **The seller is not a step** — restate in the instruction and add a validator code for a SELLER step planned beside a
   closing KNOWLEDGE step, so the habit is refused rather than merely scored.
4. **Over-asking** deserves its own metric before it becomes a product behaviour: asking a customer for a size they did not
   need to give is a real cost, and it is invisible in `customer_input_correct`'s single rate.
5. Collapse `effect` (§14-D).

None of these needs a model call to build; the next run measures whether they worked.
