# Inquiry Architecture v3 — WP-4: Planner Final Validation & Freeze Gate

> **Status: baseline pinned, smoke manifest presented, nothing run.**
> No model call, no marketplace call, no DB write, no migration has happened in this work package.
> Production is still v3 OFF.

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

## 3. Approval manifest — smoke, 3 planner calls

**Not approved. Not run.** This is the only thing this work package asks for.

```
APPROVAL MANIFEST — Inquiry v3 planner smoke under resolution-planner/v3
  purpose           does the vendor accept the per-capability anyOf schema, and do the three
                    authority decisions WP-2 measured survive the WP-3 contract
  scope             3 planner calls, synthetic fixtures only
  inputs            P01 · P03 · P07 from contracts/inquiry-planner/v2/synthetic/planner-scenarios.jsonl
                    (smoke: true), regenerated to a path outside the repository
  inputs sha256     57f49beb5f4b519eacb90db5707a169573ba280e7d78ffa258537f7a1e2b7c8f  (pinned;
                    PLAN_INPUTS_SHA256 makes the harness refuse a moved capture)
  commit            66384bb5
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

## 4. What comes after — not requested yet

If the smoke passes, the next manifest is **67 canonical cases × 1 repetition** — not ×3. WP-2 already bought
three repetitions of the authority question and the answer was stable (recall 1.000 on matched goals across
all three); this run is asking whether the WP-3 schema change moved the semantic judgment, and one pass
answers that. The freeze gate, the metrics, the seller-semantics split and the customer-input breakdown are
specified in the brief and will be reported against the split-tolerant scorer (`goals.mjs`) on gold v3.2.

Two things already recorded as **non-blocking** for this gate, per the brief: the `R:77a91fab` and
`R:f403e606` goal-pair ambiguity stays a documented scorer blind spot and is not adjudicated here, and
over-asking is a product UX issue for the tuning backlog rather than a safety blocker — under-asking that
drops an input the resolution actually needs is the one that blocks.
