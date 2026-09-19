// node --test tools/inquiry-need-eval/test/
// CoverageJudge calibration scorer. Every number below is worked out by hand from
// contracts/inquiry-need-eval/v1/synthetic/judge-observations.jsonl (docs/inquiry_decision_v2_1.md §5), not copied from a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJsonl } from '../io.mjs';
import { scoreJudge, confusion, integrity, parity, caseOutcomes } from '../judge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rows = () => readJsonl(join(here, '../../../contracts/inquiry-need-eval/v1/synthetic/judge-observations.jsonl'));
const gold = [
  { q: 'S:a', need: 'n1', precedents: [] },
  { q: 'S:a', need: 'n2', precedents: ['mmmm0003'] },
  { q: 'S:b', need: 'n1', precedents: [] },
  { q: 'S:c', need: 'n1', precedents: [] },
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
  assert.equal(s.valid, true);
  assert.equal(s.calls.unmatched_verdicts, 0);
});

test('a verdict keyed by an id the input never sent makes the arm invalid, instead of passing as NONE', () => {
  const r = rows();
  r[0] = { ...r[0], unmatched_verdicts: 2 };
  const s = scoreJudge(r);
  assert.equal(s.valid, false);
  assert.equal(s.calls.unmatched_verdicts, 2);
});

// ── integrity: a harness fault makes the arm INVALID before any metric is read ──────────────────────────────────

test('the synthetic arm is clean: no duplicate, no unmatched verdict, every ORIGINAL run holds exactly the gold needs', () => {
  assert.deepEqual(integrity(rows(), { needsGold: gold }), []);
});

test('a row counted twice (a retried sample), an unmatched verdict, drifting input and an unmapped need each invalidate', () => {
  const base = rows();
  const dup = [...base, base.find((r) => r.type === 'need' && r.q === 'S:a' && r.need === 'n1' && r.run === 1)];
  assert.match(integrity(dup).join(), /DUPLICATE_ROW 1\|S:a\|ORIGINAL\|\*\|n1/);

  const unmatched = base.map((r, i) => (i === 0 ? { ...r, unmatched_verdicts: 1 } : r));
  assert.deepEqual(integrity(unmatched), ['UNMATCHED_VERDICTS 1']);

  const drift = [...base, { type: 'call', run: 1, q: 'S:x', variant: 'ORIGINAL', target: '*', input_fp: 'aa' },
    { type: 'call', run: 2, q: 'S:x', variant: 'ORIGINAL', target: '*', input_fp: 'bb' }];
  assert.deepEqual(integrity(drift), ['INPUT_DRIFT S:x|ORIGINAL|*']);

  // The apr-80adf54f shape at scoring time: the row names the id that was SENT, not the gold id it stands for.
  const unmapped = base.map((r) => (r.type === 'need' && r.q === 'S:b' ? { ...r, need: 'N1' } : r));
  const p = integrity(unmapped, { needsGold: gold });
  assert.ok(p.includes('GOLD_MAPPING 1|S:b') && p.includes('GOLD_MAPPING 2|S:b'), p.join());
  assert.equal(scoreJudge(unmapped, { needsGold: gold }).valid, false);

  const lost = base.map((r) => (r.type === 'need' && r.q === 'S:c' && r.need === 'n1' ? { ...r, judged: null, enforcement: 'NOT_JUDGED' } : r));
  assert.deepEqual(integrity(lost), ['NOT_JUDGED 3'], 'run 1, run 2 and the UNRELATED_ADDED row of S:c.n1');
});

test('a failed call is a failure, not a NONE: its needs leave every quality metric and are counted apart', () => {
  const failed = [...rows(), { type: 'need', arm: 'SYN', run: 1, call: 99, q: 'S:d', variant: 'ORIGINAL', target: '*',
    need: 'n1', gold: 'PARTIAL', expectation: 'MATCH_GOLD', failed: true, failure: 'VERDICT_SET', judged: null, enforced: null }];
  const s = scoreJudge(failed);
  assert.equal(s.failed_needs, 1);
  assert.deepEqual(s.failures, { VERDICT_SET: 1 });
  assert.equal(s.judge.needs, 5, 'the failed need is not a sixth row scored NONE');
  assert.equal(s.judge.full_precision, 1 / 3);
});

// ── parity: two arms are comparable only on byte-identical input ──────────────────────────────────────────────

const call = (over) => ({ type: 'call', run: 1, q: 'S:a', variant: 'ORIGINAL', target: '*', judge: 'MODEL',
  input_fp: 'in', model: 'gpt-5-2025-08-07', max_tokens: 6000, format: 'json_schema', system_fp: 's1', schema_fp: 'k1',
  effort: 'minimal', ...over });

test('A/B may differ in instruction and schema only; anything else — input, model, limit, effort — is a parity fault', () => {
  const a = [call({})];
  const b = [call({ system_fp: 's2', schema_fp: 'k2' })];
  assert.deepEqual(parity(a, b, { mayDiffer: ['system_fp', 'schema_fp'] }),
    { comparable: true, problems: [], differed: ['schema_fp', 'system_fp'] });
  const drifted = [call({ system_fp: 's2', schema_fp: 'k2', input_fp: 'other', max_tokens: 2400 })];
  const r = parity(a, drifted, { mayDiffer: ['system_fp', 'schema_fp'] });
  assert.equal(r.comparable, false);
  assert.deepEqual(r.problems.sort(), ['INPUT_FP_DIFFERS S:a|ORIGINAL|*|1', 'MAX_TOKENS_DIFFERS S:a|ORIGINAL|*|1']);
  assert.deepEqual(parity(a, [], {}).problems, ['MISSING_CALL S:a|ORIGINAL|*|1']);
  assert.equal(parity([call({})], [call({ effort: 'low' })], { mayDiffer: ['effort'] }).comparable, true);
});

// ── case projection (v2.2) ──────────────────────────────────────────────────────────────────────────────────────

test('case projection: aggregation of the need statuses against aggregation of the gold, worked by hand', () => {
  // S:a — gold FULL + PARTIAL → seller. judged FULL + FULL → answers: a need is covered, so PARTIAL_LEAK.
  //        enforced FULL + PARTIAL → seller: CORRECT_ESCALATION.
  // S:b — gold CONDITIONAL → ask the customer. judged/enforced FULL → UNDER_CLARIFY.
  // S:c — gold NONE + PARTIAL → seller. NONE + NONE → CORRECT_ESCALATION.
  const run1 = rows().filter((r) => r.type === 'need' && r.variant === 'ORIGINAL' && r.run === 1);
  const j = caseOutcomes(run1, 'judged');
  assert.deepEqual(j.outcomes, { PARTIAL_LEAK: 1, UNDER_CLARIFY: 1, CORRECT_ESCALATION: 1 });
  assert.equal(j.no_ask, 2);
  assert.equal(j.strict_safe_precision, 0);
  assert.equal(j.unsafe_automation, 2);
  assert.equal(j.safe_automation_coverage, 0, 'S:b was the only case safe to automate, and it was under-clarified');
  const e = caseOutcomes(run1, 'enforced');
  assert.deepEqual(e.outcomes, { CORRECT_ESCALATION: 2, UNDER_CLARIFY: 1 });
  assert.deepEqual(e.unsafe_cases, ['S:b:UNDER_CLARIFY']);
});

test('case projection: a failed call escalates; a gold-safe case sent to the seller is an unnecessary escalation', () => {
  const r = [
    { q: 'x', need: 'n1', gold: 'FULL', judged: 'FULL', failed: false },
    { q: 'y', need: 'n1', gold: 'FULL', judged: 'PARTIAL', failed: false },
    { q: 'z', need: 'n1', gold: 'FULL', judged: null, failed: true },
    { q: 'w', need: 'n1', gold: 'NONE', judged: 'FULL', failed: false },
  ];
  const o = caseOutcomes(r, 'judged');
  assert.deepEqual(o.outcomes, { SAFE_ANSWER: 1, UNNECESSARY_ESCALATION: 2, WRONG: 1 });
  assert.equal(o.strict_safe_precision, 1 / 2);
  assert.equal(o.safe_automation_coverage, 1 / 3);
});
