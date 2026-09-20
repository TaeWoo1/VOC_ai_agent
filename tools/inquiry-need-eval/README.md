# inquiry-need-eval — Inquiry Need Eval v1

Offline, read-only. No model, no marketplace, no network but a local `psql`. The contract and every metric are
defined in `docs/inquiry_need_eval_v1.md`; read §2–§6 first — the numbers mean nothing without the definitions.

## The rule

**Real eval data never enters this repository.** The dataset (`questions.jsonl`, `needs.jsonl`,
`precedents.jsonl`) names real inquiry ids and carries labels derived from real customer questions; it lives in
operator scratch. What is committed is the schema (`contracts/inquiry-need-eval/v1/schema.json`), this tooling, a
synthetic fixture (`contracts/inquiry-need-eval/v1/synthetic/`) and the frozen hashes
(`contracts/inquiry-need-eval/v1/dataset.meta.json`).

## Where the real data is

`tools/eval-store/README.md` — the canonical files live in the durable private store, never in a repository or a temp
directory. `node tools/eval-store/store.mjs restore inquiry-need-eval v1` puts a verified copy in the cache; pass that
directory below.

## Resolution-plan gold (Inquiry v3 WP-1)

```bash
node tools/inquiry-need-eval/plan.mjs --plans <cache>/inquiry-resolution-plan/v3/plans.jsonl [--pred predicted.jsonl]
```

Validates the gold against `contracts/inquiry-authority/v1/vocabulary.json`, projects the v2 bridge onto it, and (with
`--pred`) scores a predicted plan — required-authority recall, ORDER miss (hard fail), unnecessary authority, slots.
`compareResolutions` compares the authority layer's resolutions to the gold terminal; a possible gap is never a verdict.

### Customer-goal gold (Inquiry v3.5)

```bash
node tools/eval-store/store.mjs restore inquiry-customer-goal v3
python3 contracts/inquiry-customer-goal/v3/build.py /tmp/goals.jsonl
```

Rebuilds the CustomerGoal gold. **v3 is current**; v1 and v2 stay frozen and readable, and the builders sit beside
each other. **The labels are real eval data and live in the store, not here** — the builder refuses to run without
them rather than inventing a default.

v3 closes every adjudication class, so **no row is open** and the corpus emits **72 goals over 72 rows** — one row
carries none (`NO_GOAL`) and one carries two joined by a customer-stated `FALLBACK`. The build does **not** assert
that the adjudicated goals agree with the frozen resolution gold; it asserts that every **disagreement is declared**,
in two ways — the *closer* (a different authority ends the goal) and the *instance* (a frozen step reads something
the adjudicated referent is not about) — and a declaration that is not a real disagreement fails too, so the list
cannot be padded. It also runs the DECISION prerequisite audit from the frozen steps: **3 of 5** DECISION goals
require observed entity state.

### `contract.mjs` · `goals.mjs` · `wp3-replay.mjs` (WP-3)

`plan.mjs` above stays as the WP-2 baseline: the v2 step shape and the POSITIONAL scorer that produced the published
`wp2-shadow` figures. A baseline you edit is not a baseline, so the WP-3 work lives beside it.

| file | what it owns |
|---|---|
| `contract.mjs` | the step shapes, the declared `closing_authority`, the parser (`PLAN_SET` = unknown word · `PLAN_SHAPE` = known words, impossible object — now including a retired `role`), the validator rules a shape cannot carry, and `project` (an older plan rewritten into the current shapes; it refuses to choose when the recorded plan named two endings) |
| `goals.mjs` | split-tolerant scoring: many predicted needs may serve one resolution goal, and no need serves two. Reports `correct_closer` beside the older `required_authority_recall`, because presence and closing are different claims |
| `availability.mjs` | WP-3.1 §2: every entity read classified against what the goal required, and the three availability semantics priced on the same rows. Changes nothing |
| `closers.mjs` | WP-3.1 §3: the closing-authority taxonomy — a genuine seller judgment, a seller appended behind knowledge, a seller standing where a capability cannot act |
| `wp3-replay.mjs` | both scorers over one recorded run, so the difference is shown rather than asserted |
| `score-goal-run.mjs` | **Inquiry v3.5.** Scores a recorded Customer Goal Interpreter run: `node tools/inquiry-need-eval/score-goal-run.mjs <rows.jsonl> <gold.jsonl>`. Reads rows the runner **wrote**, never what it would write — scoring is separate from transport because a raw answer cannot be produced a second time and a scorer that fails must not take an observation down with it. A refused row stays in the denominator (a model that says nothing is not a careful one) and the output carries the run's own prompt/schema/request fingerprints, so a number is attributable to the bytes that produced it. Rows from a non-`RUN` mode are labelled: a dry build is not a result |
| `customer-goals.mjs` | **Inquiry v3.5 Layer A.** The `CustomerGoal` contract mirror (`GOAL_SET` = unknown word · `GOAL_SHAPE` = known words, impossible object · **`GOAL_PLAN`** = a retired plan slot arriving under a goal's name) and the Layer-A scorer. Headline metric **`invented_goal_rate`**: on a C6-shaped case a prediction that is perfect *plus one extra goal* scores recall 1.0 and outcome accuracy 1.0, so the plan-era metrics cannot see the defect that ended the planner. Pinned to the Java by `test/customer-goals.test.mjs`, which reads the same fixture the Java scenario test reads (`contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl`, 23 rows). Also mirrors the **customer-stated relation** (`RELATION_PLAN` = a plan edge wearing a relation's name; a relation with no quoted condition is refused) and reports **relation fidelity**, **invented relation rate** and five **safety blockers** — the load-bearing one being `lost_stated_fallback`, because a prediction with both goals, both outcomes and both referents right scores 1.0 everywhere else while discarding the customer's own ranking |

`contract.mjs` is a **mirror** of the Java (`ResolutionPlan` / `ResolutionPlanParser` / `ResolutionPlanValidator`). It is
pinned to it by `test/goals.test.mjs`, which reads the very file the Java scenario tests read
(`contracts/inquiry-planner/v3/synthetic/planner-scenarios.jsonl`) and must reach the same verdict on all 43 rows —
including which 13 cannot be parsed at all. The `v2` fixture beside it is frozen: it is what the WP-3 contract was
measured against, and under WP-3.1's parser every row of it carries a retired slot. `test/mutations.test.mjs` breaks one rule at a time at the source level and
asserts a named property stops holding, so a rule nothing checks shows up as a surviving mutation.

```bash
node tools/inquiry-need-eval/wp3-replay.mjs --obs <run>.jsonl --gold <v3.2 plans>.jsonl --json out.json
```

The report marks every block `MEASURED_SCORER_CHANGE` (the model's own plans, compared differently) or `ESTIMATED` (the
plans projected into shapes the model was never asked for). Do not read the second as the first.

## 0. Check the tooling

```bash
node --test tools/inquiry-need-eval/test/eval.test.mjs tools/inquiry-need-eval/test/judge.test.mjs \
     tools/inquiry-need-eval/test/plan.test.mjs tools/inquiry-need-eval/test/goals.test.mjs \
     tools/inquiry-need-eval/test/mutations.test.mjs tools/eval-store/test/store.test.mjs
```

(Name the files: on Node 23 `node --test <directory>` resolves the directory as a module and fails.)

## 1. L1 — validate the gold

```bash
node tools/inquiry-need-eval/validate.mjs <dataset-dir>      # prints dataset_hash; exit 1 on any error
```

Compare `dataset_hash` with `dataset.meta.json` before trusting any number.

## 2. L2 — census a snapshot (a disposable clone, never the dev DB you work in)

```bash
node tools/inquiry-need-eval/census.mjs --dataset <dir> --db <clone> --org <uuid> --snapshot S1 --out S1.json
```

Every statement runs with `default_transaction_read_only = on`. It refuses an 8-char id that is not unique.

## 3. L3 — observe (runs the production assessor)

`backend/src/test/java/com/sellerops/knowledge/teach/InquiryNeedEvalIT.java`, gated by `RUN_INQUIRY_NEED_EVAL=true`,
with `EVAL_ORG`, `EVAL_ARM`, `EVAL_SNAPSHOT`, `EVAL_QUESTIONS`, `EVAL_OUT`. Set `EVAL_KNOWLEDGE_MODELS_OFF=true` for an
offline arm — the harness refuses to run if a knowledge capability is on anyway. Any arm with a model on is a live
model run and needs its own approval manifest (`docs/sellerops_live_approval_contract.md`).

## 4. Score

```bash
node tools/inquiry-need-eval/score.mjs --dataset <dir> --snapshot S1.json --obs run.jsonl \
     [--baseline other-run.jsonl] [--json out.json]
```

`--baseline` must be a run on the same snapshot; it adds need/case change rates and the retrieval / precedent /
unsafe-no-ask deltas.

## 5. CoverageJudge calibration (Inquiry Decision v2.1)

The judge as a component, on the exact inputs production sends it — `docs/inquiry_decision_v2_1.md` §4–§5.

1. **Capture** (no model): `InquiryNeedEvalIT` with `EVAL_DECISION=capture EVAL_CAPTURE=<judge-inputs.jsonl>` plus the
   offline-arm env above. The file holds customer and seller text — operator scratch only; commit its hash.
2. **Run**: `backend/src/test/java/com/sellerops/inquiry/decision/CoverageJudgeCalibrationIT.java`, gated by
   `RUN_COVERAGE_JUDGE_CALIBRATION=true`, with `CAL_INPUTS`, `CAL_NEEDS`, `CAL_PRECEDENTS`, `CAL_OUT`, `CAL_ARM`,
   `CAL_REPEATS`. `CAL_MODE=offline` uses the gold as the judge (a harness self-check — every expectation must hold);
   `CAL_MODE=model` sends real judge calls, needs `CAL_MAX_CALLS` and its own approval manifest.
3. **Score**:

```bash
node tools/inquiry-need-eval/judge.mjs --obs cal-S0-B.jsonl --needs <dataset>/needs.jsonl \
     --precedents <dataset>/precedents.jsonl [--json out.json]
```

Every metric is reported twice: `judge` (the model's word) and `enforced` (after `NeedAggregation`).

**Before reading any metric**, the scorer runs `integrity()`: a duplicate row, an unmatched or unjudged verdict, input
that drifts between runs, or a run whose ORIGINAL needs are not exactly the gold needs makes the arm `valid: false`.
A failed call (`failed: true`) is counted apart and never scored as NONE. Two arms are comparable only if
`--parity` passes — identical input, model, format and token limit, differing only where declared:

```bash
node tools/inquiry-need-eval/judge.mjs --parity cal-S0-A.jsonl,cal-S0-B.jsonl --may-differ system_fp,schema_fp
node tools/inquiry-need-eval/judge.mjs --parity cal-S0-B.jsonl,cal-S0-C.jsonl --may-differ effort
```

A model run must pin its frozen input with `CAL_INPUTS_SHA256`; `CAL_KINDS=ORIGINAL` and `CAL_SMOKE_PLAN=<sentence>` narrow
it to a smoke test on the committed synthetic fixture (`judge-smoke-*.jsonl`).
