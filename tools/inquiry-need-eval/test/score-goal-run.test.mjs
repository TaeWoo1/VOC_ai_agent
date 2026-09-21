// node --test tools/inquiry-need-eval/test/score-goal-run.test.mjs
// Inquiry v3.5 — scoring a recorded run. The scorer reads rows the runner WROTE; nothing here contacts anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictionsOf, provenanceOf, scoreRun } from '../score-goal-run.mjs';

const row = (id, extra = {}) => ({
  run_id: 'r1', mode: 'RUN', id, runner: 'customer-goal-runner/v1',
  prompt_version: 'customer-goal-interpreter/v1', model: 'gpt-5-2025-08-07', reasoning_effort: 'minimal',
  system_fp: 'aaa', schema_fp: 'bbb', input_fp: 'ccc', request_fp: `fp-${id}`,
  finish: 'stop', raw: '{}', said: '{}', failure: null, goals: [], relations: [], valid: true, ...extra,
});

const goal = (id, outcome, subject) => ({
  id, explicit_request: '요청', requested_outcome: outcome, subject, basis: 'STATED', explicit_constraints: [],
});

const gold = [
  { q: 'G01', goal: 'n1', gid: 'n1', requested_outcome: 'INFORMATION', referent: 'CURRENT_LISTING',
    basis: 'STATED', explicit_constraints: 0 },
  { q: 'G16', goal: 'n1', gid: 'n1', requested_outcome: 'ACTION', referent: 'ORGANIZATION', basis: 'STATED',
    explicit_constraints: 0, legacy_conflict: 'NO_CAPABILITY' },
];

test('a recorded answer is scored through the same contract mirror the fixtures use', () => {
  const rows = [
    row('G01', { goals: [goal('g1', 'INFORMATION', 'CURRENT_LISTING')] }),
    row('G16', { goals: [goal('g1', 'ACTION', 'ORGANIZATION')] }),
  ];
  const scored = scoreRun(rows, gold);
  assert.equal(scored.explicit_goal_recall, 1);
  assert.equal(scored.outcome_accuracy, 1);
  assert.equal(scored.invented_goal_rate, 0);
  assert.equal(scored.safety_blockers.capability_changed_semantics, 0);
  assert.deepEqual(scored.refusals, {});
});

test('a refused row is counted, not dropped — a model that says nothing is not a careful one', () => {
  const rows = [
    row('G01', { failure: 'TRUNCATED', raw: null, goals: null, valid: false }),
    row('G16', { goals: [goal('g1', 'ACTION', 'ORGANIZATION')] }),
  ];
  const { predicted, refusals } = predictionsOf(rows);
  assert.deepEqual(predicted.G01, { goals: [], relations: [] });
  assert.equal(refusals.TRUNCATED, 1);
  const scored = scoreRun(rows, gold);
  assert.equal(scored.cases, 2, 'the refused case stays in the denominator');
  assert.equal(scored.explicit_goal_recall, 0.5);
});

test('a goal the wire contract refuses is a refusal, and does not become a prediction', () => {
  const rows = [row('G01', { goals: [{ ...goal('g1', 'INFORMATION', 'CURRENT_LISTING'), procedure: 'EXCHANGE' }] })];
  const { predicted, refusals } = predictionsOf(rows);
  assert.equal(refusals.GOAL_PLAN, 1);
  assert.deepEqual(predicted.G01.goals, []);
});

test('a relation with no quoted condition is refused at scoring time too', () => {
  const rows = [row('F', { goals: [goal('a', 'ACTION', 'CURRENT_ORDER'), goal('b', 'ACTION', 'CURRENT_ORDER')],
    relations: [{ kind: 'FALLBACK', primary_goal_id: 'a', fallback_goal_id: 'b', stated_condition: '' }] })];
  const { predicted, refusals } = predictionsOf(rows);
  assert.equal(refusals.RELATION_SHAPE, 1);
  assert.deepEqual(predicted.F.relations, []);
});

test('the score carries the run identity, so a number is attributable to the bytes that produced it', () => {
  const p = provenanceOf([row('G01'), row('G16')]);
  assert.deepEqual(p.system_fp, ['aaa']);
  assert.deepEqual(p.model, ['gpt-5-2025-08-07']);
  assert.deepEqual(p.request_fps, ['fp-G01', 'fp-G16']);
  assert.equal(p.rows, 2);
  // Two different prompts in one file is a mixed run, and it shows rather than averaging away.
  const mixed = provenanceOf([row('G01'), row('G16', { system_fp: 'zzz' })]);
  assert.deepEqual(mixed.system_fp.sort(), ['aaa', 'zzz']);
});

test('PREPARE rows score to nothing and say why — a dry build is not a result', () => {
  const rows = [row('G01', { mode: 'PREPARE', failure: 'NOT_SENT', raw: null, goals: null, valid: false })];
  const scored = scoreRun(rows, gold);
  assert.equal(scored.refusals.NOT_SENT, 1);
  assert.deepEqual(scored.provenance.mode, ['PREPARE']);
  assert.equal(scored.recalled, 0);
});

// --- the v3 merge, read from both sides -------------------------------------------------------------------------
//
// Two recorded runs, two vocabularies, one scorer. This is the property that lets the holdout of §25.13 put a v2 arm
// and a v3 arm on the same cases: each row is parsed in the token set its own prompt_version names, and neither is
// retroactively wrong for the words it used.

test('a v1/v2 row keeps its four tokens, and a v3 row keeps its three', () => {
  const v2row = { ...row('G01'), prompt_version: 'customer-goal-interpreter/v2',
    goals: [{ ...goal('g1', 'DECISION', 'CURRENT_LISTING'), evidence: '승인 가능한가요' }] };
  const { predicted, refusals } = predictionsOf([v2row]);
  assert.equal(predicted.G01.goals.length, 1, 'a recorded v2 answer stays readable after the merge');
  assert.equal(predicted.G01.goals[0].outcome, 'DECISION');
  assert.deepEqual(refusals, {});

  // ...and the merged token is not retro-fitted into that older space: v2 could not say ANSWER, so a row claiming
  // to be v2 while saying it is a row whose provenance and content disagree, and that is a refusal, not a repair.
  const impossible = { ...row('G01'), prompt_version: 'customer-goal-interpreter/v2',
    goals: [{ ...goal('g1', 'ANSWER', 'CURRENT_LISTING'), evidence: '소재가' }] };
  assert.equal(predictionsOf([impossible]).refusals.GOAL_SET, 1);

  // The current contract, in the other direction.
  const v3row = { ...row('G01'), prompt_version: 'customer-goal-interpreter/v3',
    goals: [{ ...goal('g1', 'ANSWER', 'CURRENT_LISTING'), evidence: '소재가' }] };
  assert.equal(predictionsOf([v3row]).predicted.G01.goals[0].outcome, 'ANSWER');
  const retired = { ...row('G01'), prompt_version: 'customer-goal-interpreter/v3',
    goals: [{ ...goal('g1', 'DECISION', 'CURRENT_LISTING'), evidence: '소재가' }] };
  assert.equal(predictionsOf([retired]).refusals.GOAL_SET, 1);
});

test('a foreign-arm row is read from raw in BOTH shapes, and a real refusal still stands', () => {
  const answer = JSON.stringify({ goals: [{ id: 'g1', explicit_request: '요청', requested_outcome: 'DECISION',
    subject: 'CURRENT_ORDER', basis: 'STATED', explicit_constraints: [], evidence: '가능한가요' }], relations: [] });

  // Shape 1 — the defect: a runner judged a v2 answer with v3's records and wrote GOAL_CONTRACT.
  const buggy = { ...row('G01'), prompt_version: 'customer-goal-interpreter/v2',
    failure: 'GOAL_CONTRACT', goals: null, raw: answer };
  const a = predictionsOf([buggy]);
  assert.equal(a.readjudicated, 1);
  assert.deepEqual(a.refusals, {});
  assert.equal(a.predicted.G01.goals[0].outcome, 'DECISION');

  // Shape 2 — after the fix: the runner declines to judge and says so.
  const fixed = { ...row('G01'), prompt_version: 'customer-goal-interpreter/v2',
    failure: null, goals: null, parsed_by_this_commit: false, raw: answer };
  const b = predictionsOf([fixed]);
  assert.equal(b.readjudicated, 1);
  assert.equal(b.predicted.G01.goals[0].outcome, 'DECISION');

  // A genuine contract failure is NOT laundered: the mirror has to accept the whole answer independently.
  const badEvidence = JSON.stringify({ goals: [{ id: 'g1', explicit_request: '요청',
    requested_outcome: 'DECISION', subject: 'CURRENT_ORDER', basis: 'STATED', explicit_constraints: [],
    evidence: '' }], relations: [] });
  const stands = predictionsOf([{ ...row('G01'), prompt_version: 'customer-goal-interpreter/v2',
    failure: 'GOAL_CONTRACT', goals: null, raw: badEvidence }]);
  assert.equal(stands.readjudicated, 0);
  assert.equal(stands.refusals.GOAL_CONTRACT, 1);

  // And a truncated answer is a fact about the CALL — no contract disagrees, so it is never revisited.
  const truncated = predictionsOf([{ ...row('G01'), prompt_version: 'customer-goal-interpreter/v2',
    failure: 'TRUNCATED', goals: null, raw: answer.slice(0, 30) }]);
  assert.equal(truncated.readjudicated, 0);
  assert.equal(truncated.refusals.TRUNCATED, 1);

  // A CURRENT-arm row is never re-adjudicated: its runner had the right records and its verdict is authoritative.
  const current = predictionsOf([{ ...row('G01'), prompt_version: 'customer-goal-interpreter/v3',
    failure: 'GOAL_CONTRACT', goals: null, raw: answer }]);
  assert.equal(current.readjudicated, 0);
  assert.equal(current.refusals.GOAL_CONTRACT, 1);
});
