# Inquiry Architecture v3 — WP-4: Planner Final Validation & Freeze Gate

> **Status: baseline pinned · 3-call smoke PASSED · 67×1 shadow manifest presented, not run.**
> 3 planner model calls (approved, capped, synthetic fixtures only). Marketplace 0 · DB writes 0 ·
> migrations 0. Production is still v3 OFF. **The planner is not frozen** — the freeze gate is the 67×1
> shadow, which has not run.

This package does not try to make the planner better. It asks one question — *do the authority semantics
WP-2 measured survive the WP-3 contract?* — and, if the answer is yes, freezes the Resolution Planner
architecture so WP-4 E2E can start against something that stops moving.

Predecessors: [WP-1/2](inquiry_architecture_v3_wp2.md) · [WP-3](inquiry_architecture_v3_wp3.md).

---

## 1. Immutable baseline

Everything below was derived at `66384bb5` in the `decision-workspace` worktree, with **zero model calls**.

### 1.1 How the request fingerprints were obtained without calling anything

`ResolutionPlannerRunner` records five fingerprints on every row — system, vendor schema, input (the user
turn), request (the whole body) and the registry snapshot — and it records them *before* it knows whether a
call happened. So running the harness in `PLAN_MODE=oracle` against an **empty gold file** builds the exact
request the model door would send, fingerprints it, and lands on `failure: NO_ORACLE_PLAN` having reached no
transport at all. That is the whole measurement: no new code, no new tool, and the fingerprints are the same
bytes the live run will report.

### 1.2 Pinned values

| what | value |
|---|---|
| commit | `66384bb5` (`feat/review-decision-workspace-v1`) |
| prompt | `resolution-planner/v3` |
| model · effort · format | `gpt-5-2025-08-07` · `minimal` · strict `json_schema` |
| **system prompt** | `938af14fc8a37948152be9f93db71a2a640866a2bdf3718d5941c38a1633c82b` |
| **vendor schema** | `c0419e7144c715030c0aafa00b99dc0f7c9736c4392e9ec8481ef64eb0ed51ac` |
| capability vocabulary | `63fad3167936846517e0c3e5fbfadc10aca7710e3e8d698a1f6afe7049a911f7` |
| planner scenarios v2 | `e60cb3ea648b990a2919c115c9d6ded79723c633f3ccb35f24eb66a5fb5a79fb` |
| gold `inquiry-resolution-plan/v3.2` | `ff20922e3f05307e6ca6cbfe8aa94737029a93e453e6a8398a6a4476f4ed0bb9` — 67 cases, 72 goals, `verify → ok` |
| WP-2 shadow `70786fe4` | `runs/wp2-shadow`, `run-verify → ok` |
| WP-2 smoke | `runs/wp2-smoke-2`, `run-verify → ok` |
| WP-3 derived replay | `runs/wp3-offline`, `run-verify → ok` |
| this baseline | `runs/wp4-baseline`, `run-verify → ok` (append-only, new run id) |

**The vendor schema hash is snapshot-independent.** P01 (Cafe24, order-bound, exact lookup) and P07 (NAVER
public Q&A, stored-only, 5 variants) have different `registry_fp` and the *same* `schema_fp`: the `anyOf`
branch set is generated from the capability declarations, not from what this situation can do. What the
situation can do stays where it was — in the user turn and in `StepAvailability`.

### 1.3 The comparison is controlled

The smoke inputs regenerate byte-identical to the ones the WP-2 smoke consumed
(`57f49beb5f4b519eacb90db5707a169573ba280e7d78ffa258537f7a1e2b7c8f`), and against that recorded run:

| fingerprint | WP-2 (`resolution-planner/v2`) → WP-4 baseline (`v3`) |
|---|---|
| `input_fp` (all three) | **SAME** |
| `registry_fp` (all three) | **SAME** |
| `system_fp` | changed |
| `schema_fp` | changed |
| `request_fp` (all three) | changed |

WP-3 claimed `ResolutionPlannerPrompt.user()` was left byte-identical so the payload floor would not move.
That claim is now checked against a recorded run rather than asserted: **the question and the registry facts
are the same bytes; only the instruction and the schema moved.** Any difference the smoke finds is
attributable to the contract, not to what the model was asked about.

### 1.4 One correctness fix, found while pinning

`tools/inquiry-need-eval/smoke-inputs.mjs` was still reading
`contracts/inquiry-planner/**v1**/synthetic/planner-scenarios.jsonl` — the file WP-3 retired — while the
harness integrity test had moved to v2. It produced the right rows today only because the three `smoke: true`
rows happen to be identical in both files, so the defect was latent: the next edit to a smoke scenario would
have been silently ignored by the generator that feeds the live run. Pointed at v2; output verified
byte-identical, so the pinned input hash above is unaffected.

---

## 2. §5 re-verification — effect is out of planner evaluation

The brief asks for this boundary to be re-checked in the docs *and* in the tests before the gate runs. It
holds in four independent places:

| where | what is pinned |
|---|---|
| wire | `ResolutionPlanParser` returns `PLAN_SHAPE` for any step carrying `effect` or `depends_on` (`ResolutionPlannerContractTest.parser`) |
| vendor schema | no `anyOf` branch declares `effect` — asserted per capability (`shapePerCapability`) |
| instruction | `system` contains no `effect=`, no `BOUNDED_WORKFLOW`, no `EXTERNAL_STATE_CHANGE`, no `depends_on` |
| registry | every capability's `effect` agrees between `CapabilityId.effect()` and the vocabulary file; `BOUNDED_WORKFLOW` producers = 0 (`AuthorityVocabularyContractTest.effectIsTheRegistrys`) |

And in the scorer that WP-4 will use: **`tools/inquiry-need-eval/goals.mjs` contains the word `effect`
zero times.** There is no effect term to remove from the metric, because the split-tolerant scorer never had
one. `contract.mjs` mentions effect only to *refuse* it on the wire and to count it when projecting WP-2
shapes forward; `plan.mjs` still validates effect because it is the frozen WP-2 baseline scorer reading v3.1
gold, and it is not used to score this gate.

Green at baseline: backend `inquiry.authority` + `inquiry.resolution` + harness integrity — pass;
`tools/inquiry-need-eval` — 62 tests, 0 failures (eval 9, goals 21, judge 12, mutations 12, plan 8).

---

## 3. Approval manifest — smoke, 3 planner calls  *(approved in-turn, consumed)*

```
APPROVAL MANIFEST — Inquiry v3 planner smoke under resolution-planner/v3
  purpose           does the vendor accept the per-capability anyOf schema, and do the three
                    authority decisions WP-2 measured survive the WP-3 contract
  scope             3 planner calls, synthetic fixtures only
  inputs            P01 · P03 · P07 from contracts/inquiry-planner/v2/synthetic/planner-scenarios.jsonl
                    (smoke: true), regenerated to a path outside the repository
  inputs sha256     57f49beb5f4b519eacb90db5707a169573ba280e7d78ffa258537f7a1e2b7c8f  (pinned;
                    PLAN_INPUTS_SHA256 makes the harness refuse a moved capture)
  commit            0af96549   (execution pin; the baseline in §1 was derived at 66384bb5 and
                    all five fingerprints were re-derived unchanged at 0af96549)
  prompt            resolution-planner/v3   system_fp 938af14f…  schema_fp c0419e71…
  model             gpt-5-2025-08-07
  reasoning_effort  minimal
  output format     strict json_schema
  mode              PLAN_MODE=model, PLAN_REPEATS=1, PLAN_MAX_CALLS=3   (hard cap; the harness
                    throws on the 4th send and refuses model mode without the key and the cap)
  marketplace calls 0
  DB writes         0
  external writes   0
  production Cases  0
  real customer text 0        (every question is a committed synthetic fixture)
  judge / draft     0 calls
  retrieval         0
  output            eval-store:runs/wp3-smoke/ — new run id, append-only; raw answers stored and
                    marked irreproducible BEFORE anything is scored
  expected spend    ≈3k input / ≈0.5k output tokens
  revoked by        any code, branch, model, prompt, schema or input change
```

Run command:

```bash
# 1. inputs, generated from the committed fixture into a path outside the repository
node tools/inquiry-need-eval/smoke-inputs.mjs > "$WORK/smoke-inputs.jsonl"

# 2. three calls, capped, with the capture pinned
RUN_RESOLUTION_PLANNER_CAL=true PLAN_MODE=model PLAN_MAX_CALLS=3 PLAN_REPEATS=1 PLAN_RUN_ID=wp3-smoke \
PLAN_INPUTS="$WORK/smoke-inputs.jsonl" PLAN_OUT="$WORK/wp3-smoke.jsonl" \
PLAN_INPUTS_SHA256=57f49beb5f4b519eacb90db5707a169573ba280e7d78ffa258537f7a1e2b7c8f \
SELLEROPS_INQUIRY_DECISION_API_KEY=… ./gradlew test --tests '*ResolutionPlannerCalibrationIT'

# 3. raw answers into the store BEFORE they are scored
node tools/eval-store/store.mjs run-put wp3-smoke "$WORK" --irreproducible --note "planner smoke, resolution-planner/v3, apr-…"
```

### 3.1 Pass bar, registered before the run

Taken from the fixture's own plans, not decided afterwards:

| | P01 — read-only order status | P03 — address change | P07 — variant-dependent fact |
|---|---|---|---|
| registry | Cafe24, order-bound, `EXACT_ALLOWED` | Cafe24, order-bound, `EXACT_ALLOWED` | NAVER public Q&A, `STORED_ONLY`, 5 variants |
| closing authority | `ENTITY.ORDER` | `PROCEDURE.ORDER_ACTION` | `KNOWLEDGE.PRODUCT` |
| preceding step | — | `ENTITY.ORDER` as `PRECONDITION` | — |
| must **not** contain | any `PROCEDURE` step | — | a `SELLER` closer |
| customer inputs | none | none | `OPTION` (the answer varies by variant) |
| availability recorded | `null` | `null`, then `NOT_EXECUTABLE` | `null` |

Pass = all of: **3/3 answered · 0 envelope failures · 0 parse failures · 0 contract violations ·
3/3 authority sets equal to the row above · 0 forbidden identity inputs.**

On the last one, a precision worth stating now rather than claiming later: identity inputs
(`ORDER_NUMBER`/`PHONE`/`ADDRESS`/`EMAIL`/`NAME`) are **not members of the schema's `customer_inputs`
enum at all** — `ResolutionPlannerPrompt.askableInputs` admits only `PRODUCT_CONTEXT` values. So a zero here
is a structural property of the request under strict mode, and the run's job is to confirm the vendor honours
the enum, not to discover whether the model behaves. `ResolutionPlanValidator.IDENTITY_INPUT` still exists
behind it, because the domain refuses identity independently of whatever the schema happens to allow.

`NOT_EXECUTABLE` on P03's procedure is the expected answer and not a failure: there is no procedure executor
in v3.0, the plan says what the need *requires*, and the validator records the gap without the plan adjusting
itself around it.

### 3.2 If the smoke fails

No 67-case manifest is presented, and no second model call is made without a new approval. The failure is
reported classified as exactly one of: **contract** (the shape the parser or validator refused) ·
**schema** (the vendor rejected or mis-filled the `anyOf`) · **prompt** (the instruction no longer says
something the model needs) · **semantic** (the authority choice itself changed). Only the first two are
candidates for touching the planner architecture.

---

## 4. Smoke result — `wp3-smoke`, commit `0af96549` (consumed)

3 calls / cap 3. Raw answers stored before anything was scored: `eval-store:runs/wp3-smoke/`, marked
irreproducible, `run-verify → ok`. 4,396 input / 227 output tokens, **0 reasoning tokens**, 2.1–2.9 s each.

### 4.1 The registered bar

| | P01 order status | P03 address change | P07 variant fact |
|---|---|---|---|
| answered · envelope · parse | yes · ok · ok | yes · ok · ok | yes · ok · ok |
| contract violations | **0** | **0** | **0** |
| closing authority | `ENTITY.ORDER` ✔ | `PROCEDURE.ORDER_ACTION` ✔ | `KNOWLEDGE.PRODUCT` ✔ |
| preceding step | — ✔ (no procedure) | `ENTITY.ORDER` PRECONDITION ✔ | — ✔ (no seller closer) |
| forbidden identity inputs | 0 ✔ | 0 ✔ | 0 ✔ |

**PASS on all six registered conditions.** The vendor accepts the per-capability `anyOf` schema, fills it
in strict mode with `finish=stop`, and the three authority decisions WP-2 measured survive the WP-3 contract
unchanged. The v2→v3 shape rewrite cost nothing in authority semantics on these three.

### 4.2 What the plans show that the bar did not name

Two things, both reported rather than quietly passed.

**(a) P01's answerable order question became a capability gap — and the smoke proves the cause by itself.**
The model closed P01 with `ENTITY.ORDER` reading `["ORDER_FULFILLMENT", "ORDER_TRACKING"]`. The gold asks
for `ORDER_FULFILLMENT` alone. `ORDER_TRACKING` is not supported on this channel, and
`ResolutionPlanValidator.gapOf` ends with an **all-or-nothing clause** — *if any named field is unavailable,
the whole step is `NOT_SUPPORTED`* — so P01's availability came back `NOT_SUPPORTED` where the fixture
expects `null`.

The proof needs no extra run: **P01 and P03 have the same `registry_fp` (`df43f26e…`)** — same channel, same
snapshot, same capability, same order binding. P03's `ENTITY.ORDER` step names only `ORDER_FULFILLMENT` and
its gap is `null`. The single difference between a readable step and an unreadable one is the extra field.

This is exactly the mechanism WP-3 named and measured (`ORDER_TRACKING` added 42 times in 201 calls where
the gold did not ask) and then recorded as *"mechanism real, **zero** resolvable goals flipped in this set,
kept as a mechanism to watch."* **In this smoke it flipped one** — and it flipped the most basic read-only
order question there is. The mechanism is no longer hypothetical.

Two things compound here and they are not the same defect:

* the planner **over-reads** — it names a field the need does not require;
* the availability contract **cannot express partial readability** — `StepAvailability` already carries
  `unavailableFields`, which holds the precise truth (`[ORDER_TRACKING]`), but `gapOf` collapses it to a
  single verdict about the whole step, and `ResolutionPlannerRunner.row` does not even serialise
  `unavailableFields`, so a reader of a recorded row cannot tell a fully-blocked step from an over-read one.

Consequence if it generalises: an answerable question is reported as a gap, which in WP-4 E2E terms is a
**handoff that did not need to happen** — safe, but wasteful, and it would inflate the "unresolved required
goal" figure that freeze-gate item 5 is about.

**It is deliberately not fixed before the shadow.** Fixing a contract on n=1 is the trap this programme
keeps avoiding, and the frequency is the thing worth knowing. It costs nothing to defer, because the
correction can be applied afterwards **without calling the model again**: `PLAN_MODE=replay` re-reads the
recorded raw answers with the *current* parser and validator and refuses any row whose rebuilt user turn does
not hash to the recorded `input_fp`. So the 67 raw answers can be re-scored under a revised availability rule
for free, and provably about the same requests.

**(b) P07 asked four customer inputs; the gold asks one.** The model asked
`SIZE, MODEL, MEASUREMENT, USE_CONTEXT`; gold v3.2 says `OPTION`. So on this row required-input *token*
recall is 0/1 and the over-ask is 4 — the same shape WP-3 measured across 201 calls (required recall 1–2 of
5, unnecessary 87–98). Per the brief this is a **product UX issue for the tuning backlog, not a safety
blocker**, and the planner prompt is not being tuned here. One honest qualification: the asked set is not
empty and `SIZE`/`MODEL`/`MEASUREMENT` plausibly discriminate the same five variants that `OPTION` names, so
part of this figure may be a gold-token choice rather than a planner error — a category-C (scorer/gold)
candidate that the 67-case run is the right instrument to size.

---

## 5. Approval manifest — final planner shadow, 67 × 1

**Not approved. Not run.** Presented only because §4 passed.

**67 × 1, not 67 × 3.** WP-2 already bought three repetitions of the authority question and the answer was
stable across all three (recall 1.000 on matched goals). This run asks one different question — *did the
WP-3 schema change move the semantic judgment?* — and one pass answers it. A repeat is the remedy for a
stochastic one-off (category E), to be requested for named rows if any appear, not the default.

```
APPROVAL MANIFEST — Inquiry v3 final planner shadow under resolution-planner/v3
  purpose           does the authority semantics WP-2 measured survive the WP-3 contract at scale;
                    the input to the Planner Freeze Gate
  scope             67 planner calls (67 canonical cases x 1 repetition)
  commit            0af96549
  prompt            resolution-planner/v3   system_fp 938af14f…  schema_fp c0419e71…
  model             gpt-5-2025-08-07 @ minimal, strict json_schema
  mode              PLAN_MODE=model, PLAN_REPEATS=1, PLAN_MAX_CALLS=70
                    (67 + 3 harness margin; the harness throws on the 71st send)
  inputs            eval-store:runs/wp2-shadow/inputs-capture-S0.jsonl — the FROZEN capture WP-2 sent,
                    reused unchanged so the comparison is controlled
  inputs sha256     5850421be15897d15fc169de22daacf625d63892b12a725ffef1471f48470f8d
                    (pinned via PLAN_INPUTS_SHA256 — the harness refuses a moved capture)
  real customer text  YES — the canonical capture holds real customer questions. It lives outside the
                    repository and is not committed. This is the same text WP-2 sent to the same
                    vendor under the same capability; nothing new is exposed, and it is NOT zero.
  marketplace calls 0
  DB writes         0
  external writes   0
  production Cases  0
  judge / draft     0 calls
  retrieval         0
  output            eval-store:runs/wp4-shadow/ — new run id, append-only; raw answers stored and
                    marked irreproducible BEFORE anything is scored
  scoring           split-tolerant goal scorer (tools/inquiry-need-eval/goals.mjs) against frozen
                    gold inquiry-resolution-plan/v3.2 (ff20922e…). Effect exact-match: not computed
                    (the scorer has no effect term). Need-count exact match: not a headline metric.
  expected spend    ≈100k input / ≈6k output tokens (extrapolated from the smoke's per-call figures)
  revoked by        any code, branch, model, prompt, schema or input change
```

Run command:

```bash
RUN_RESOLUTION_PLANNER_CAL=true PLAN_MODE=model PLAN_MAX_CALLS=70 PLAN_REPEATS=1 PLAN_RUN_ID=wp4-shadow \
PLAN_INPUTS="$W/inputs-capture-S0.jsonl" PLAN_OUT="$W/wp4-shadow.jsonl" \
PLAN_INPUTS_SHA256=5850421be15897d15fc169de22daacf625d63892b12a725ffef1471f48470f8d \
SELLEROPS_INQUIRY_DECISION_API_KEY=… ./gradlew test --tests '*ResolutionPlannerCalibrationIT'
```

### 5.1 Freeze gate, registered before the run

Mandatory — all must hold:

1. wrong authority substitution = **0**
2. ORDER required-authority miss = **0**
3. `procedure_for_read` = **0**
4. forbidden identity input = **0**
5. unresolved required resolution goal = **0**, or explainable as a named annotation defect
6. contract / schema failure = **0** (target; ≥1 is classified before any freeze decision, and a
   reproduction of WP-2's 20-of-201 invalid rate means no freeze)
7. the authority semantics WP-2 recorded still hold under the WP-3 schema

Reported alongside, not gating: goal coverage, uncovered goal, planner-only extra goal, unnecessary
authority, entity/scope accuracy, sequence accuracy, the SELLER split (legitimate authority vs missing
knowledge vs capability gap vs operational handoff), and the customer-input breakdown.

**One metric added by §4.2(a):** the count of steps whose gap is caused *only* by an over-read field —
`gapOf` said `NOT_SUPPORTED` while `unavailableFields` is a strict subset of the step's fields. That
number decides whether the availability contract is a real defect or a one-off, and it is measured, not
assumed.

### 5.2 If the gate fails

Classified as exactly one of **A** schema/contract design · **B** authority semantic error ·
**C** scorer/gold ambiguity · **D** customer-input UX · **E** stochastic one-off. Only A and B are
candidates for changing the planner architecture; C is an eval fix, D is backlog, E is a targeted repeat of
named rows. **Re-running 67 × 3 is not the default remedy**, and the prompt is not tuned again.

Two things stay **non-blocking** by the brief's instruction: the `R:77a91fab` / `R:f403e606` goal-pair
ambiguity remains a documented scorer blind spot and is not adjudicated here, and over-asking is a product
UX issue — only under-asking that drops an input the resolution actually needs blocks.
