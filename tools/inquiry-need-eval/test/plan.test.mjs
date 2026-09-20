// node --test tools/inquiry-need-eval/test/plan.test.mjs
// Resolution-plan gold (Inquiry v3 WP-1). Counts below are worked out by hand from
// contracts/inquiry-resolution-plan/v3.1/synthetic/plans.jsonl, not copied from a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJsonl } from '../io.mjs';
import { compareResolutions, distribution, loadVocabulary, plansFromObservation, scoreBridge, scorePlans, validatePlans } from '../plan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const gold = () => readJsonl(join(here, '../../../contracts/inquiry-resolution-plan/v3.1/synthetic/plans.jsonl'));
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
  g[2].steps[0].scope = 'COMPANY';                                            // an order step about the company
  g[3].steps[1].effect = 'NONE';                                              // a procedure that changes nothing
  g[0].steps[0].effect = 'BOUNDED_WORKFLOW';                                  // an effect on a step that acts on nothing
  const e = validatePlans(g).join('\n');
  for (const m of [/ORDER_NUMBER is identity/, /unknown capability KNOWLEDGE.SHIPPING/, /gap given exactly/,
    /procedure without an executor/, /field ORDER_PAYMENT is not ENTITY.LISTING/, /no CLOSES step/, /frozen row carries no alternatives/,
    /ENTITY.ORDER is never about COMPANY/, /a procedure states the change it makes/, /only a procedure has an effect/]) {
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

test('a predicted plan is scored on every axis the product owner named', () => {
  const g = gold();
  const pred = clone(g).map((r) => ({ q: r.q, need: r.need, steps: r.steps, customer_inputs: r.customer_inputs }));
  pred[2].steps = [{ capability: 'KNOWLEDGE.ORG', role: 'CLOSES', scope: 'COMPANY', effect: 'NONE' }]; // p3: a rule for this order
  pred[1].customer_inputs = [];                                                                        // p2: forgot to ask the option
  pred[0].steps = [...pred[0].steps, { capability: 'SELLER', role: 'CLOSES', scope: 'NONE', effect: 'NONE' }];
  pred[4].steps = [{ ...pred[4].steps[0], fields: ['LISTING_SALE_STATUS'] }];                           // p5: the listing, not the option
  pred[3].steps = [pred[3].steps[1], pred[3].steps[0], pred[3].steps[2]];                               // p4: acts before it reads
  const s = scorePlans(pred, g);
  assert.equal(s.needs, 7);
  assert.equal(s.missing_prediction, 0);
  assert.equal(s.authority_recall, 6 / 7);                       // p3 lost ENTITY_STATE
  assert.deepEqual(s.missing_required_authority.map((x) => x.need), ['S:p3.n1']);
  assert.deepEqual(s.order_misses, ['S:p3.n1']);
  assert.equal(s.unnecessary_authority, 2);                      // p1 SELLER, p3 KNOWLEDGE
  assert.deepEqual(s.procedure_for_read, []);
  assert.equal(s.customer_input_correct, 6 / 7);
  assert.equal(s.entity_scope_compared, 9);                      // every gold step the prediction also names (p3 lost its own)
  assert.equal(s.entity_scope_accuracy, 8 / 9);                  // p5's fields differ
  assert.equal(s.sequence_compared, 1);                          // only p4 has more than one ACTING step
  assert.equal(s.sequence_correct, 0);                           // and the prediction acts before it reads
  assert.equal(s.invalid_capability_selection, 0);
});

test('a procedure predicted where reading resolves it is called out by name', () => {
  const g = gold();
  const pred = clone(g).map((r) => ({ q: r.q, need: r.need, steps: r.steps, customer_inputs: r.customer_inputs }));
  pred[2].steps = [
    { capability: 'ENTITY.ORDER', role: 'PRECONDITION', scope: 'THIS_ORDER', fields: ['ORDER_FULFILLMENT'], effect: 'NONE' },
    { capability: 'PROCEDURE.ORDER_ACTION', role: 'CLOSES', scope: 'THIS_ORDER', effect: 'EXTERNAL_STATE_CHANGE', depends_on: 0 },
  ];
  pred[6].steps = [{ capability: 'KNOWLEDGE.SHIPPING', role: 'CLOSES', scope: 'COMPANY', effect: 'NONE' }];
  const s = scorePlans(pred, g);
  assert.deepEqual(s.procedure_for_read, ['S:p3.n1']);
  assert.equal(s.invalid_capability_selection, 1);
});

test('observation rows become need rows, and a plan that splits differently is reported, not forced', () => {
  const g = gold();
  const rows = [
    { q: 'S:p1', plan: { needs: [{ id: 'N1', ask: 'a', steps: g[0].steps, customer_inputs: [] }] } },
    { q: 'S:p3', plan: { needs: [{ id: 'N1', ask: 'a', steps: g[2].steps, customer_inputs: [] },
                                 { id: 'N2', ask: 'b', steps: g[2].steps, customer_inputs: [] }] } },
    { q: 'S:p4', plan: null },
  ];
  const { rows: out, counts } = plansFromObservation(rows, g);
  assert.equal(counts.cases, 3);
  assert.equal(counts.need_count_match, 1);   // p1 matches; p3's gold has one need and the plan said two
  assert.equal(counts.unusable, 1);
  assert.deepEqual(out.map((r) => `${r.q}.${r.need}`), ['S:p1.n1', 'S:p3.n1']);
});

test('distribution counts plan shapes and expected terminals of frozen rows', () => {
  const d = distribution(gold());
  assert.equal(d.shape.KNOWLEDGE, 2);
  assert.equal(d.shape['KNOWLEDGE+CUSTOMER_INPUT'], 1);
  assert.equal(d.shape['ENTITY_STATE+PROCEDURE+KNOWLEDGE'], 1);
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
