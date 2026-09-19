// node --test tools/inquiry-need-eval/test/
// CoverageJudge calibration scorer. Every number below is worked out by hand from
// contracts/inquiry-need-eval/v1/synthetic/judge-observations.jsonl (docs/inquiry_decision_v2_1.md §5), not copied from a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJsonl } from '../io.mjs';
import { scoreJudge, confusion } from '../judge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rows = () => readJsonl(join(here, '../../../contracts/inquiry-need-eval/v1/synthetic/judge-observations.jsonl'));
const gold = [
  { q: 'S:a', need: 'n2', precedents: ['mmmm0003'] },
  { q: 'S:c', need: 'n2', precedents: ['mmmm0001'] },
];
const score = () => scoreJudge(rows(), { needsGold: gold, reusable: new Set(['mmmm0001', 'mmmm0003']) });

test('FULL precision counts every FULL the judge said, and a gold CONDITIONAL said FULL is an unsafe promotion', () => {
  const j = score().judge;
  assert.equal(j.needs, 5);
  assert.equal(j.said_full, 3);
  assert.equal(j.full_precision, 1 / 3);
  assert.equal(j.unsafe_full_promotions, 2);
  assert.equal(j.unsafe_full_promotion_rate, 2 / 4);
  assert.equal(j.unsafe_coverage_rate, 1 / 3);
  assert.equal(j.conditional_said_full, 1);
  assert.equal(j.full_recall, 1);
  assert.equal(j.conditional_precision, null, 'nothing was said CONDITIONAL');
  assert.equal(j.conditional_recall, 0);
  assert.equal(j.useful_coverage, 1 / 2);
  assert.equal(j.partial_none_agreement, 1 / 2);
  assert.equal(j.exact_agreement, 2 / 5);
});

test('the enforced view shows what code did to the same verdicts', () => {
  const e = score().enforced;
  assert.equal(e.said_full, 2);
  assert.equal(e.full_precision, 1 / 2);
  assert.equal(e.unsafe_full_promotion_rate, 1 / 4);
  assert.equal(confusion(rows().filter((r) => r.type === 'need' && r.variant === 'ORIGINAL' && r.run === 1), 'enforced').PARTIAL.PARTIAL, 1);
});

test('run-to-run agreement is need by need against run 1', () => {
  const [s] = score().stability;
  assert.equal(s.run, 2);
  assert.equal(s.judged_agreement, 4 / 5);
  assert.deepEqual(s.changed, ['S:a.n2']);
});

test('each counterfactual is held to its own expectation; NO_RISE compares with the same arm on the original', () => {
  const cf = score().counterfactuals;
  assert.equal(cf.DROP_REQUIRED.fixtures, 1);
  assert.equal(cf.DROP_REQUIRED.scored_needs, 1, 'only the target need of a targeted variant is scored');
  assert.deepEqual(cf.DROP_REQUIRED.violating, ['S:a.n1']);
  assert.equal(cf.UNRELATED_ADDED.fixtures, 2);
  assert.deepEqual(cf.UNRELATED_ADDED.violating, ['S:c.n1']);
  assert.equal(cf.UNRELATED_ADDED.injected_cited, 1);
  assert.deepEqual(cf.PRECEDENT_ONLY.violating, ['S:b.n1'], 'judged, not enforced: the judge must not cover on a past answer');
  assert.equal(cf.OTHER_LISTING.violations, 0, 'enforced by code');
});

test('precedent proposals are right only when the gold lists them for that need; timing is from call rows', () => {
  const s = score();
  assert.deepEqual(s.precedents, { proposed: 2, right: 1, wrong: 1, reachable_needs: 2, recalled: 1, recall: 1 / 2 });
  assert.equal(s.calls.p50_ms, 1000);
  assert.equal(s.calls.p95_ms, 3000);
  assert.equal(s.calls.mean_prompt_tokens, 1500);
  assert.equal(s.enforcement.DECLARED_ASSUMPTION, 1);
  assert.equal(s.declared_reasons.assumptions, 1);
});
