# inquiry-need-eval — Inquiry Need Eval v1

Offline, read-only. No model, no marketplace, no network but a local `psql`. The contract and every metric are
defined in `docs/inquiry_need_eval_v1.md`; read §2–§6 first — the numbers mean nothing without the definitions.

## The rule

**Real eval data never enters this repository.** The dataset (`questions.jsonl`, `needs.jsonl`,
`precedents.jsonl`) names real inquiry ids and carries labels derived from real customer questions; it lives in
operator scratch. What is committed is the schema (`contracts/inquiry-need-eval/v1/schema.json`), this tooling, a
synthetic fixture (`contracts/inquiry-need-eval/v1/synthetic/`) and the frozen hashes
(`contracts/inquiry-need-eval/v1/dataset.meta.json`).

## 0. Check the tooling

```bash
node --test tools/inquiry-need-eval/test/eval.test.mjs tools/inquiry-need-eval/test/judge.test.mjs
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
