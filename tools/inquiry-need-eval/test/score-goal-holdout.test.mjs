// node --test tools/inquiry-need-eval/test/score-goal-holdout.test.mjs
// Inquiry v3.5 — the paired holdout scorer. Written and checked BEFORE the run it scores (§26.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdoutGold, armVerdicts, mcnemarExact, verdictOf, score } from '../score-goal-holdout.mjs';

const CASES = [
  { q: 'H:a', source: 'REAL', text: '가능한가요?', s: 'C', conf: 'HIGH', pair: 'p1',
    goals: [['ANSWER', 'ORGANIZATION', 'STATED', 0]] },
  { q: 'H:b', source: 'REAL', text: '해주세요', s: 'T', conf: 'HIGH', pair: 'p1',
    goals: [['ACTION', 'CURRENT_ORDER', 'STATED', 0]] },
  { q: 'H:c', source: 'SYNTHETIC', text: '아이디 x', s: 'N', conf: 'HIGH', goals: [] },
  { q: 'H:d', source: 'REAL', text: '되는지요', s: 'C', conf: 'MEDIUM',
    goals: [['ANSWER', 'CURRENT_LISTING', 'STATED', 0]] },
];

const row = (id, arm, goals, extra = {}) => ({
  run_id: 'r', mode: 'RUN', id, runner: 'customer-goal-runner/v1', prompt_version: arm,
  model: 'm', reasoning_effort: 'minimal', transport: 'REAL',
  system_fp: `sys-${arm}`, schema_fp: `sch-${arm}`, input_fp: `in-${id}`, request_fp: `rq-${id}-${arm}`,
  finish: 'stop', failure: null, valid: true, relations: [], goals, ...extra,
});
const goal = (outcome, subject = 'ORGANIZATION', constraints = []) => ({
  id: 'g1', explicit_request: '요청', requested_outcome: outcome, subject, basis: 'STATED',
  explicit_constraints: constraints, evidence: '가능',
});

test('the gold adapter produces one row per goal, and a no-goal case is a row that emits nothing', () => {
  const gold = holdoutGold(CASES);
  assert.equal(gold.length, 4);
  const noGoal = gold.find((g) => g.q === 'H:c');
  assert.equal(noGoal.emits_goal, false);
  assert.equal(noGoal.requested_outcome, null);
  assert.ok(gold.filter((g) => g.emits_goal).every((g) => ['ANSWER', 'ACTION'].includes(g.requested_outcome)));
  // The stratum and the confidence travel with the row: the primary metric is defined in terms of them.
  assert.equal(gold.find((g) => g.q === 'H:d').conf, 'MEDIUM');
});

test('a customer-stated fallback becomes has_fallback / fallback_of on the two goals it names', () => {
  const gold = holdoutGold([{ q: 'H:f', source: 'REAL', text: '안되면 환불', s: 'R', conf: 'HIGH',
    goals: [['ACTION', 'CURRENT_ORDER', 'STATED', 0], ['ACTION', 'CURRENT_ORDER', 'STATED', 0]],
    relation: [0, 1, '안되면'] }]);
  assert.equal(gold[0].has_fallback, 'n2');
  assert.equal(gold[0].fallback_of, null);
  assert.equal(gold[1].fallback_of, 'n1');
});

test("a v2 arm's DECISION folds to ANSWER; a v3 arm's ANSWER is already there", () => {
  const gold = holdoutGold(CASES);
  const v2 = armVerdicts(CASES, gold, { 'H:a': { goals: [goal('DECISION')], relations: [] } }, true);
  assert.equal(v2.get('H:a').leaked, false, 'DECISION folded to ANSWER is a correct answer, not a leak');
  assert.equal(v2.get('H:a').outcomeOk, 1);
  const v3 = armVerdicts(CASES, gold, { 'H:a': { goals: [goal('ANSWER')], relations: [] } }, false);
  assert.equal(v3.get('H:a').outcomeOk, 1);
  // ...and the fold is never run backwards: an unfolded four-token prediction scored as v3 does NOT match.
  const wrongWay = armVerdicts(CASES, gold, { 'H:a': { goals: [goal('DECISION')], relations: [] } }, false);
  assert.equal(wrongWay.get('H:a').outcomeOk, 0);
});

test('a leak is an ACTION in the slot a gold ANSWER occupies — an EXTRA action is a different counter', () => {
  const gold = holdoutGold(CASES);
  const leak = armVerdicts(CASES, gold, { 'H:a': { goals: [goal('ACTION')], relations: [] } }, false);
  assert.equal(leak.get('H:a').leaked, true);
  assert.equal(leak.get('H:a').inventedAction, 0, 'nothing extra arrived; the right goal was replaced');
  assert.equal(leak.get('H:a').substituted, 1);

  const extra = armVerdicts(CASES, gold,
    { 'H:a': { goals: [goal('ANSWER'), goal('ACTION', 'CURRENT_ORDER')], relations: [] } }, false);
  assert.equal(extra.get('H:a').leaked, false, 'the answering goal was produced correctly');
  assert.equal(extra.get('H:a').inventedGoal, 1);
  assert.equal(extra.get('H:a').inventedAction, 1);

  // The reverse failure has its own name, so over-correction cannot hide inside a good leak number.
  const reverse = armVerdicts(CASES, gold, { 'H:b': { goals: [goal('ANSWER', 'CURRENT_ORDER')], relations: [] } },
    false);
  assert.equal(reverse.get('H:b').reverseLeaked, true);
  assert.equal(reverse.get('H:b').leaked, false);

  // A no-goal case that got a goal is a violation, and is never counted as a leak.
  const invented = armVerdicts(CASES, gold, { 'H:c': { goals: [goal('ACTION')], relations: [] } }, false);
  assert.equal(invented.get('H:c').noGoalViolation, 1);
  assert.equal(invented.get('H:c').leaked, false);
});

test("McNemar's exact test matches the binomial by hand, and is symmetric", () => {
  assert.equal(mcnemarExact(0, 0).p, 1);
  // b=5, c=0 -> 2 * P(X <= 0 | n=5, p=.5) = 2/32
  assert.ok(Math.abs(mcnemarExact(5, 0).p - 0.0625) < 1e-12);
  // b=6, c=0 -> 2/64, the smallest all-one-way result this design can call significant
  assert.ok(Math.abs(mcnemarExact(6, 0).p - 0.03125) < 1e-12);
  assert.ok(mcnemarExact(6, 0).p < 0.05);
  assert.ok(mcnemarExact(5, 0).p > 0.05, 'five one-way disagreements is NOT significant — stated before the run');
  // b=3, c=1 -> 2 * P(X <= 1 | n=4) = 2 * 5/16
  assert.ok(Math.abs(mcnemarExact(3, 1).p - 0.625) < 1e-12);
  // Direction does not change the p-value; only the verdict reads direction.
  assert.equal(mcnemarExact(7, 2).p, mcnemarExact(2, 7).p);
  // Concordant pairs are not in the denominator: they carry no information about a change.
  assert.equal(mcnemarExact(1, 1).n, 2);
});

test('the registered decision rule is applied mechanically, in both directions', () => {
  assert.equal(verdictOf(0, 3, mcnemarExact(0, 3).p).verdict, 'NO_INCREASE');
  assert.equal(verdictOf(2, 2, mcnemarExact(2, 2).p).verdict, 'NO_INCREASE');
  assert.ok(verdictOf(0, 3, 1).ships);
  // b > c but small and not significant -> ships, because the registered tolerance says so
  const small = verdictOf(2, 0, mcnemarExact(2, 0).p);
  assert.equal(small.verdict, 'NOT_DISTINGUISHABLE');
  assert.ok(small.ships);
  // b - c larger than the tolerance, still not significant -> HOLD, not ship
  const hold = verdictOf(5, 0, mcnemarExact(5, 0).p);
  assert.equal(hold.verdict, 'HOLD');
  assert.equal(hold.ships, false);
  // significant -> does not ship
  const bad = verdictOf(7, 0, mcnemarExact(7, 0).p);
  assert.equal(bad.verdict, 'INCREASE_CONFIRMED');
  assert.equal(bad.ships, false);
});

test('the pairing is re-checked from the rows: same cases, same inputs, two different contracts', () => {
  const v2 = CASES.map((c) => row(c.q, 'customer-goal-interpreter/v2', [goal('DECISION')]));
  const v3 = CASES.map((c) => row(c.q, 'customer-goal-interpreter/v3', [goal('ANSWER')]));
  const ok = score(v2, v3, CASES);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.evaluation_valid, true);
  assert.equal(ok.primary.n, 1, 'H:a only: H:d is MEDIUM and H:b/H:c carry no ANSWER gold');

  // One arm short -> reported, never scored as if it were whole.
  const short = score(v2.slice(0, 3), v3, CASES);
  assert.equal(short.evaluation_valid, false);
  assert.ok(short.problems.some((p) => p.includes('DID NOT SEE THE SAME CASES')));

  // Both arms the same contract is not a comparison.
  const same = score(v3, v3.map((r) => ({ ...r })), CASES);
  assert.ok(same.problems.some((p) => p.includes('SAME prompt_version')));

  // Different question bytes for the same id -> refused, because the pairing is the whole design.
  const drifted = v3.map((r) => (r.id === 'H:a' ? { ...r, input_fp: 'in-OTHER' } : r));
  const bad = score(v2, drifted, CASES);
  assert.ok(bad.problems.some((p) => p.includes('asked differently')));
});

test('MEDIUM-confidence cases never enter the primary denominator', () => {
  const v2 = CASES.map((c) => row(c.q, 'customer-goal-interpreter/v2', [goal('DECISION')]));
  // v3 leaks on the MEDIUM case and on nothing else.
  const v3 = CASES.map((c) => row(c.q, 'customer-goal-interpreter/v3',
    [goal(c.q === 'H:d' ? 'ACTION' : 'ANSWER', c.q === 'H:d' ? 'CURRENT_LISTING' : 'ORGANIZATION')]));
  const out = score(v2, v3, CASES);
  assert.equal(out.primary.n, 1);
  assert.equal(out.primary.mcnemar.b, 0, 'a MEDIUM leak must not move the primary statistic');
  assert.equal(out.primary.verdict, 'NO_INCREASE');
});
