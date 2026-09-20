// node --test tools/inquiry-need-eval/test/goals.test.mjs
// The contract mirror and the split-tolerant goal scorer. Every count below is worked out by hand from the fixture it
// names, never copied from a run.
//
// NOTATION. A WP-3.1 step has no role: the NEED declares closing_authority. The helpers below still let a test write
// which step closes, because that is what the test means — `goal(...)` and `need(...)` read the roles, derive the
// declared ending from them, and emit roleless steps. So every call site says what it always said, and what reaches
// the scorer is the shape the contract now has.
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
const scenarios = () => readFileSync(join(here, '../../../contracts/inquiry-planner/v3/synthetic/planner-scenarios.jsonl'),
  'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const K = (capability, role, scope) => (scope ? { capability, role, scope } : { capability, role });
const E = (capability, role, fields) => ({ capability, role, fields });
const authorityOf = (capability) => ix.authority.get(capability);
const roleless = (steps) => steps.map(({ role, ...rest }) => rest);
const closingOf = (steps) => [...new Set(steps.filter((s) => s.role === 'CLOSES').map((x) => authorityOf(x.capability)))][0];
const goal = (q, g, steps, customer_inputs = []) => ({ q, goal: g, status: 'FROZEN',
  closing_authority: closingOf(steps), steps: roleless(steps), customer_inputs });
const need = (steps, customer_inputs = []) => ({ closing_authority: closingOf(steps), steps: roleless(steps),
  customer_inputs });
/** A need in the shape recorded BEFORE WP-3.1 — roles, no declared ending. The scorer still reads these. */
const legacyNeed = (steps, customer_inputs = []) => ({ steps, customer_inputs });
const plan = (closing, steps, customer_inputs = []) => ({ needs: [{ id: 'N1', ask: 'a',
  closing_authority: closing, steps: roleless(steps), customer_inputs }] });

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
  assert.equal(parsed, 32);   // 26 valid + 6 refused by the validator
  assert.equal(refused, 13);  // shapes that cannot be written at all
});

test('a capability class cannot carry what it has no use for', () => {
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.ORG', fields: ['ORDER_PAYMENT'] }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.ORG', scope: 'COMPANY' }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'SELLER', scope: 'NONE' }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'ENTITY.ORDER', fields: [] }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'ENTITY.ORDER', fields: ['LISTING_SALE_STATUS'] }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'PROCEDURE.ORDER_ACTION', effect: 'EXTERNAL_STATE_CHANGE' }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.PRODUCT', depends_on: 0 }, ix).failure, 'PLAN_SHAPE');
  // WP-3.1: role joins them. An answer written against v3 is refused rather than half-read.
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.PRODUCT', role: 'CLOSES' }, ix).failure, 'PLAN_SHAPE');
  assert.equal(C.parseStep({ capability: 'ENTITY.ORDER', role: 'PRECONDITION', fields: ['ORDER_PAYMENT'] }, ix).failure,
    'PLAN_SHAPE');
  // and an unknown word is a different refusal from an impossible object
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.SHIPPING' }, ix).failure, 'PLAN_SET');
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.CATALOGUE', scope: 'COMPANY' }, ix).failure, 'PLAN_SET');
  // what remains legal
  assert.deepEqual(C.parseStep({ capability: 'KNOWLEDGE.ORG' }, ix).step,
    { capability: 'KNOWLEDGE.ORG', scope: 'COMPANY' });
  assert.equal(C.parseStep({ capability: 'KNOWLEDGE.CATALOGUE', scope: 'SELLER_CATALOGUE' }, ix).step.scope,
    'SELLER_CATALOGUE');
  // an unknown ending is an unknown word; a missing one is not a plan
  assert.equal(C.parsePlan(plan('CONNECTOR', [K('KNOWLEDGE.ORG', 'CLOSES')]), ix).failure, 'PLAN_SET');
  assert.equal(C.parsePlan({ needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
    steps: [{ capability: 'KNOWLEDGE.ORG' }] }] }, ix).failure, 'UNPARSEABLE');
});

test('a procedure resolution requires the order read — an ABSENCE rule, not a position rule', () => {
  assert.deepEqual(C.validate(plan('PROCEDURE', [K('PROCEDURE.ORDER_ACTION', 'CLOSES')]), ix).map((v) => v.code),
    ['PROCEDURE_WITHOUT_ORDER_READ']);
  const withRead = plan('PROCEDURE',
    [E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_FULFILLMENT']), K('PROCEDURE.ORDER_ACTION', 'CLOSES')]);
  assert.deepEqual(C.validate(withRead, ix), []);
  // WP-3.1: and the same steps in the other order are equally valid, because position is not the rule
  const reversed = plan('PROCEDURE',
    [K('PROCEDURE.ORDER_ACTION', 'CLOSES'), E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_CANCELLATION'])]);
  assert.deepEqual(C.validate(reversed, ix), [], 'the read is present; where it stands is style, not contract');
});

test('the declared resolution must be one the plan asked for', () => {
  // "the seller resolves this" with nothing for the seller to do
  assert.deepEqual(C.validate(plan('SELLER', [K('KNOWLEDGE.PRODUCT', 'CLOSES')]), ix).map((v) => v.code),
    ['CLOSING_AUTHORITY_UNSUPPORTED']);
  assert.deepEqual(C.validate(plan('SELLER', [K('KNOWLEDGE.ORG', 'CLOSES'), K('SELLER', 'CLOSES')]), ix), []);
});

// ------------------------------------------- seller authority vs operational handoff

test('two endings are no longer refused — they are unwritable', () => {
  // Under v3 this need was the "just in case, the seller" shape and earned MULTIPLE_CLOSING_AUTHORITIES. Under WP-3.1
  // there is one enum value and no way to say it at all: the plan below states ONE ending, and the seller step beside
  // it is simply a capability the resolution requires.
  assert.deepEqual(C.validate(plan('KNOWLEDGE', [K('KNOWLEDGE.PRODUCT', 'CLOSES'), K('SELLER', 'CLOSES')]), ix), []);
  // which is why a scorer, not a validator, is what refuses the fallback — see the closing-authority tests below
  assert.deepEqual(C.validate(plan('SELLER', [K('KNOWLEDGE.ORG', 'PRECONDITION'), K('SELLER', 'CLOSES')]), ix), []);
  assert.deepEqual(C.validate(plan('SELLER', [K('SELLER', 'CLOSES')]), ix), []);
  assert.deepEqual(C.validate(plan('SELLER',
    [E('ENTITY.LISTING', 'CONTEXT', ['LISTING_OPTION_SALE_STATUS']), K('SELLER', 'CLOSES')]), ix), []);
});

test('two capabilities of ONE authority resolving together is how the gold answers four of its goals', () => {
  assert.deepEqual(C.validate(plan('KNOWLEDGE',
    [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'THIS_LISTING'), K('KNOWLEDGE.PRODUCT', 'CLOSES')]), ix), []);
  // and the scorer sees both of them as the closers, because they belong to the declared authority
  const together = [goal('C1', 'n1',
    [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'THIS_LISTING'), K('KNOWLEDGE.PRODUCT', 'CLOSES')])];
  const r = scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'THIS_LISTING'),
    K('KNOWLEDGE.PRODUCT', 'CLOSES')])] }], together, vocab);
  assert.equal(r.correct_closer, 1);
  assert.equal(r.capability_mismatch.length, 0);
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
  assert.deepEqual(C.validate(plan('ENTITY_STATE', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])],
    ['ORDER_NUMBER']), ix).map((v) => v.code), ['IDENTITY_INPUT']);
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
  const { plan: projected, changes } = C.project(v2, ix);
  assert.deepEqual(changes, { dropped_effect: 2, dropped_depends_on: 1, dropped_fields: 1, corrected_scope: 1,
    dropped_role: 2, closing_authority_from_roles: 1 });
  assert.deepEqual(projected.needs[0].steps, [
    { capability: 'KNOWLEDGE.CATALOGUE', scope: 'THIS_LISTING' },
    { capability: 'SELLER' },
  ]);
  // WP-3.1: the ending the older plan expressed with roles is read off the roles, once, and written down
  assert.equal(projected.needs[0].closing_authority, 'KNOWLEDGE');
  assert.equal(C.parsePlan(projected, ix).failure, undefined, 'a projected plan is a WP-3.1 plan');
});

test('a projection cannot choose between two endings, and says so instead of picking one', () => {
  const twoEndings = { needs: [{ id: 'N1', ask: 'a', customer_inputs: [], steps: [
    { capability: 'KNOWLEDGE.PRODUCT', role: 'CLOSES' },
    { capability: 'SELLER', role: 'CLOSES' },
  ] }] };
  const { plan: projected, changes } = C.project(twoEndings, ix);
  assert.equal(projected.needs[0].closing_authority, null,
    'the recorded plan named two endings; the projection has nothing to declare');
  assert.equal(changes.closing_authority_from_roles, 0);
  assert.equal(C.parsePlan(projected, ix).failure, 'UNPARSEABLE',
    'and it is not silently turned into a WP-3.1 plan that says something the model never said');
});

test('the v3.3 synthetic gold is itself a set of legal WP-3.1 plans', () => {
  const rows = readFileSync(join(here, '../../../contracts/inquiry-resolution-plan/v3.3/synthetic/plans.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows.length, 8);
  for (const r of rows) {
    const row = { needs: [{ id: 'N1', ask: r.goal, closing_authority: r.closing_authority, steps: r.steps,
      customer_inputs: r.customer_inputs }] };
    const parsed = C.parsePlan(row, ix);
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

const goldGoal = (q, closing, steps, inputs = []) => ({ q, goal: 'n1', status: 'FROZEN',
  closing_authority: closing, steps, customer_inputs: inputs });
const CATALOGUE_CLOSES = goldGoal('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.CATALOGUE', scope: 'SELLER_CATALOGUE' }]);
const scenarioPlan = (id) => ({ q: 'C', needs: scenarios().find((s) => s.id === id).plan.needs });

test('a demoted authority is not a covered goal: knowledge answers it, the seller may not take the ending', () => {
  const right = scoreGoals([scenarioPlan('C7')], [CATALOGUE_CLOSES]);
  assert.equal(right.correct_closer, 1);
  assert.equal(right.wrong_closer.length, 0);
  assert.equal(right.fallback_authority_inserted.length, 0);
  assert.equal(right.goal_coverage, 1);

  const demoted = scoreGoals([scenarioPlan('C11')], [CATALOGUE_CLOSES]);
  assert.equal(demoted.correct_closer, 0, 'the goal is not correctly closed');
  assert.deepEqual(demoted.wrong_closer.map((w) => w.closed_by), [['SELLER']]);
  assert.deepEqual(demoted.fallback_authority_inserted, ['C.n1']);
  assert.equal(demoted.goal_coverage, 0);
  // and the distance between the two claims is exactly what the old headline reported as success
  assert.equal(demoted.required_authority_present, 1, 'the right authority IS in the plan — it just does not close');
  assert.equal(demoted.wrong_closer[0].demoted, true);
});

test('a capability gap is not a seller authority: substituting one is scored, not silently covered', () => {
  const gold = [goldGoal('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.PRODUCT' }])];
  const kept = scoreGoals([scenarioPlan('C8')], gold);
  assert.equal(kept.correct_closer, 1, 'keeping the unavailable authority is the correct plan');
  assert.equal(kept.fallback_authority_inserted.length, 0);

  const substituted = scoreGoals([scenarioPlan('C9')], gold);
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
  const gold = [goldGoal('C', 'SELLER', [{ capability: 'KNOWLEDGE.ORG' }, { capability: 'SELLER' }])];
  const r = scoreGoals([scenarioPlan('C6')], gold);
  assert.equal(r.correct_closer, 1);
  assert.equal(r.fallback_authority_inserted.length, 0, 'the seller closing what the gold says it closes is not a fallback');
  assert.equal(r.goal_coverage, 1);
});

test('two endings in one need is never a correct close, however right one of them is', () => {
  // the shape RECORDED before WP-3.1 — two endings in one need. It cannot be written now, and the scorer still
  // reads it, because the WP-2 comparison in docs/inquiry_architecture_v3_wp31.md §6 is scored from rows like this.
  const both = { q: 'C', needs: [legacyNeed([{ capability: 'KNOWLEDGE.CATALOGUE', role: 'CLOSES', scope: 'SELLER_CATALOGUE' },
    { capability: 'SELLER', role: 'CLOSES' }])] };
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

// ── WP-3.2: scope, and the residuals no shape rule can catch ──────────────────────────────────────────────────────

test('right capability, wrong instance is its own verdict — it used to pass silently', () => {
  const wide = [goldGoal('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.CATALOGUE', scope: 'SELLER_CATALOGUE' }])];
  const narrow = scoreGoals([scenarioPlan('C13')], wide);   // THIS_LISTING answered where the range was asked
  assert.equal(narrow.scope.capability_present, 1, 'the capability is right…');
  assert.equal(narrow.capability_mismatch.length, 0, '…so the capability comparison is happy, and useless here');
  assert.equal(narrow.scope.scope_wrong, 1, 'and the scope comparison is not');
  assert.deepEqual(narrow.scope.wrong_scope_detail[0],
    { goal: 'C.n1', capability: 'KNOWLEDGE.CATALOGUE', expected: 'SELLER_CATALOGUE', got: 'THIS_LISTING' });
  assert.equal(narrow.scope.scope_accuracy, 0);

  // the same fixture against the gold it actually answers scores clean — the metric is not simply preferring one value
  const listing = [goldGoal('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.CATALOGUE', scope: 'THIS_LISTING' }])];
  const right = scoreGoals([scenarioPlan('C13')], listing);
  assert.equal(right.scope.scope_correct, 1);
  assert.equal(right.scope.scope_wrong, 0);
  assert.equal(right.scope.scope_accuracy, 1);
});

test('scope is only counted where the capability had a choice to make', () => {
  // KNOWLEDGE.PRODUCT is about one instance, so its scope cannot be wrong and is not in the denominator
  const gold = [goldGoal('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.PRODUCT' }])];
  const r = scoreGoals([scenarioPlan('C1')], gold);
  assert.equal(r.scope.steps_compared, 1);
  assert.equal(r.scope.scope_decidable, 0, 'nothing to get wrong, so nothing to score');
  assert.equal(r.scope.scope_accuracy, null);
});

test('a capability that cannot act here, planned exactly right, is counted as such and not as an error', () => {
  const gold = [goldGoal('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.PRODUCT' }])];
  const noProduct = { capabilities: { 'KNOWLEDGE.PRODUCT': 'NOT_SUPPORTED' } };
  const rows = [{ q: 'C', rep: 1, registry: noProduct, failure: null,
    plan: { needs: [{ id: 'N1', ask: 'a', closing_authority: 'KNOWLEDGE', customer_inputs: [],
      steps: [{ capability: 'KNOWLEDGE.PRODUCT' }] }] } }];
  const r = scoreGoals(plansFromObservation(rows), gold);
  assert.equal(r.correct_closer, 1);
  assert.equal(r.scope.unavailable_but_correct, 1);
  assert.equal(r.scope.capability_missing, 0);
});

test('a procedure planned as a follow-up is refused; the same follow-up split into a need is NOT — and is measured', () => {
  // (a) inside the need: the shape rule catches it
  assert.deepEqual(C.validate(C.parsePlan(scenarios().find((s) => s.id === 'C12').plan, ix).plan, ix)
    .map((v) => v.code), ['PROCEDURE_NOT_CLOSING']);

  // (b) split into a second need: every need satisfies the rule on its own, so nothing structural sees it.
  // This is the C6 residual of the Candidate C smoke. What catches it is procedure_for_read on a goal whose
  // answer is a judgment — a measurement, and the honest answer to "can a contract forbid this": not per need.
  const judgment = [goldGoal('C', 'SELLER', [{ capability: 'KNOWLEDGE.ORG' }, { capability: 'SELLER' }])];
  const split = { q: 'C', needs: [
    { id: 'N1', ask: 'a', closing_authority: 'SELLER', customer_inputs: [],
      steps: [{ capability: 'KNOWLEDGE.ORG' }, { capability: 'SELLER' }] },
    // the shape the model actually wrote for C6: the follow-up need re-reads the policy, so it shares an authority
    // with the goal and the assignment places it there
    { id: 'N2', ask: 'b', closing_authority: 'PROCEDURE', customer_inputs: [],
      steps: [{ capability: 'ENTITY.ORDER', fields: ['ORDER_FULFILLMENT'] },
        { capability: 'KNOWLEDGE.ORG' }, { capability: 'PROCEDURE.ORDER_ACTION' }] }] };
  for (const n of split.needs) {
    assert.deepEqual(C.validate({ needs: [{ ...n, id: 'N1' }] }, ix), [], `${n.id} is a legal need on its own`);
  }
  const r = scoreGoals([split], judgment);
  assert.equal(r.correct_closer, 1, 'the ending is still right');
  assert.deepEqual(r.procedure_for_read, ['C.n1'], 'and a state-changing authority arrived on a judgment goal');
  assert.equal(r.unnecessary_authority_goals, 1);

  // and when the invented need shares no authority with the goal at all, it is still counted — as a need that
  // serves nothing. Either way the over-split is a number; neither way is it a contract violation.
  const disjoint = { q: 'C', needs: [split.needs[0],
    { id: 'N2', ask: 'b', closing_authority: 'PROCEDURE', customer_inputs: [],
      steps: [{ capability: 'ENTITY.ORDER', fields: ['ORDER_FULFILLMENT'] },
        { capability: 'PROCEDURE.ORDER_ACTION' }] }] };
  const d = scoreGoals([disjoint], judgment);
  assert.equal(d.correct_closer, 1);
  assert.equal(d.planner_only_extra_needs, 1);
  assert.deepEqual(d.procedure_for_read, []);
});

test('a plan naming one capability about two instances is judged on the one the goal asked for', () => {
  // the shape the v5 smoke produced for C7: this listing in one need, the seller's range in another
  const wide = [goldGoal('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.CATALOGUE', scope: 'SELLER_CATALOGUE' }])];
  const both = { q: 'C', needs: [
    { id: 'N1', ask: 'a', closing_authority: 'KNOWLEDGE', customer_inputs: [],
      steps: [{ capability: 'KNOWLEDGE.CATALOGUE', scope: 'THIS_LISTING' }] },
    { id: 'N2', ask: 'b', closing_authority: 'KNOWLEDGE', customer_inputs: [],
      steps: [{ capability: 'KNOWLEDGE.CATALOGUE', scope: 'SELLER_CATALOGUE' }] }] };
  const r = scoreGoals([both], wide);
  assert.equal(r.scope.scope_correct, 1, 'the plan contains the instance the goal asked about');
  assert.equal(r.scope.scope_wrong, 0, 'and is not judged on whichever step happened to come first');
  assert.equal(r.scope.capability_extra, 1, 'the other instance is still an extra read, and is counted');
});
