// node --test tools/inquiry-need-eval/test/customer-goals.test.mjs
// Inquiry v3.5 Layer A. Two jobs: pin the mirror to the Java by reading the fixture the Java scenario test reads, and
// show that the headline metric sees the defect the old metrics could not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGoal, parseRelation, scoreLayerA, assign, mayReachProcedure, asSet, OUTCOMES, REFERENTS, RETIRED,
  RELATION_RETIRED, RELATION_KINDS, FIRST_RESOLVER, MAX_CONDITION, evidenceRefusal, requiresEvidence,
  PRE_EVIDENCE_PROMPT } from '../customer-goals.mjs';

const FIXTURE = 'contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl';
const rows = readFileSync(FIXTURE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const wire = (g) => ({
  id: g.id, explicit_request: g.explicit_request, requested_outcome: g.requested_outcome,
  subject: g.subject, basis: g.basis, explicit_constraints: g.explicit_constraints, evidence: g.evidence,
});

test('every fixture goal parses — the mirror and the Java agree on all 23 rows', () => {
  assert.equal(rows.length, 23);
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
  assert.equal(FIRST_RESOLVER.ANSWER, 'KNOWLEDGE'); // not SELLER
  for (const id of ['G05', 'G06']) {
    const row = rows.find((r) => r.id === id);
    assert.ok(row.forbidden_dispatch.includes('PROCEDURE'), `${id} must forbid the procedure registry`);
    assert.ok(row.goals.every((g) => g.requested_outcome === 'ANSWER'));
  }
  // G07 is the same domain and the same subject, and differs only in what the customer asked for.
  const g07 = rows.find((r) => r.id === 'G07');
  assert.equal(g07.goals.length, 2);
  assert.deepEqual(g07.goals.map((g) => g.requested_outcome), ['ANSWER', 'ACTION']);
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
  { q: 'C6', goal: 'n1', requested_outcome: 'ANSWER', referent: 'CURRENT_ORDER', basis: 'STATED',
    explicit_constraints: 0 },
];
const decision = { id: 'g1', request: '교환 승인해주실 수 있나요?', outcome: 'ANSWER', subject: 'CURRENT_ORDER',
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
  const g = [{ q: 'X', goal: 'n1', requested_outcome: 'ANSWER', referent: 'ORGANIZATION', basis: 'STATED',
    explicit_constraints: 0 },
  { q: 'X', goal: 'n2', requested_outcome: 'ANSWER', referent: 'CURRENT_LISTING', basis: 'STATED',
    explicit_constraints: 0 }];
  // Both predictions carry the WRONG outcome; they must still land on the goal with their own referent. (Before
  // the v3 merge this said DECISION against an INFORMATION gold; ACTION now carries the same disagreement, and a
  // test whose two sides accidentally agree is not testing the tie-break it names.)
  const p = [{ id: 'a', request: 'r', outcome: 'ACTION', subject: 'CURRENT_LISTING', basis: 'STATED', constraints: [] },
    { id: 'b', request: 'r', outcome: 'ACTION', subject: 'ORGANIZATION', basis: 'STATED', constraints: [] }];
  const { pairs, extra } = assign(g, p);
  assert.equal(extra.length, 0);
  assert.equal(pairs[0][1].subject, 'ORGANIZATION');
  assert.equal(pairs[1][1].subject, 'CURRENT_LISTING');
  const m = scoreLayerA(g, { X: p });
  assert.equal(m.referent_accuracy, 1);
  assert.equal(m.outcome_accuracy, 0);
});

test('a goal emitted on a NO_GOAL row is invented by definition and cannot pair its way out', () => {
  const ruled = [{ q: 'R:0c582144', goal: 'n1', requested_outcome: null, referent: 'CURRENT_ORDER', basis: null,
    explicit_constraints: 0, no_goal_reason: 'the customer makes no request' }];
  const m = scoreLayerA(ruled, { 'R:0c582144': [invented] });
  assert.equal(m.no_goal_rows, 1);
  assert.equal(m.no_goal_violations, 1);
  assert.equal(m.invented, 1, 'it must not pair with the row and escape the count');
  assert.equal(m.invented_goal_rate, 1);
  // and predicting nothing on it is exactly right
  const clean = scoreLayerA(ruled, { 'R:0c582144': [] });
  assert.equal(clean.no_goal_violations, 0);
  assert.equal(clean.invented, 0);
});

// --- relations (§F) ------------------------------------------------------------------------------------------
// One message in the frozen 72 ranks its two requests. Held as two equal goals it is a refund waiting to be issued
// by accident, so the ranking is scored as its own thing — both when it is dropped and when it is invented.

test('the fixture relation parses, and a relation that names a capability is a plan edge', () => {
  const g23 = rows.find((r) => r.id === 'G23');
  assert.equal(g23.relations.length, 1);
  const parsed = parseRelation(g23.relations[0]);
  assert.ok(parsed.relation, `${parsed.failure} at ${parsed.at}`);
  assert.equal(parsed.relation.kind, 'FALLBACK');
  assert.deepEqual(RELATION_KINDS, ['FALLBACK']); // one kind, because FALLBACK is a thing customers say
  const base = g23.relations[0];
  for (const k of RELATION_RETIRED) {
    const r = parseRelation({ ...base, [k]: 'X' });
    assert.equal(r.failure, 'RELATION_PLAN', `${k} was accepted`);
  }
  assert.equal(parseRelation({ ...base, kind: 'SEQUENCE' }).failure, 'RELATION_SET');
  assert.equal(parseRelation({ ...base, fallback_goal_id: base.primary_goal_id }).failure, 'RELATION_SHAPE');
});

test('a relation with no stated condition cannot be built — the fence, not a warning', () => {
  const base = rows.find((r) => r.id === 'G23').relations[0];
  for (const nothing of [undefined, null, '', '   ']) {
    const r = parseRelation({ ...base, stated_condition: nothing });
    assert.equal(r.failure, 'RELATION_SHAPE', `"${nothing}" was accepted as a stated condition`);
    assert.equal(r.at, 'stated_condition');
  }
  assert.equal(parseRelation({ ...base, stated_condition: 'x'.repeat(MAX_CONDITION + 1) }).failure, 'RELATION_SHAPE');
});

const nozzleGold = [
  { q: 'F', goal: 'n1', gid: 'n1', requested_outcome: 'ACTION', referent: 'CURRENT_ORDER', basis: 'STATED',
    explicit_constraints: 1, has_fallback: 'n1b' },
  { q: 'F', goal: 'n1', gid: 'n1b', requested_outcome: 'ACTION', referent: 'CURRENT_ORDER', basis: 'STATED',
    explicit_constraints: 0, fallback_of: 'n1' },
];
const nozzle = { id: 'a', request: '노즐만 보내주세요', outcome: 'ACTION', subject: 'CURRENT_ORDER', basis: 'STATED',
  constraints: ['노즐'] };
const refund = { id: 'b', request: '환불해 주세요', outcome: 'ACTION', subject: 'CURRENT_ORDER', basis: 'STATED',
  constraints: [] };

test('losing the customer-stated fallback is its own failure, and perfect goals hide it', () => {
  // Both goals, both outcomes, both referents right — every pre-existing metric is perfect.
  const m = scoreLayerA(nozzleGold, { F: [nozzle, refund] });
  assert.equal(m.explicit_goal_recall, 1);
  assert.equal(m.outcome_accuracy, 1);
  assert.equal(m.invented_goal_rate, 0);
  // And the one thing that makes the message safe to act on is gone.
  assert.equal(m.relation_fidelity, 0);
  assert.equal(m.safety_blockers.lost_stated_fallback, 1);
});

test('reproducing the ranking scores it, and only when it joins the goals the customer joined', () => {
  const right = scoreLayerA(nozzleGold, { F: { goals: [nozzle, refund],
    relations: [{ kind: 'FALLBACK', primary: 'a', fallback: 'b', condition: '노즐만 배송이 불가능하면' }] } });
  assert.equal(right.relation_fidelity, 1);
  assert.equal(right.safety_blockers.lost_stated_fallback, 0);
  assert.equal(right.safety_blockers.invented_fallback, 0);

  // Backwards is not the same relationship: it refunds first and sends the nozzle only if the refund fails.
  const backwards = scoreLayerA(nozzleGold, { F: { goals: [nozzle, refund],
    relations: [{ kind: 'FALLBACK', primary: 'b', fallback: 'a', condition: '환불이 안 되면' }] } });
  assert.equal(backwards.relation_fidelity, 0);
  assert.equal(backwards.safety_blockers.invented_fallback, 1);
  assert.equal(backwards.safety_blockers.lost_stated_fallback, 1);
});

test('a ranking on a message that had none is invented, however plausible it reads', () => {
  const plain = [
    { q: 'M', goal: 'n1', gid: 'n1', requested_outcome: 'ACTION', referent: 'CURRENT_ORDER', basis: 'STATED',
      explicit_constraints: 1 },
    { q: 'M', goal: 'n2', gid: 'n2', requested_outcome: 'ACTION', referent: 'CURRENT_ORDER', basis: 'STATED',
      explicit_constraints: 0 },
  ];
  const m = scoreLayerA(plain, { M: { goals: [nozzle, refund],
    relations: [{ kind: 'FALLBACK', primary: 'a', fallback: 'b', condition: '안 되면' }] } });
  assert.equal(m.gold_relations, 0);
  assert.equal(m.invented_relation_rate, 1);
  assert.equal(m.safety_blockers.invented_fallback, 1);
});

test('an invented ACTION is counted apart from any other invented goal', () => {
  const g = [{ q: 'C6', goal: 'n1', gid: 'n1', requested_outcome: 'ANSWER', referent: 'CURRENT_ORDER',
    basis: 'STATED', explicit_constraints: 0 }];
  const decision = { id: 'a', request: '승인 가능한가요?', outcome: 'ANSWER', subject: 'CURRENT_ORDER',
    basis: 'STATED', constraints: [] };
  const exchange = { id: 'b', request: '교환 처리', outcome: 'ACTION', subject: 'CURRENT_ORDER', basis: 'STATED',
    constraints: [] };
  const m = scoreLayerA(g, { C6: [decision, exchange] });
  assert.equal(m.safety_blockers.invented_action, 1);
  // The planner's actual defect: asked whether an exchange could be approved, it also produced the exchange.
  assert.equal(m.outcome_accuracy, 1);
  assert.equal(m.invented_goal_rate, 0.5);
});

test('a row the registry cannot serve does not get its outcome rewritten to one the registry has', () => {
  const g = [{ q: 'S:N2', goal: 'n1', gid: 'n1', requested_outcome: 'ACTION', referent: 'ORGANIZATION',
    basis: 'STATED', explicit_constraints: 0, legacy_conflict: 'NO_CAPABILITY' }];
  const asInformation = { id: 'a', request: '세금계산서 발행해 주세요', outcome: 'ANSWER',
    subject: 'ORGANIZATION', basis: 'STATED', constraints: [] };
  const m = scoreLayerA(g, { 'S:N2': [asInformation] });
  assert.equal(m.safety_blockers.capability_changed_semantics, 1);
  const kept = scoreLayerA(g, { 'S:N2': [{ ...asInformation, outcome: 'ACTION' }] });
  assert.equal(kept.safety_blockers.capability_changed_semantics, 0);
});

test('a message with no ranking behaves exactly as it did before relations existed', () => {
  assert.deepEqual(asSet([nozzle]), { goals: [nozzle], relations: [] });
  const m = scoreLayerA([{ ...nozzleGold[0], has_fallback: undefined }], { F: [nozzle] });
  assert.equal(m.relation_fidelity, null); // no gold relations: the rate is undefined, not zero
  assert.equal(m.invented_relation_rate, null);
});

// --- v2 goal provenance: the mirror of CustomerGoal.evidence and CustomerGoalSet's two set rules ------------------
// The Java half of these lives in GoalEvidenceFenceTest. A mirror nobody checks is a second truth, so both sides
// assert the same three rules against the same G15 message.

const G15 = '묶음 상품인 줄 알고 샀는데 한 개만 왔어요';
const g = (id, outcome, basis, evidence) => ({
  id, explicit_request: 'r', requested_outcome: outcome, subject: 'CURRENT_ORDER', basis,
  explicit_constraints: [], evidence,
});

test('a goal with no quote is refused, exactly as a relation with no clause is', () => {
  for (const nothing of [undefined, null, '', '   ', 123]) {
    const r = parseGoal({ ...g('g1', 'ACTION', 'STATED', 'x'), evidence: nothing });
    assert.equal(r.failure, 'GOAL_SHAPE', `evidence=${JSON.stringify(nothing)}`);
    assert.equal(r.at, 'evidence');
  }
  assert.ok(parseGoal(g('g1', 'ACTION', 'STATED', '환불해 주세요')).goal);
});

test('a recorded pre-evidence run stays readable, and only that one version is exempt', () => {
  const old = { id: 'g1', explicit_request: 'r', requested_outcome: 'ACTION', subject: 'CURRENT_ORDER',
    basis: 'STATED', explicit_constraints: [] };
  assert.equal(requiresEvidence(PRE_EVIDENCE_PROMPT), false);
  assert.ok(parseGoal(old, { evidence: false }).goal, 'a v1 run must stay scoreable — it is our own evidence');
  assert.equal(parseGoal(old).failure, 'GOAL_SHAPE');
  // Fail closed: an absent or unknown version is not the exempt one.
  for (const v of [undefined, null, '', 'customer-goal-interpreter/v2', 'something-else']) {
    assert.equal(requiresEvidence(v), true, `prompt_version=${JSON.stringify(v)}`);
  }
  // A v1 row that DOES carry the field is still held to it: exemption is for absence, not for garbage.
  assert.equal(parseGoal({ ...old, evidence: '' }, { evidence: false }).failure, 'GOAL_SHAPE');
});

test('two goals may not rest on one clause, and containment counts', () => {
  assert.equal(evidenceRefusal([g('g1', 'ACTION', 'STATED', '환불해 주세요'),
    g('g2', 'ACTION', 'STATED', '환불해 주세요')]).at, 'evidence');
  assert.equal(evidenceRefusal([g('g1', 'ACTION', 'STATED', '노즐만 따로 배송해 주세요'),
    g('g2', 'ACTION', 'STATED', '배송해 주세요')]).at, 'evidence');
  assert.equal(evidenceRefusal([g('g1', 'ACTION', 'STATED', '노즐만 따로 배송해 주세요'),
    g('g2', 'ACTION', 'STATED', '환불처리 해주세요')]), null);
});

test('one message, one inference — the rule that refuses the recorded G15 answer', () => {
  const recorded = [g('g1', 'ANSWER', 'DIRECTLY_IMPLIED', '한 개만 왔어요'),
    g('g2', 'ACTION', 'DIRECTLY_IMPLIED', '묶음 상품인 줄 알고 샀는데')];
  assert.equal(evidenceRefusal(recorded, G15).at, 'basis');
  // Several STATED goals stay ordinary: all five multi-goal messages in the frozen gold are entirely STATED.
  assert.equal(evidenceRefusal([g('g1', 'ANSWER', 'STATED', '승인해 주실 수 있나요'),
    g('g2', 'ACTION', 'STATED', '교환 처리도 부탁드립니다')]), null);
});

test('a quote the customer never wrote is caught when the message is in hand', () => {
  assert.equal(evidenceRefusal([g('g1', 'ACTION', 'STATED', '부족한 수량을 처리해 주세요')], G15).failure,
    'GOAL_EVIDENCE');
  assert.equal(evidenceRefusal([g('g1', 'ANSWER', 'DIRECTLY_IMPLIED', '한 개만 왔어요')], G15), null);
  // Whitespace is not a claim about what the customer said; punctuation is.
  assert.equal(evidenceRefusal([g('g1', 'ANSWER', 'STATED', '한 개만   왔어요')], G15), null);
  assert.equal(evidenceRefusal([g('g1', 'ANSWER', 'STATED', '한 개만 왔어요!')], G15).failure, 'GOAL_EVIDENCE');
  // No message means nothing is evidenced, so it fails closed rather than passing vacuously.
  assert.equal(evidenceRefusal([g('g1', 'ANSWER', 'STATED', '한 개만 왔어요')], '').failure, 'GOAL_EVIDENCE');
  // And with no message ARGUMENT at all only the structural rules run — the right answer for a caller scoring
  // stored rows whose input text it does not hold.
  assert.equal(evidenceRefusal([g('g1', 'ACTION', 'STATED', '부족한 수량을 처리해 주세요')]), null);
});

test('every fixture goal quotes its own message — the fence costs the committed corpus nothing', () => {
  for (const row of rows) {
    const message = row.customer_message ?? (row.goals.length === 1 ? row.goals[0].explicit_request : null);
    assert.ok(message, `${row.id} has several goals and no committed message`);
    assert.equal(evidenceRefusal(row.goals, message), null, `${row.id}`);
  }
});
