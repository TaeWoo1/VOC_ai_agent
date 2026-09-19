// node --test tools/inquiry-need-eval/test/
// The synthetic fixture walks every judgment once; the numbers below are worked out by hand in
// docs/inquiry_need_eval_v1.md §8, not copied from a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDataset, readJsonl } from '../io.mjs';
import { validate } from '../validate.mjs';
import { deriveTruth } from '../truth.mjs';
import { score, compare, observed } from '../score.mjs';
import * as V from '../vocabulary.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, '../../../contracts/inquiry-need-eval/v1/synthetic');
const SCHEMA = JSON.parse(readFileSync(join(here, '../../../contracts/inquiry-need-eval/v1/schema.json'), 'utf8'));
const ds = () => loadDataset(FIX);
const snap = () => JSON.parse(readFileSync(join(FIX, 'snapshot.json'), 'utf8'));
const run = (file) => score(ds(), snap(), readJsonl(join(FIX, file)));
const byQ = (xs) => Object.fromEntries(xs.map((x) => [x.q, x]));

test('the synthetic dataset validates', () => {
  assert.deepEqual(validate(ds()), []);
});

test('validator refuses what L1 must never hold', () => {
  const bad = ds();
  bad.questions.push({ q: 'R:deadbeef', set: 'R', cluster: 'c:x', canonical: true, product: null, inquiry: 'deadbeef', text: '고객 문장' });
  bad.needs.push({ q: 'R:deadbeef', need: 'n1', ask: '주문 2016030601099 확인', type: 'ORDER_STATE', scope: 'PRODUCT_FAMILY',
    sets: [{ refs: ['PK:bbbb0001'], suff: 'UNKNOWN' }], family_sets: [], precedents: [], family_precedents: [] });
  bad.questions.push({ q: 'S:dup', set: 'S', cluster: 'c:q1', canonical: true, product: 'aaaa0001', text: 'x' });
  const errs = validate(bad).join('\n');
  assert.match(errs, /carries no text/);
  assert.match(errs, /PII shape/);
  assert.match(errs, /PRODUCT_FAMILY belongs in family_sets/);
  assert.match(errs, /UNKNOWN ⇔/);
  assert.match(errs, /exactly one canonical/);
});

test('truth: UNKNOWN is kept, acquisition is a step, terminal is what is left after it', () => {
  const t = deriveTruth(ds(), snap());
  const need = Object.fromEntries(t.needs.map((n) => [`${n.q}.${n.need}`, n]));
  assert.equal(need['S:q2.n2'].answerability, 'UNKNOWN');
  assert.equal(need['S:q2.n2'].knowledgeGap, 'SOURCE_UNREADABLE');
  assert.equal(need['S:q3.n1'].answerability, 'NONE');
  assert.equal(need['S:q3.n1'].nextStep, 'SYSTEM_ACQUIRE');
  assert.equal(need['S:q3.n1'].terminal, 'ANSWER');
  assert.equal(need['S:q4.n1'].nextStep, 'ASK_CUSTOMER');
  // AND: both refs present → the set is available; the family set never is
  assert.equal(need['S:q7.n1'].answerability, 'PARTIAL');
  assert.equal(need['S:q7.n1'].sourceState, 'AVAILABLE');
  // ORDER_ONLY never counts as a reusable precedent
  assert.deepEqual(need['S:q5.n1'].precedents, ['cccc0001']);
  assert.deepEqual(need['S:q5.n1'].episodic, ['cccc0002']);
  const cases = byQ(t.cases);
  assert.equal(cases['S:q2'].answerability, 'PARTIAL');
  assert.equal(cases['S:q3'].nextStep, 'SYSTEM_ACQUIRE');
});

test('score: each case lands on its outcome', () => {
  const r = run('observations.jsonl');
  const c = byQ(r.caseScores);
  assert.equal(c['S:q1'].outcome, 'SAFE_ANSWER');
  assert.equal(c['S:q2'].outcome, 'PARTIAL_LEAK');
  assert.equal(c['S:q3'].outcome, 'ESCALATION_BEFORE_ACQUIRE');
  assert.equal(c['S:q4'].outcome, 'UNNECESSARY_ESCALATION');
  assert.equal(c['S:q5'].outcome, 'CORRECT_ESCALATION');
  assert.equal(c['S:q5'].prefill, 'PREFILL_WRONG');
  assert.equal(c['S:q7'].outcome, 'WRONG', 'half of an AND set is no evidence');
  const n = Object.fromEntries(r.needScores.map((x) => [`${x.q}.${x.need}`, x]));
  assert.equal(n['S:q4.n1'].uncovered, 'RETRIEVAL_MISS');
  assert.equal(n['S:q3.n1'].uncovered, 'NOT_ACQUIRED');
  assert.equal(n['S:q5.n1'].precedentHit, false);
});

test('headline metrics weigh canonical cases only', () => {
  const m = run('observations.jsonl').metrics;
  assert.equal(m.counts.canonical_cases, 6);
  assert.equal(m.counts.raw_cases, 7);
  assert.equal(m.decision.no_ask_cases, 3);
  assert.equal(m.decision.strict_safe_no_ask_precision, 1 / 3);
  assert.equal(m.decision.partial_leak_rate, 1 / 3);
  assert.equal(m.decision.wrong_automation_rate, 1 / 3);
  assert.equal(m.decision.safe_automation_coverage, 1 / 2);
  assert.equal(m.decision.unnecessary_seller_escalation, 1);
  assert.equal(m.retrieval.unattributed_evidence_rate, 0);
  assert.equal(m.product.terminal_seller_touch_requirement, 3 / 6);
});

test('a citation without any text is conservatively WRONG, and compare() reports what moved', () => {
  const a = run('observations.jsonl');
  const b = run('observations-rerun.jsonl');
  assert.equal(byQ(b.caseScores)['S:q5'].outcome, 'WRONG');
  assert.equal(byQ(b.caseScores)['S:q4'].outcome, 'SAFE_CLARIFY');
  const d = compare(a, b);
  assert.equal(d.case_change_rate, 4 / 6);
  assert.deepEqual(d.retrieval_gained, ['S:q4.n1']);
  assert.deepEqual(d.new_unsafe_no_ask, ['S:q5']);
});

test('observation matching is by id prefix and by the SQL LIKE the census ran', () => {
  const row = { current: [], resolved_product: 'aaaa0001-x', variant: { option_name: '색상: 우드 / 사이즈: 1호' },
    catalogue: { statements: [{ product: 'aaaa0001-x', field: 'SUPPLEMENT', fact_key: 'attr:추가상품 1', text: '곡선엘보캡: 그레이 2호' }] } };
  assert.equal(observed('OPT:aaaa0001#%우드%', row), true);
  assert.equal(observed('ADDON:aaaa0001#곡선엘보캡%', row), true);
  assert.equal(observed('IMG:aaaa0001', row), false);
});

test('schema enums are the vocabulary, word for word', () => {
  const d = SCHEMA.$defs;
  assert.deepEqual(d.need.properties.type.enum, V.NEED_TYPES);
  assert.deepEqual(d.need.properties.scope.enum, V.SCOPES);
  assert.deepEqual(d.evidenceSet.properties.suff.enum, V.SUFFICIENCY);
  assert.deepEqual(d.precedent.properties.precedent_scope.enum, V.PRECEDENT_SCOPES);
  assert.deepEqual(d.snapshot.properties.refs.items.properties.state.enum, V.SOURCE_STATES);
  assert.deepEqual(d.observation.properties.basis.enum, Object.keys(V.SYSTEM_ACTION));
});

test('an answer grounded on a catalogue statement alone is not an uncited answer', () => {
  const d = ds();
  const s = snap();
  s.refs.push({ ref: 'OPT:aaaa0001#%우드%', product: 'aaaa0001', state: 'PRESENT' });
  s.refs = s.refs.filter((r) => !(r.ref === 'OPT:aaaa0001#%우드%' && r.state === 'ABSENT_ACQUIRABLE'));
  const rows = readJsonl(join(FIX, 'observations.jsonl')).map((r) => (r.q !== 'S:q3' ? r : {
    ...r, basis: 'GROUNDED', catalogue: { grounds: false, statements: [{ product: 'aaaa0001-x', field: 'OPTION', text: '색상: 우드 / 사이즈: 1호 (판매 중)' }] },
  }));
  assert.equal(byQ(score(d, s, rows).caseScores)['S:q3'].outcome, 'SAFE_ANSWER');
});
