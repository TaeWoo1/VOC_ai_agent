// node --test tools/inquiry-need-eval/test/customer-goals.test.mjs
// Inquiry v3.5 Layer A. Two jobs: pin the mirror to the Java by reading the fixture the Java scenario test reads, and
// show that the headline metric sees the defect the old metrics could not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGoal, scoreLayerA, assign, mayReachProcedure, OUTCOMES, REFERENTS, RETIRED, FIRST_RESOLVER }
  from '../customer-goals.mjs';

const FIXTURE = 'contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl';
const rows = readFileSync(FIXTURE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const wire = (g) => ({
  id: g.id, explicit_request: g.explicit_request, requested_outcome: g.requested_outcome,
  subject: g.subject, basis: g.basis, explicit_constraints: g.explicit_constraints,
});

test('every fixture goal parses — the mirror and the Java agree on all 12 rows', () => {
  assert.equal(rows.length, 12);
  for (const row of rows) {
    for (const g of row.goals) {
      const r = parseGoal(wire(g));
      assert.ok(r.goal, `${row.id}/${g.id}: ${r.failure} at ${r.at}`);
      assert.ok(OUTCOMES.includes(r.goal.outcome));
      assert.ok(REFERENTS.includes(r.goal.subject));
    }
  }
});

test('only an ACTION may reach a procedure, and the fixture says so where it matters', () => {
  for (const o of OUTCOMES) assert.equal(mayReachProcedure(o), o === 'ACTION');
  assert.equal(FIRST_RESOLVER.DECISION, 'KNOWLEDGE'); // not SELLER
  for (const id of ['G05', 'G06']) {
    const row = rows.find((r) => r.id === id);
    assert.ok(row.forbidden_dispatch.includes('PROCEDURE'), `${id} must forbid the procedure registry`);
    assert.ok(row.goals.every((g) => g.requested_outcome === 'DECISION'));
  }
  // G07 is the same domain and the same subject, and differs only in what the customer asked for.
  const g07 = rows.find((r) => r.id === 'G07');
  assert.equal(g07.goals.length, 2);
  assert.deepEqual(g07.goals.map((g) => g.requested_outcome), ['DECISION', 'ACTION']);
});

test('a plan cannot arrive wearing a goal name — every retired slot is refused by name', () => {
  const base = wire(rows[0].goals[0]);
  for (const k of RETIRED) {
    const r = parseGoal({ ...base, [k]: k === 'fields' ? ['ORDER_TRACKING'] : 'X' });
    assert.equal(r.failure, 'GOAL_PLAN', `${k} was accepted`);
    assert.equal(r.at, k);
  }
  assert.equal(parseGoal({ ...base, unknown: 1 }).failure, 'GOAL_SET');
  assert.equal(parseGoal({ ...base, requested_outcome: 'REFUND' }).failure, 'GOAL_SET');
  assert.equal(parseGoal({ ...base, explicit_request: 'x'.repeat(141) }).failure, 'GOAL_SHAPE');
  assert.equal(parseGoal({ ...base, explicit_constraints: ['x'.repeat(41)] }).failure, 'GOAL_SHAPE');
});

// --- the headline metric -------------------------------------------------------------------------------------

const gold = [
  { q: 'C6', goal: 'n1', requested_outcome: 'DECISION', referent: 'CURRENT_ORDER', basis: 'STATED',
    explicit_constraints: 0 },
];
const decision = { id: 'g1', request: '교환 승인해주실 수 있나요?', outcome: 'DECISION', subject: 'CURRENT_ORDER',
  basis: 'STATED', constraints: [] };
const invented = { id: 'g2', request: '교환 처리', outcome: 'ACTION', subject: 'CURRENT_ORDER', basis: 'STATED',
  constraints: [] };

test('C6: a perfect answer plus one goal nobody asked for is INVISIBLE to recall and accuracy', () => {
  const clean = scoreLayerA(gold, { C6: [decision] });
  const withExtra = scoreLayerA(gold, { C6: [decision, invented] });

  // Both score perfectly on every metric the plan-era evaluation had.
  assert.equal(clean.explicit_goal_recall, 1);
  assert.equal(withExtra.explicit_goal_recall, 1);
  assert.equal(clean.outcome_accuracy, 1);
  assert.equal(withExtra.outcome_accuracy, 1);

  // Only the new one tells them apart. This is the whole reason it is the headline.
  assert.equal(clean.invented_goal_rate, 0);
  assert.equal(withExtra.invented_goal_rate, 0.5);
  assert.equal(withExtra.invented, 1);
  assert.equal(clean.goal_count_accuracy, 1);
  assert.equal(withExtra.goal_count_accuracy, 0);
});

test('a missed goal is not an invented one, and the two are counted apart', () => {
  const twoGold = [...gold, { q: 'C6', goal: 'n2', requested_outcome: 'ACTION', referent: 'CURRENT_ORDER',
    basis: 'STATED', explicit_constraints: 0 }];
  const m = scoreLayerA(twoGold, { C6: [decision] });
  assert.equal(m.recalled, 1);
  assert.equal(m.invented, 0);
  assert.equal(m.explicit_goal_recall, 0.5);
  assert.ok(m.wrong.some(([, g, why]) => g === 'n2' && why === 'MISSED'));
});

test('an adjudication row is not scored for correctness, but a prediction on it still counts as invented', () => {
  const unsettled = [{ q: 'R:0c582144', goal: 'n1', requested_outcome: null, referent: 'CURRENT_ORDER', basis: null,
    explicit_constraints: 0 }];
  const m = scoreLayerA(unsettled, { 'R:0c582144': [decision, invented] });
  assert.equal(m.scored_goals, 0, 'nothing is scored against a label under adjudication');
  assert.equal(m.explicit_goal_recall, null);
  assert.equal(m.invented, 1, 'the second goal is extra whatever the right answer turns out to be');
  assert.equal(m.unsettled_cases_predicted_on, 1);
});

test('assignment prefers the referent, so outcome accuracy is not measuring itself', () => {
  const g = [{ q: 'X', goal: 'n1', requested_outcome: 'INFORMATION', referent: 'ORGANIZATION', basis: 'STATED',
    explicit_constraints: 0 },
  { q: 'X', goal: 'n2', requested_outcome: 'INFORMATION', referent: 'CURRENT_LISTING', basis: 'STATED',
    explicit_constraints: 0 }];
  // Both predictions carry the WRONG outcome; they must still land on the goal with their own referent.
  const p = [{ id: 'a', request: 'r', outcome: 'DECISION', subject: 'CURRENT_LISTING', basis: 'STATED', constraints: [] },
    { id: 'b', request: 'r', outcome: 'DECISION', subject: 'ORGANIZATION', basis: 'STATED', constraints: [] }];
  const { pairs, extra } = assign(g, p);
  assert.equal(extra.length, 0);
  assert.equal(pairs[0][1].subject, 'ORGANIZATION');
  assert.equal(pairs[1][1].subject, 'CURRENT_LISTING');
  const m = scoreLayerA(g, { X: p });
  assert.equal(m.referent_accuracy, 1);
  assert.equal(m.outcome_accuracy, 0);
});
