// node --test tools/inquiry-need-eval/test/goals.test.mjs
// The WP-3 contract mirror and the split-tolerant goal scorer. Every count below is worked out by hand from the fixture
// it names, never copied from a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import * as C from '../contract.mjs';
import { assign, plansFromObservation, scoreGoals } from '../goals.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const vocab = C.loadVocabulary();
const ix = C.index(vocab);
const scenarios = () => readFileSync(join(here, '../../../contracts/inquiry-planner/v2/synthetic/planner-scenarios.jsonl'),
  'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const K = (capability, role, scope) => (scope ? { capability, role, scope } : { capability, role });
const E = (capability, role, fields) => ({ capability, role, fields });
const goal = (q, g, steps, customer_inputs = []) => ({ q, goal: g, need: g, status: 'FROZEN', steps, customer_inputs });
const need = (steps, customer_inputs = []) => ({ steps, customer_inputs });

// ---------------------------------------------------------------- the mirror

/**
 * The reason this file may be trusted to score a recorded run without a JVM: the same fixture file drives the Java
 * scenario tests, and both must reach the same verdict on every row — including which rows cannot be parsed at all.
 */
test('the contract mirror agrees with the Java fixtures on every scenario row', () => {
  let parsed = 0;
  let refused = 0;
  for (const s of scenarios()) {
    const p = C.parsePlan(s.plan, ix);
    if (s.expect.expressible === false) {
      assert.equal(p.failure, s.expect.failure, `${s.id} refusal`);
      assert.equal(p.plan, undefined, `${s.id} builds no plan`);
      refused++;
      continue;
    }
    assert.equal(p.failure, undefined, `${s.id} parses`);
    const got = C.validate(p.plan, ix).map((v) => v.code).sort();
    assert.deepEqual(got, (s.expect.valid ? [] : s.expect.violations).slice().sort(), `${s.id} violations`);
    parsed++;
  }
  assert.equal(parsed, 28);   // 20 valid + 8 refused by the validator
  assert.equal(refused, 8);   // shapes that cannot be written at all
});

test('a capability class cannot carry what it has no use for', () => {
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.ORG', role: 'CLOSES', fields: ['ORDER_PAYMENT'] }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.ORG', role: 'CLOSES', scope: 'COMPANY' }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'SELLER', role: 'CLOSES', scope: 'NONE' }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'ENTITY.ORDER', role: 'CLOSES', fields: [] }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'ENTITY.ORDER', role: 'CLOSES', fields: ['LISTING_SALE_STATUS'] }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'PROCEDURE.ORDER_ACTION', role: 'CLOSES', effect: 'EXTERNAL_STATE_CHANGE' }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.PRODUCT', role: 'CLOSES', depends_on: 0 }, ix).failure, 'PLAN_SHAPE');
  // and an unknown word is a different refusal from an impossible object
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.SHIPPING', role: 'CLOSES' }, ix).failure, 'PLAN_SET');
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.CATALOGUE', role: 'CLOSES', scope: 'COMPANY' }, ix).failure, 'PLAN_SET');
  // what remains legal
  assert.deepEqual(C.parseStep({ capability: 'KNOWLEDGE.ORG', role: 'CLOSES' }, ix).step,
    { capability: 'KNOWLEDGE.ORG', role: 'CLOSES', scope: 'COMPANY' });
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.CATALOGUE', role: 'CLOSES', scope: 'SELLER_CATALOGUE' }, ix).step.scope,
    'SELLER_CATALOGUE');
});

test('an entity step requires its own fields, and a procedure requires the order read first', () => {
  const plan = { needs: [{ id: 'N1', ask: 'a', steps: [K('PROCEDURE.ORDER_ACTION', 'CLOSES')], customer_inputs: [] }] };
  assert.deepEqual(C.validate(plan, ix).map((v) => v.code), ['PROCEDURE_WITHOUT_ORDER_PRECONDITION']);
  const withRead = {
    needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
      steps: [E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_FULFILLMENT']), K('PROCEDURE.ORDER_ACTION', 'CLOSES')] }],
  };
  assert.deepEqual(C.validate(withRead, ix), []);
});

test('order is the dependency: a precondition written after its closer is refused', () => {
  const plan = {
    needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
      steps: [K('PROCEDURE.ORDER_ACTION', 'CLOSES'), E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_CANCELLATION'])] }],
  };
  assert.deepEqual(C.validate(plan, ix).map((v) => v.code).sort(), ['PRECONDITION_AFTER_CLOSER']);
});

// ------------------------------------------- seller authority vs operational handoff

test('seller authority is expressible; a seller bolted onto another ending is not', () => {
  const fallback = {
    needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
      steps: [K('KNOWLEDGE.PRODUCT', 'CLOSES'), K('SELLER', 'CLOSES')] }],
  };
  assert.deepEqual(C.validate(fallback, ix).map((v) => v.code), ['MULTIPLE_CLOSING_AUTHORITIES']);
  // the legitimate exception decision: read the policy first, the seller alone closes
  const judgment = {
    needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
      steps: [K('KNOWLEDGE.ORG', 'PRECONDITION'), K('SELLER', 'CLOSES')] }],
  };
  assert.deepEqual(C.validate(judgment, ix), []);
  // the seller alone, and the seller after looking at listing state, are both plans
  assert.deepEqual(C.validate({ needs: [{ id: 'N1', ask: 'a', customer_inputs: [], steps: [K('SELLER', 'CLOSES')] }] }, ix), []);
  assert.deepEqual(C.validate({ needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
    steps: [E('ENTITY.LISTING', 'CONTEXT', ['LISTING_OPTION_SALE_STATUS']), K('SELLER', 'CLOSES')] }] }, ix), []);
});

test('the rule is about endings, not about the word SELLER', () => {
  // the 4181864b confusion inside one need: an order's state and a company rule both offered as the answer
  const both = {
    needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
      steps: [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT']), K('KNOWLEDGE.ORG', 'CLOSES')] }],
  };
  assert.deepEqual(C.validate(both, ix).map((v) => v.code), ['MULTIPLE_CLOSING_AUTHORITIES']);
  // two capabilities of the SAME authority closing together is how the gold answers four of its goals
  const together = {
    needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
      steps: [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'THIS_LISTING'), K('KNOWLEDGE.PRODUCT', 'CLOSES')] }],
  };
  assert.deepEqual(C.validate(together, ix), []);
});

// ------------------------------------------------------- split-tolerant scoring

const oneGoal = [goal('C1', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')])];

test('splitting one goal into several needs is not a mistake', () => {
  const r = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')]), need([K('KNOWLEDGE.PRODUCT', 'CLOSES')])] }],
    oneGoal, vocab);
  assert.equal(r.goal_covered, 1);
  assert.equal(r.goals_split, 1);
  assert.equal(r.planner_only_extra_needs, 0);
  assert.equal(r.uncovered.length, 0);
});

test('merging two distinct goals into one need does NOT pass', () => {
  const two = [goal('C1', 'n1', [K('KNOWLEDGE.ORG', 'CLOSES')]),
    goal('C1', 'n2', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])];
  // one need naming both capabilities could cover either goal — but only one, because a need serves at most one goal
  const merged = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.ORG', 'CLOSES'), E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])] }],
    two, vocab);
  assert.equal(merged.goal_covered, 1);
  assert.equal(merged.uncovered.length, 1);
  assert.equal(merged.uncovered_due_to_merge, 1, 'the second goal is reported as lost to a merge, not as unplanned');
  // and two needs cover both
  const split = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.ORG', 'CLOSES')]), need([E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])] }],
    two, vocab);
  assert.equal(split.goal_covered, 2);
  assert.equal(split.uncovered_due_to_merge, 0);
});

test('a need cannot be parked on a goal whose authority it never names', () => {
  const r = scoreGoals([{ q: 'C1', needs: [need([E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])] }], oneGoal, vocab);
  assert.equal(r.goal_covered, 0);
  assert.equal(r.planner_only_extra_needs, 1, 'the order need is left over, not credited to a knowledge goal');
  assert.deepEqual(r.uncovered.map((u) => u.why), ['NOT_PLANNED']);
});

test('the right authority with the wrong capability is a covered goal and a named mismatch', () => {
  const catalogue = [goal('C1', 'n1', [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'SELLER_CATALOGUE')])];
  const r = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')])] }], catalogue, vocab);
  assert.equal(r.required_authority_recall, 1);
  assert.equal(r.capability_mismatch.length, 1);
  assert.deepEqual(r.capability_mismatch[0].expected, ['KNOWLEDGE.CATALOGUE']);
});

test('an authority the goal never asked for is counted, and a procedure for a read is named', () => {
  const r = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')]),
    need([E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_FULFILLMENT']), K('PROCEDURE.ORDER_ACTION', 'CLOSES')])] }],
  oneGoal, vocab);
  assert.equal(r.goal_covered, 1);
  assert.equal(r.planner_only_extra_needs, 1, 'the procedure need serves no goal of this case');
  assert.equal(r.procedure_for_read.length, 0, 'an unassigned need is not blamed on a goal it never touched');
  // but a procedure inside the goal's own need is
  const inside = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')]),
    need([K('KNOWLEDGE.PRODUCT', 'CONTEXT'), E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_FULFILLMENT']),
      K('PROCEDURE.ORDER_ACTION', 'CLOSES')])] }], oneGoal, vocab);
  assert.equal(inside.procedure_for_read.length, 1);
  assert.equal(inside.unnecessary_authority_goals, 1);
});

test('an order the goal requires and the plan never reads is a hard miss', () => {
  const order = [goal('C1', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])];
  const r = scoreGoals([{ q: 'C1', needs: [need([E('ENTITY.LISTING', 'CLOSES', ['LISTING_SALE_STATUS'])])] }], order, vocab);
  assert.deepEqual(r.order_misses, ['C1.n1']);
});

test('entity fields are compared as read too much / too little, not only as equal', () => {
  const order = [goal('C1', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])];
  const over = scoreGoals([{ q: 'C1', needs: [need([E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT', 'ORDER_TRACKING'])])] }], order, vocab);
  assert.equal(over.entity_over_read, 1);
  assert.equal(over.entity_correct, 0);
  assert.deepEqual(over.over_read_fields, { ORDER_TRACKING: 1 });
  const exact = scoreGoals([{ q: 'C1', needs: [need([E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])] }], order, vocab);
  assert.equal(exact.entity_correct, 1);
  assert.equal(exact.entity_over_read, 0);
});

test('sequence is scored where the goal has one, and reported as incomparable where a split removed it', () => {
  const two = [goal('C1', 'n1', [E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_FULFILLMENT']), K('PROCEDURE.ORDER_ACTION', 'CLOSES')])];
  const right = scoreGoals([{ q: 'C1', needs: [need([E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_FULFILLMENT']), K('PROCEDURE.ORDER_ACTION', 'CLOSES')])] }], two, vocab);
  assert.equal(right.sequence_compared, 1);
  assert.equal(right.sequence_correct, 1);
  const splitUp = scoreGoals([{ q: 'C1', needs: [need([E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_FULFILLMENT'])]), need([K('PROCEDURE.ORDER_ACTION', 'CLOSES')])] }], two, vocab);
  assert.equal(splitUp.sequence_incomparable, 1);
  assert.equal(splitUp.sequence_compared, 0, 'a goal split across needs has no single sequence to be right or wrong about');
});

// ------------------------------------------------------- customer input quality

test('customer inputs are scored as four separate questions', () => {
  const asks = [goal('C1', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')], ['OPTION'])];
  const exact = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')], ['OPTION'])] }], asks, vocab).inputs;
  assert.deepEqual([exact.exact, exact.over, exact.under, exact.required_recall, exact.unnecessary_total], [1, 0, 0, 1, 0]);
  const over = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')], ['OPTION', 'SIZE', 'MODEL'])] }], asks, vocab).inputs;
  assert.deepEqual([over.exact, over.over, over.under, over.required_recall, over.unnecessary_total], [0, 1, 0, 1, 2]);
  assert.deepEqual(over.over_by_type, { SIZE: 1, MODEL: 1 });
  const under = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')], [])] }], asks, vocab).inputs;
  assert.deepEqual([under.exact, under.over, under.under, under.required_recall], [0, 0, 1, 0]);
  assert.deepEqual(under.under_by_type, { OPTION: 1 });
  // asking the wrong thing AND missing the needed thing is both, never averaged into one
  const both = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')], ['SIZE'])] }], asks, vocab).inputs;
  assert.deepEqual([both.over, both.under, both.exact], [1, 1, 0]);
});

test('identity asked of the customer is a safety count, never a quality one', () => {
  const asks = [goal('C1', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])];
  const r = scoreGoals([{ q: 'C1', needs: [need([E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])], ['ORDER_NUMBER'])] }], asks, vocab);
  assert.equal(r.inputs.forbidden, 1);
  assert.equal(r.inputs.unnecessary_total, 1);
  // and the plan itself is refused outright, whatever it scores
  assert.deepEqual(C.validate({ needs: [{ id: 'N1', ask: 'a', customer_inputs: ['ORDER_NUMBER'],
    steps: [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])] }] }, ix).map((v) => v.code), ['IDENTITY_INPUT']);
});

// ---------------------------------------------------------------- determinism

test('the assignment is deterministic and prefers the goal whose capabilities it actually names', () => {
  const goals = [goal('C1', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')]),
    goal('C1', 'n2', [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'THIS_LISTING')])];
  const plans = [{ q: 'C1', needs: [need([K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'THIS_LISTING')]), need([K('KNOWLEDGE.PRODUCT', 'CLOSES')])] }];
  const a = scoreGoals(plans, goals, vocab);
  const b = scoreGoals(JSON.parse(JSON.stringify(plans)), goals, vocab);
  assert.deepEqual(a, b);
  assert.equal(a.goal_covered, 2);
  assert.equal(a.capability_mismatch.length, 0, 'each need went to the goal that names its own capability');
});

test('goals this scorer cannot tell apart are counted and not hidden', () => {
  const same = [goal('C1', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')]), goal('C1', 'n2', [K('KNOWLEDGE.PRODUCT', 'CLOSES')])];
  const r = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')]), need([K('KNOWLEDGE.PRODUCT', 'CLOSES')])] }], same, vocab);
  assert.equal(r.goals_indistinguishable, 2);
  assert.equal(r.goal_covered, 2, 'coverage here is a claim about count, and the count above says so');
});

test('a case the planner never answered is reported, not skipped', () => {
  const r = scoreGoals([], oneGoal, vocab);
  assert.equal(r.unplanned_case, 1);
  assert.deepEqual(r.uncovered.map((u) => u.why), ['NO_PLAN']);
  assert.equal(r.goal_coverage, 0);
});

// ------------------------------------------------------------------ projection

test('projection drops what the new shape has no slot for, and corrects nothing else', () => {
  const v2 = { needs: [{ id: 'N1', ask: 'a', customer_inputs: [], steps: [
    { capability: 'KNOWLEDGE.CATALOGUE', role: 'CLOSES', scope: 'THIS_LISTING', fields: ['LISTING_SALE_STATUS'], effect: 'NONE', depends_on: null },
    { capability: 'SELLER', role: 'CONTEXT', scope: 'COMPANY', fields: [], effect: 'NONE', depends_on: 0 },
  ] }] };
  const { plan, changes } = C.project(v2, ix);
  assert.deepEqual(changes, { dropped_effect: 2, dropped_depends_on: 1, dropped_fields: 1, corrected_scope: 1 });
  assert.deepEqual(plan.needs[0].steps, [
    { capability: 'KNOWLEDGE.CATALOGUE', role: 'CLOSES', scope: 'THIS_LISTING' },
    { capability: 'SELLER', role: 'CONTEXT' },
  ]);
  assert.equal(C.parsePlan(plan, ix).failure, undefined, 'a projected plan is a v3 plan');
});

test('the v3.2 synthetic gold is itself a set of legal WP-3 plans', () => {
  const rows = readFileSync(join(here, '../../../contracts/inquiry-resolution-plan/v3.2/synthetic/plans.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows.length, 8);
  for (const r of rows) {
    const plan = { needs: [{ id: 'N1', ask: r.goal, steps: r.steps, customer_inputs: r.customer_inputs }] };
    const parsed = C.parsePlan(plan, ix);
    assert.equal(parsed.failure, undefined, `${r.q}.${r.goal} parses`);
    assert.deepEqual(C.validate(parsed.plan, ix), [], `${r.q}.${r.goal} holds the contract`);
  }
});

// ── WP-3.1: who closes ────────────────────────────────────────────────────────────────────────────────────────────
//
// The five refusals above are about shapes that cannot be written. These are about a shape that CAN be written and is
// wrong anyway — the defect the 67-call shadow of 2026-09-20 found. C03 in the shared fixture is contract-valid: it
// names the same authorities as C01 and differs only in which of them is allowed to end the goal. Nothing in the
// parser or the validator can refuse it, so the scorer must, and these tests are where that is pinned.

const goldGoal = (q, steps, inputs = []) => ({ q, goal: 'n1', status: 'FROZEN', steps, customer_inputs: inputs });
const CATALOGUE_CLOSES = goldGoal('C', [{ capability: 'KNOWLEDGE.CATALOGUE', role: 'CLOSES', scope: 'SELLER_CATALOGUE' }]);
const scenarioPlan = (id) => ({ q: 'C', needs: scenarios().find((s) => s.id === id).plan.needs });

test('a demoted authority is not a covered goal: knowledge answers it, the seller may not take the ending', () => {
  const right = scoreGoals([scenarioPlan('C01')], [CATALOGUE_CLOSES]);
  assert.equal(right.correct_closer, 1);
  assert.equal(right.wrong_closer.length, 0);
  assert.equal(right.fallback_authority_inserted.length, 0);
  assert.equal(right.goal_coverage, 1);

  const demoted = scoreGoals([scenarioPlan('C03')], [CATALOGUE_CLOSES]);
  assert.equal(demoted.correct_closer, 0, 'the goal is not correctly closed');
  assert.deepEqual(demoted.wrong_closer.map((w) => w.closed_by), [['SELLER']]);
  assert.deepEqual(demoted.fallback_authority_inserted, ['C.n1']);
  assert.equal(demoted.goal_coverage, 0);
  // and the distance between the two claims is exactly what the old headline reported as success
  assert.equal(demoted.required_authority_present, 1, 'the right authority IS in the plan — it just does not close');
  assert.equal(demoted.wrong_closer[0].demoted, true);
});

test('a capability gap is not a seller authority: substituting one is scored, not silently covered', () => {
  const gold = [goldGoal('C', [{ capability: 'KNOWLEDGE.PRODUCT', role: 'CLOSES' }])];
  const kept = scoreGoals([scenarioPlan('C04')], gold);
  assert.equal(kept.correct_closer, 1, 'keeping the unavailable authority is the correct plan');
  assert.equal(kept.fallback_authority_inserted.length, 0);

  const substituted = scoreGoals([scenarioPlan('C05')], gold);
  assert.equal(substituted.correct_closer, 0);
  assert.equal(substituted.required_authority_present, 0, 'here the authority is not merely demoted, it is gone');
  // A seller-only need shares no authority with a knowledge goal, so the assignment cannot place it and the goal is
  // reported unplanned. That is right, and on its own it is not enough: "nobody planned this" reads the same whether
  // the planner said nothing or put the seller in the missing capability's place. The second is counted by name.
  assert.deepEqual(substituted.uncovered, [{ goal: 'C.n1', why: 'NOT_PLANNED' }]);
  assert.equal(substituted.seller_only_extra_needs, 1);
  assert.equal(kept.seller_only_extra_needs, 0);
});

test('a genuine two-authority resolution still scores as correct — the rule is about endings, not about pairs', () => {
  const gold = [goldGoal('C', [{ capability: 'KNOWLEDGE.ORG', role: 'PRECONDITION' },
    { capability: 'SELLER', role: 'CLOSES' }])];
  const r = scoreGoals([scenarioPlan('C02')], gold);
  assert.equal(r.correct_closer, 1);
  assert.equal(r.fallback_authority_inserted.length, 0, 'the seller closing what the gold says it closes is not a fallback');
  assert.equal(r.goal_coverage, 1);
});

test('two endings in one need is never a correct close, however right one of them is', () => {
  const both = { q: 'C', needs: [{ id: 'N1', ask: '더 큰 규격 판매 여부', customer_inputs: [],
    steps: [{ capability: 'KNOWLEDGE.CATALOGUE', role: 'CLOSES', scope: 'SELLER_CATALOGUE' },
      { capability: 'SELLER', role: 'CLOSES' }] }] };
  const r = scoreGoals([both], [CATALOGUE_CLOSES]);
  assert.equal(r.ambiguous_closer.length, 1);
  assert.equal(r.correct_closer, 0, 'this is the shape the WP-2 headline of 1.000 counted as success');
  // the legacy metric still credits it, and that is exactly why both are reported
  assert.equal(r.required_authority_recall, 1);
  assert.equal(r.required_authority_present, 1);
});

test('an answer that never arrived is not a planning miss', () => {
  const rows = [{ q: 'C', rep: 1, plan: null, failure: 'TRUNCATED' }];
  const r = scoreGoals(plansFromObservation(rows), [CATALOGUE_CLOSES]);
  assert.deepEqual(r.envelope_failures, { TRUNCATED: 1 });
  assert.deepEqual(r.uncovered, [{ goal: 'C.n1', why: 'NO_ANSWER:TRUNCATED' }]);
  assert.equal(r.answered_cases, 0);
  // a truncated row contributes no closer verdict at all — it is not counted as a wrong one
  assert.equal(r.wrong_closer.length, 0);
  assert.equal(r.correct_closer, 0);
});
