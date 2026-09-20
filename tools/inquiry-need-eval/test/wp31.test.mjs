// node --test tools/inquiry-need-eval/test/wp31.test.mjs
// The two WP-3.1 diagnostics: over-read/availability and closing-authority taxonomy. Both produce numbers a
// product-owner decision rests on, so every count below is worked out by hand from the row beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, goldEntityReads } from '../availability.mjs';
import { classify } from '../closers.mjs';

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
