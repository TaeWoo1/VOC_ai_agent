// node --test tools/inquiry-need-eval/test/plan.test.mjs
// Resolution-plan gold (Inquiry v3 WP-1). Counts below are worked out by hand from
// contracts/inquiry-resolution-plan/v3/synthetic/plans.jsonl, not copied from a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJsonl } from '../io.mjs';
import { compareResolutions, distribution, loadVocabulary, scoreBridge, scorePlans, validatePlans } from '../plan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const gold = () => readJsonl(join(here, '../../../contracts/inquiry-resolution-plan/v3/synthetic/plans.jsonl'));
const clone = (x) => JSON.parse(JSON.stringify(x));

test('the synthetic plan gold validates', () => {
  assert.deepEqual(validatePlans(gold()), []);
});

test('the validator refuses what a plan must never say', () => {
  const g = clone(gold());
  g[0].customer_inputs = ['ORDER_NUMBER'];                                  // identity is never asked
  g[1].steps[0].capability = 'KNOWLEDGE.SHIPPING';                            // not a registry id
  g[2].expected_terminal = { state: 'CAPABILITY_GAP' };                             // a gap names its reason
  g[3].expected_terminal = { state: 'RESOLVED' };                                   // a procedure has no executor
  g[4].steps[0].fields = ['ORDER_PAYMENT'];                                   // a listing step names listing fields
  g[5].steps = [{ capability: 'ENTITY.LISTING', role: 'CONTEXT' }];           // nothing closes it
  g[6].alternatives = [];                                                     // a frozen row has no alternatives
  const e = validatePlans(g).join('\n');
  for (const m of [/ORDER_NUMBER is identity/, /unknown capability KNOWLEDGE.SHIPPING/, /gap given exactly/,
    /procedure without an executor/, /field ORDER_PAYMENT is not ENTITY.LISTING/, /no CLOSES step/, /frozen row carries no alternatives/]) {
    assert.match(e, m);
  }
});

test('the v2 bridge is scored against frozen rows only, and its disagreements are named', () => {
  const b = scoreBridge(gold());
  assert.equal(b.frozen, 7);
  assert.equal(b.pending, 1);
  // p4 (SELLER_DECISION that is really a procedure) and p5 (availability that is really listing state)
  assert.deepEqual(b.disagreements.map((d) => d.need), ['S:p4.n1', 'S:p5.n1']);
  assert.equal(b.authority_agreement, 5 / 7);
});

test('a predicted plan that forgets the order is a hard miss even when everything else is right', () => {
  const g = gold();
  const pred = clone(g).map((r) => ({ q: r.q, need: r.need, steps: r.steps, customer_inputs: r.customer_inputs }));
  pred[2].steps = [{ capability: 'KNOWLEDGE.ORG', role: 'CLOSES' }];         // p3: a company rule for this order
  pred[1].customer_inputs = [];                                               // p2: forgot to ask the option
  pred[0].steps = [...pred[0].steps, { capability: 'SELLER', role: 'CLOSES' }]; // p1: an authority the gold does not need
  const s = scorePlans(pred, g);
  assert.equal(s.needs, 7);
  assert.deepEqual(s.order_misses, ['S:p3.n1']);                            // p4 kept its order precondition
  assert.equal(s.required_authority_recall, 6 / 7);
  assert.equal(s.unnecessary, 2);                                             // p1 SELLER, p3 KNOWLEDGE
  assert.equal(s.slot_exact, 6 / 7);
});

test('distribution counts plan shapes and expected terminals of frozen rows', () => {
  const d = distribution(gold());
  assert.equal(d.shape.KNOWLEDGE, 2);
  assert.equal(d.shape['KNOWLEDGE+CUSTOMER_INPUT'], 1);
  assert.equal(d.shape['PROCEDURE+ENTITY_STATE+KNOWLEDGE'], 1);
  assert.equal(d.terminal['CAPABILITY_GAP:NOT_EXECUTABLE'], 1);
  assert.equal(d.terminal.NEEDS_SELLER, 2);
  assert.equal(loadVocabulary().authorities.length, 4);
});

test('layer resolutions against the gold terminal: a possible gap is never a verdict', () => {
  const obs = [
    { q: 'S:p1', need: 'n1', resolution: 'RESOLVED' },                              // agrees
    { q: 'S:p3', need: 'n1', resolution: 'CAPABILITY_GAP', gap: 'UNBOUND' },         // agrees
    { q: 'S:p4', need: 'n1', resolution: 'NEEDS_SELLER' },                           // bridge: a procedure called a seller need
    { q: 'S:p7', need: 'n1', resolution: 'CAPABILITY_GAP', gap: 'UNREADABLE_SOURCE' }, // maybe in the pictures
    { q: 'S:p8', need: 'n1', resolution: 'NEEDS_SELLER' },                           // pending row: not compared
  ];
  const c = compareResolutions(obs, gold());
  assert.equal(c.compared, 4);
  assert.equal(c.agree, 2);
  assert.equal(c.possible_gap, 1);
  assert.deepEqual(c.differ, [{ need: 'S:p4.n1', expected: 'CAPABILITY_GAP:NOT_EXECUTABLE', got: 'NEEDS_SELLER' }]);
});
