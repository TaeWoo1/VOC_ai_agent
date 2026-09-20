// node --test tools/inquiry-need-eval/test/wp31.test.mjs
// The two WP-3.1 diagnostics: over-read/availability and closing-authority taxonomy. Both produce numbers a
// product-owner decision rests on, so every count below is worked out by hand from the row beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, goldEntityReads } from '../availability.mjs';
import { classify } from '../closers.mjs';
import { readFileSync } from 'node:fs';

const K = (capability, role, scope) => (scope ? { capability, role, scope } : { capability, role });
const E = (capability, role, fields) => ({ capability, role, fields });
const goal = (q, g, steps) => ({ q, goal: g, status: 'FROZEN', steps, customer_inputs: [] });

/** The Cafe24 exact-lookup snapshot the P01 smoke ran on: fulfillment readable, tracking readable nowhere. */
const ORDER_READABLE = {
  capabilities: { 'ENTITY.ORDER': 'AVAILABLE', 'KNOWLEDGE.PRODUCT': 'AVAILABLE', 'KNOWLEDGE.CATALOGUE': 'AVAILABLE',
    'KNOWLEDGE.ORG': 'AVAILABLE', 'ENTITY.LISTING': 'AVAILABLE', 'PROCEDURE.ORDER_ACTION': 'DECLARED_NO_EXECUTOR',
    SELLER: 'AVAILABLE' },
  fields: { ORDER_FULFILLMENT: 'AVAILABLE', ORDER_PAYMENT: 'AVAILABLE', ORDER_CANCELLATION: 'AVAILABLE',
    ORDER_TRACKING: 'NOT_SUPPORTED', LISTING_SALE_STATUS: 'AVAILABLE', LISTING_OPTION_SALE_STATUS: 'AVAILABLE' },
  order_bound: true,
};
const UNBOUND = { ...ORDER_READABLE, order_bound: false };

const row = (q, steps, registry = ORDER_READABLE) => ({
  q, rep: 1, registry, failure: null, availability: [],
  plan: { needs: [{ id: 'N1', ask: 'a', customer_inputs: [], steps }] },
});

test('an extra unreadable field turns a readable need into a gap, and the class says so', () => {
  const gold = [goal('P01', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])];
  const r = analyse([row('P01', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT', 'ORDER_TRACKING'])])], gold);
  assert.deepEqual(r.classes, { C_HARMFUL_OVER_READ: 1 });
  assert.deepEqual(r.steps[0].extra_unavailable, ['ORDER_TRACKING']);
  // the three semantics priced on the same step: only the first loses the answer
  assert.equal(r.steps[0].gap.ALL_OR_NOTHING, 'NOT_SUPPORTED');
  assert.equal(r.steps[0].gap.FIELD_LEVEL, null);
  assert.equal(r.steps[0].gap.NEED_MINIMUM, null);
  assert.deepEqual(r.flipped_by_over_read, [{ goal: 'P01.n1', field_level: 'RESOLVABLE' }]);
  assert.deepEqual(r.order_tracking, { steps_naming_it: 1, steps_it_alone_gapped: 1, goals_it_alone_blocked: ['P01.n1'] });
});

test('an extra field that IS readable costs nothing, and is not reported as harm', () => {
  const gold = [goal('P01', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])];
  const r = analyse([row('P01', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT', 'ORDER_PAYMENT'])])], gold);
  assert.deepEqual(r.classes, { B_HARMLESS_OVER_READ: 1 });
  assert.equal(r.flipped_by_over_read.length, 0);
  assert.deepEqual(r.goal_terminal.ALL_OR_NOTHING, { RESOLVABLE: 1 });
});

test('a field the need itself requires and the snapshot cannot read is not the planner\'s fault', () => {
  const gold = [goal('X', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_TRACKING'])])];
  const r = analyse([row('X', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_TRACKING'])])], gold);
  assert.deepEqual(r.classes, { D_GENUINELY_UNAVAILABLE: 1 });
  assert.equal(r.flipped_by_over_read.length, 0, 'no semantics can make an unreadable requirement readable');
  assert.equal(r.steps[0].gap.NEED_MINIMUM, 'NOT_SUPPORTED');
});

test('a gap the capability itself causes is never blamed on fields', () => {
  const gold = [goal('U', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])];
  const r = analyse([row('U', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT', 'ORDER_TRACKING'])], UNBOUND)], gold);
  assert.deepEqual(r.classes, { CAPABILITY_GAP: 1 });
  // all three agree, because the question was never about fields
  assert.deepEqual(Object.values(r.steps[0].gap), ['UNBOUND', 'UNBOUND', 'UNBOUND']);
  assert.equal(r.order_tracking.steps_it_alone_gapped, 0);
});

test('field-level availability can hide a gap the goal actually has — measured, not asserted', () => {
  // Two plans for the SAME goal on the SAME snapshot. The need wants fulfillment, which this snapshot cannot read.
  const snapshot = { ...ORDER_READABLE, fields: { ...ORDER_READABLE.fields, ORDER_FULFILLMENT: 'NOT_SUPPORTED' } };
  const gold = [goal('S', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])];
  const narrow = analyse([row('S', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])], snapshot)], gold);
  const wide = analyse([row('S', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT', 'ORDER_PAYMENT'])], snapshot)], gold);
  assert.equal(narrow.steps[0].gap.FIELD_LEVEL, 'NOT_SUPPORTED');
  assert.equal(wide.steps[0].gap.FIELD_LEVEL, null, 'the same unanswerable goal, now reported as answerable');
  // …because the planner happened to name one extra field that IS readable. Under field-level semantics, over-reading
  // stops being a cost and becomes a way to silence the gap. Both agree under the other two.
  assert.equal(narrow.steps[0].gap.NEED_MINIMUM, 'NOT_SUPPORTED');
  assert.equal(wide.steps[0].gap.NEED_MINIMUM, 'NOT_SUPPORTED');
});

test('gold entity reads must be unambiguous per case, or the pairing is refused rather than guessed', () => {
  assert.equal(goldEntityReads([goal('A', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_PAYMENT'])])]).size, 1);
  assert.throws(() => goldEntityReads([
    goal('A', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_PAYMENT'])]),
    goal('A', 'n2', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])]),
  ]), /pairing is not 1:1/);
});

// ── closers.mjs ───────────────────────────────────────────────────────────────────────────────────────────────────

const CATALOGUE = [goal('C', 'n1', [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'SELLER_CATALOGUE')])];

test('the taxonomy separates a genuine seller judgment from a seller appended behind knowledge', () => {
  const right = classify([row('C', [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'SELLER_CATALOGUE')])], CATALOGUE);
  assert.deepEqual(right.taxonomy, { CORRECT_CLOSER: 1 });

  const demoted = classify([row('C', [K('KNOWLEDGE.CATALOGUE', 'PRECONDITION', 'SELLER_CATALOGUE'),
    K('SELLER', 'CLOSES')])], CATALOGUE);
  assert.deepEqual(demoted.taxonomy, { B_OPERATIONAL_FALLBACK: 1 });
  assert.equal(demoted.seller_last_written, 1, 'the mechanism: the seller is the last step written');
  assert.equal(demoted.closer.wrong, 1);

  const genuine = classify([row('C', [K('KNOWLEDGE.ORG', 'PRECONDITION'), K('SELLER', 'CLOSES')])],
    [goal('C', 'n1', [K('KNOWLEDGE.ORG', 'PRECONDITION'), K('SELLER', 'CLOSES')])]);
  assert.deepEqual(genuine.taxonomy, { A_GENUINE_MULTI_AUTHORITY: 1 });
  assert.equal(genuine.closer.correct, 1);
});

test('a seller standing where an unavailable capability should be is its own category', () => {
  const snapshot = { ...ORDER_READABLE, capabilities: { ...ORDER_READABLE.capabilities, 'KNOWLEDGE.PRODUCT': 'NOT_SUPPORTED' } };
  const gold = [goal('G', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')])];
  const r = classify([{ ...row('G', [K('KNOWLEDGE.PRODUCT', 'CONTEXT'), K('SELLER', 'CLOSES')], snapshot) }], gold);
  assert.deepEqual(r.taxonomy, { B_OPERATIONAL_FALLBACK: 1 }, 'the authority is present, so the seller took the ending');

  // The unit is the AUTHORITY, not the capability: reading KNOWLEDGE.ORG where the gold wants KNOWLEDGE.PRODUCT is a
  // capability mismatch inside a plan that did reach for knowledge, so the seller still TOOK the ending above.
  // Substitution means the gold's authority is not in the plan at all — and then availability decides which word it is.
  const absentButAvailable = classify([row('G', [E('ENTITY.LISTING', 'CONTEXT', ['LISTING_SALE_STATUS']),
    K('SELLER', 'CLOSES')])], gold);
  assert.deepEqual(absentButAvailable.taxonomy, { B_SELLER_SUBSTITUTED: 1 });
  const absentAndUnavailable = classify([row('G', [E('ENTITY.LISTING', 'CONTEXT', ['LISTING_SALE_STATUS']),
    K('SELLER', 'CLOSES')], snapshot)], gold);
  assert.deepEqual(absentAndUnavailable.taxonomy, { C_CAPABILITY_GAP_FALLBACK: 1 },
    'the capability the gold requires cannot act here, and the seller was put in its place');
});

test('two endings inside one need is the WP-2 shape, and is not a category of seller use', () => {
  const r = classify([row('C', [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'SELLER_CATALOGUE'), K('SELLER', 'CLOSES')])],
    CATALOGUE);
  assert.deepEqual(r.taxonomy, { WP2_AMBIGUOUS_CO_CLOSER: 1 });
  assert.equal(r.closer.correct, 0, 'the plan names the right authority and does not say it is the answer');
});

test('a goal split across needs keeps its correct ending — split-tolerance is not ambiguity', () => {
  const gold = [goal('P', 'n1', [E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_FULFILLMENT']),
    K('PROCEDURE.ORDER_ACTION', 'CLOSES')])];
  const split = {
    q: 'P', rep: 1, registry: ORDER_READABLE, failure: null, availability: [],
    plan: { needs: [
      { id: 'N1', ask: 'a', customer_inputs: [], steps: [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])] },
      { id: 'N2', ask: 'b', customer_inputs: [], steps: [E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_FULFILLMENT']),
        K('PROCEDURE.ORDER_ACTION', 'CLOSES')] },
    ] },
  };
  const r = classify([split], gold);
  assert.deepEqual(r.taxonomy, { CORRECT_CLOSER_VIA_SPLIT: 1 });
  assert.equal(r.closer.correct, 1);
});

// ── Candidate C: the ending is declared, and position means nothing ────────────────────────────────────────────────

const declared = (q, closing, steps, registry = ORDER_READABLE) => ({
  q, rep: 1, registry, failure: null, availability: [],
  plan: { needs: [{ id: 'N1', ask: 'a', closing_authority: closing, customer_inputs: [], steps }] },
});
const declaredGoal = (q, closing, steps) => ({ q, goal: 'n1', status: 'FROZEN', closing_authority: closing, steps,
  customer_inputs: [] });

test('the same steps in any order resolve the same way — the WP-3.1 property, through the scorers', () => {
  const gold = [declaredGoal('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.CATALOGUE', scope: 'SELLER_CATALOGUE' }])];
  const steps = [{ capability: 'KNOWLEDGE.CATALOGUE', scope: 'SELLER_CATALOGUE' }, { capability: 'SELLER' }];
  for (const order of [steps, [...steps].reverse()]) {
    const r = classify([declared('C', 'KNOWLEDGE', order)], gold);
    assert.deepEqual(r.taxonomy, { CORRECT_CLOSER: 1 }, JSON.stringify(order));
    assert.equal(r.closer.correct, 1);
  }
  // …and the same two steps with the OTHER ending declared are wrong in both orders, for the same reason
  for (const order of [steps, [...steps].reverse()]) {
    const r = classify([declared('C', 'SELLER', order)], gold);
    assert.deepEqual(r.taxonomy, { B_OPERATIONAL_FALLBACK: 1 }, JSON.stringify(order));
  }
});

test('two knowledge capabilities resolving together are both closers, which is what the gold needs', () => {
  const gold = [declaredGoal('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.CATALOGUE', scope: 'SELLER_CATALOGUE' },
    { capability: 'KNOWLEDGE.PRODUCT' }])];
  const r = classify([declared('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.CATALOGUE', scope: 'SELLER_CATALOGUE' },
    { capability: 'KNOWLEDGE.PRODUCT' }])], gold);
  assert.deepEqual(r.taxonomy, { CORRECT_CLOSER: 1 });
  assert.equal(r.detail[0].predicted_closes.length, 1, 'one authority…');
  // 3 of the 4 gold goals with this shape were WP-4 failures; the shape is now sayable in one field
});

test('an unavailable capability does not change the declared resolution', () => {
  const noKnowledge = { ...ORDER_READABLE,
    capabilities: { ...ORDER_READABLE.capabilities, 'KNOWLEDGE.PRODUCT': 'NOT_SUPPORTED' } };
  const gold = [declaredGoal('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.PRODUCT' }])];
  const r = classify([declared('C', 'KNOWLEDGE', [{ capability: 'KNOWLEDGE.PRODUCT' }], noKnowledge)], gold);
  assert.deepEqual(r.taxonomy, { CORRECT_CLOSER: 1 },
    'keeping the authority the need requires is the right plan even where it cannot act');
  assert.equal(r.detail[0].gold_authority_can_act, false, 'and the gap is recorded rather than routed around');
});

/**
 * The structural half of Candidate C: nothing in the scoring path may work out a closer from where a step stands.
 * The only runtime reads of the retired role token are the two places that exist to understand RECORDED runs — the
 * scorer's legacy fallback and the projection — and this test pins their number so a third cannot appear quietly.
 */
test('no closing authority is derived from position anywhere in the scoring path', () => {
  const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  const closes = (f) => (src(f).match(/'CLOSES'/g) ?? []).length;
  assert.equal(closes('goals.mjs'), 1, 'only closingOf(), reading a run recorded before WP-3.1');
  assert.equal(closes('closers.mjs'), 0);
  assert.equal(closes('availability.mjs'), 0);
  assert.equal(closes('contract.mjs'), 1, 'only project(), reading a plan recorded before WP-3.1');
  // And no scorer TAKES the last step as the answer. closers.mjs reads it exactly once and does not decide with it:
  // `seller_last_written` is the measurement that proved the mechanism (49 of 49 in WP-2, 6 of 6 in WP-4), and a
  // measurement of the habit is the opposite of obeying it. The count is pinned so a second read cannot appear here
  // without someone saying why.
  const lastStep = (f) => (src(f).match(/steps\.length\s*-\s*1/g) ?? []).length;
  assert.equal(lastStep('goals.mjs'), 0);
  assert.equal(lastStep('availability.mjs'), 0);
  assert.equal(lastStep('closers.mjs'), 1, 'only seller_last_written, which reports the habit and obeys nothing');
  assert.ok(/seller_last_written/.test(src('closers.mjs')));
  // the verdict itself is read from the declared field
  assert.ok(/closes\.has\(goldCloser\)/.test(src('closers.mjs')));
});
