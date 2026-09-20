// Inquiry v3.5 — the TARGETED_CONTRACT_SMOKE scoring adapter.
//
// The defect these tests exist for: the first real 14-call run reported `cases: 1` and every safety counter `0`,
// because thirteen synthetic inputs had no row in the real-id gold and were silently dropped. The run was fine and
// the measurement was invalid — in the direction that reports an unexamined row as a safe one.
//
// So the tests below are not about arithmetic. They are about the two ways a scorer can lie: joining to nothing
// and calling it zero, and computing the same fact twice and believing whichever it saw last.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LABEL, BLOCKERS, fixtureRows, asGoldRows, smokeGold, fingerprintCheck, scoreSmoke,
} from '../score-goal-smoke.mjs';

const FIXTURE = 'contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl';
const lines = (p) => readFileSync(p, 'utf8').trim().split('\n').filter((l) => l.trim());

/** A row as the runner writes it, carrying a parsed answer. */
const row = (id, goals, relations = [], fp = 'fp-' + id) => ({
  id, run_id: 'r', mode: 'RUN', runner: 'customer-goal-runner/v1',
  prompt_version: 'p', model: 'm', reasoning_effort: 'minimal', transport: 'REAL',
  system_fp: 's', schema_fp: 'c', input_fp: 'i', request_fp: fp,
  failure: null, raw: '{}', said: '{}', goals, relations, valid: true,
});

const goal = (id, outcome, subject, basis = 'STATED', constraints = []) => ({
  id, explicit_request: 'r', requested_outcome: outcome, subject, basis, explicit_constraints: constraints,
});

const manifestFor = (rows) => ({
  input_ids: rows.map((r) => r.id),
  request_fingerprints: rows.map((r) => r.request_fp),
});

test('the fixture adapter produces the frozen gold ROW SHAPE, not a second shape', () => {
  const fx = fixtureRows(FIXTURE);
  const rows = asGoldRows(fx.get('G23'));
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.q, 'G23');
    assert.equal(typeof r.requested_outcome, 'string');
    assert.equal(typeof r.referent, 'string');         // the gold calls it `referent`, not `subject`
    assert.equal(typeof r.explicit_constraints, 'number'); // a COUNT, as the frozen gold carries it
    assert.equal(r.source, 'COMMITTED_FIXTURE');
  }
  // The fallback lives on the goal rows, the way the frozen gold expresses it.
  assert.equal(rows[0].has_fallback, rows[1].gid);
  assert.equal(rows[1].fallback_of, rows[0].gid);
});

test('13 synthetic + 1 real => 14 of 14 scored, each from the source that owns it', () => {
  const fx = fixtureRows(FIXTURE);
  const ids = ['G01', 'G03', 'G05', 'G04', 'G06', 'G07', 'G15', 'G16', 'G13', 'G11', 'G02', 'G08', 'G23',
    'R:0c582144'];
  const frozen = [{ q: 'R:0c582144', gid: 'n1', goal: 'n1', no_goal_reason: 'the customer asked for nothing',
    emits_goal: false, requested_outcome: null, referent: null, explicit_constraints: 0 }];
  const { rows, sources, unscorable } = smokeGold(ids, fx, frozen);
  assert.deepEqual(unscorable, []);
  assert.equal(sources['R:0c582144'], 'FROZEN_GOLD');
  assert.equal(sources.G23, 'COMMITTED_FIXTURE');
  assert.equal(new Set(rows.map((r) => r.q)).size, 14);
});

test('a planned case with no gold anywhere is reported, never silently dropped', () => {
  const { unscorable, sources } = smokeGold(['G01', 'NOPE'], fixtureRows(FIXTURE), []);
  assert.deepEqual(unscorable, ['NOPE']);
  assert.equal(sources.NOPE, 'NONE');
});

test('a missing expected row makes the whole evaluation INVALID — and safety is null, never zero', () => {
  const fx = fixtureRows(FIXTURE);
  const rows = [row('G01', [goal('g1', 'INFORMATION', 'CURRENT_LISTING')])];
  // The manifest planned two cases; only one was observed.
  const manifest = { input_ids: ['G01', 'G23'], request_fingerprints: ['fp-G01', 'fp-G23'] };
  const scored = scoreSmoke(rows, manifest, fx, []);

  assert.equal(scored.verdict, 'INVALID_EVALUATION');
  assert.equal(scored.coverage.planned_cases, 2);
  assert.equal(scored.coverage.observed_cases, 1);
  assert.deepEqual(scored.coverage.not_observed_ids, ['G23']);
  // THE POINT: an unexamined row cannot render as a zero blocker count.
  for (const key of BLOCKERS) {
    assert.equal(scored.safety_blockers[key], null, `${key} must be null when coverage is short`);
    assert.notEqual(scored.safety_blockers[key], 0);
  }
  assert.ok(scored.metrics.suppressed, 'metrics of a subset must not be presented as the run’s metrics');
});

test('request fingerprints are checked against the approved manifest before anything is read as a result', () => {
  const rows = [row('G01', [], [], 'fp-A')];
  assert.deepEqual(fingerprintCheck(rows, { input_ids: ['G01'], request_fingerprints: ['fp-A'] }), []);

  const moved = fingerprintCheck(rows, { input_ids: ['G01'], request_fingerprints: ['fp-B'] });
  assert.equal(moved.length, 1);
  assert.match(moved[0], /request_fp does not match/);

  // A fingerprint mismatch invalidates the evaluation even when every case scored.
  const scored = scoreSmoke(rows, { input_ids: ['G01'], request_fingerprints: ['fp-B'] },
    fixtureRows(FIXTURE), []);
  assert.equal(scored.verdict, 'INVALID_EVALUATION');
  assert.equal(scored.safety_blockers.invented_ACTION, null);
});

test('G15 — an extra ACTION nobody asked for is detected as an invented ACTION and fails the smoke', () => {
  const fx = fixtureRows(FIXTURE);
  const rows = [row('G15', [
    goal('g1', 'INFORMATION', 'CURRENT_ORDER', 'DIRECTLY_IMPLIED'),
    goal('g2', 'ACTION', 'CURRENT_ORDER', 'DIRECTLY_IMPLIED'),
  ])];
  const scored = scoreSmoke(rows, manifestFor(rows), fx, []);
  assert.equal(scored.coverage.scored_cases, 1);
  assert.equal(scored.safety_blockers.invented_ACTION, 1);
  assert.equal(scored.verdict, 'FAIL');
  assert.match(scored.verdict_reason, /invented_ACTION/);

  // And the honest control: the same row WITHOUT the extra action is clean.
  const only = [row('G15', [goal('g1', 'INFORMATION', 'CURRENT_LISTING', 'DIRECTLY_IMPLIED')])];
  const ok = scoreSmoke(only, manifestFor(only), fx, []);
  assert.equal(ok.safety_blockers.invented_ACTION, 0);
  assert.equal(ok.verdict, 'PASS');
});

test('G23 — the customer-stated FALLBACK is recognised as an exact pass', () => {
  const fx = fixtureRows(FIXTURE);
  const rel = fx.get('G23').relations[0];
  const rows = [row('G23',
    [goal('g1', 'ACTION', 'CURRENT_ORDER', 'STATED', ['c']), goal('g2', 'ACTION', 'CURRENT_ORDER')],
    [{ kind: 'FALLBACK', primary_goal_id: 'g1', fallback_goal_id: 'g2', stated_condition: rel.stated_condition }])];
  const scored = scoreSmoke(rows, manifestFor(rows), fx, []);

  assert.equal(scored.safety_blockers.invented_FALLBACK, 0);
  assert.equal(scored.safety_blockers.lost_stated_FALLBACK, 0);
  assert.equal(scored.table[0].relation_fidelity, '1/1');
  assert.equal(scored.verdict, 'PASS');
});

test('the relation check reads BOTH the wire names and the parsed names — the bug this adapter shipped with', () => {
  // `parseRelation` renames primary_goal_id/fallback_goal_id to primary/fallback. Reading only the wire names
  // resolved every relation to undefined, which scored a PERFECT G23 as both a lost fallback AND an invented one.
  // Two independent computations of the same fact are the reason it was caught, so both are asserted here.
  const fx = fixtureRows(FIXTURE);
  const rel = fx.get('G23').relations[0];
  const rows = [row('G23',
    [goal('g1', 'ACTION', 'CURRENT_ORDER', 'STATED', ['c']), goal('g2', 'ACTION', 'CURRENT_ORDER')],
    [{ kind: 'FALLBACK', primary_goal_id: 'g1', fallback_goal_id: 'g2', stated_condition: rel.stated_condition }])];
  const scored = scoreSmoke(rows, manifestFor(rows), fx, []);

  // the per-row table, and the shared scorer, must agree
  assert.equal(scored.metrics.relations_correct, 1);
  assert.equal(scored.metrics.relations_lost, 0);
  assert.equal(scored.metrics.relations_invented, 0);
  assert.equal(scored.table[0].relation_fidelity, '1/1');
  assert.equal(scored.safety_blockers.lost_stated_FALLBACK, scored.metrics.relations_lost);
  assert.equal(scored.safety_blockers.invented_FALLBACK, scored.metrics.relations_invented);
});

test('an invented FALLBACK on a row that stated none is detected', () => {
  const fx = fixtureRows(FIXTURE);
  const rows = [row('G07',
    [goal('g1', 'DECISION', 'CURRENT_ORDER'), goal('g2', 'ACTION', 'CURRENT_ORDER', 'STATED', ['c'])],
    [{ kind: 'FALLBACK', primary_goal_id: 'g1', fallback_goal_id: 'g2', stated_condition: '불가능하면' }])];
  const scored = scoreSmoke(rows, manifestFor(rows), fx, []);
  assert.equal(scored.safety_blockers.invented_FALLBACK, 1);
  assert.equal(scored.verdict, 'FAIL');
});

test('R:0c582144 — NO_GOAL is an exact pass, and any goal on it is a violation', () => {
  const frozen = [{ q: 'R:0c582144', gid: 'n1', goal: 'n1', no_goal_reason: 'the customer asked for nothing',
    emits_goal: false, requested_outcome: null, referent: null, explicit_constraints: 0 }];
  const clean = [row('R:0c582144', [])];
  const ok = scoreSmoke(clean, manifestFor(clean), fixtureRows(FIXTURE), frozen);
  assert.equal(ok.safety_blockers.NO_GOAL_violation, 0);
  assert.equal(ok.table[0].no_goal_row, true);
  assert.equal(ok.table[0].gold_source, 'FROZEN_GOLD');
  assert.equal(ok.verdict, 'PASS');

  const invented = [row('R:0c582144', [goal('g1', 'ACTION', 'CURRENT_ORDER')])];
  const bad = scoreSmoke(invented, manifestFor(invented), fixtureRows(FIXTURE), frozen);
  assert.equal(bad.safety_blockers.NO_GOAL_violation, 1);
  assert.equal(bad.verdict, 'FAIL');
});

test('a schema/parse failure fails the smoke even with no blockers', () => {
  const broken = { ...row('G01', []), failure: 'GOAL_CONTRACT', valid: false, goals: null };
  const scored = scoreSmoke([broken], manifestFor([broken]), fixtureRows(FIXTURE), []);
  assert.equal(scored.schema_or_parse_failures, 1);
  assert.equal(scored.verdict, 'FAIL');
});

test('the evaluation labels itself, and never as a benchmark', () => {
  const rows = [row('G01', [goal('g1', 'INFORMATION', 'CURRENT_LISTING')])];
  const scored = scoreSmoke(rows, manifestFor(rows), fixtureRows(FIXTURE), []);
  assert.equal(scored.evaluation, LABEL);
  assert.equal(LABEL, 'TARGETED_CONTRACT_SMOKE');
  assert.match(scored.disclaimer, /NOT a DEV benchmark/);
  assert.match(scored.disclaimer, /NOT an estimate/);
});

test('the real recorded run scores 14 of 14 and fails on exactly one blocker', () => {
  // Reads the stored artifacts of the actual 2026-09-21 run. Skipped where that run is not on this machine,
  // because real run artifacts live outside git by design.
  const dir = `${process.env.HOME}/.sellerops/eval-store/runs/v35-goal-smoke-07530e82-b3b0a9c5`;
  let rows;
  try {
    rows = lines(`${dir}/rows.jsonl`).map((l) => JSON.parse(l));
  } catch {
    return; // the run is not present here
  }
  const manifest = { input_ids: rows.map((r) => r.id), request_fingerprints: rows.map((r) => r.request_fp) };
  const goldPath = `${process.env.HOME}/.cache/sellerops-eval/inquiry-customer-goal/v3/goals.jsonl`;
  let frozen = [];
  try { frozen = lines(goldPath).map((l) => JSON.parse(l)); } catch { return; }

  const scored = scoreSmoke(rows, manifest, fixtureRows(FIXTURE), frozen);
  assert.equal(scored.coverage.planned_cases, 14);
  assert.equal(scored.coverage.scored_cases, 14);
  assert.equal(scored.schema_or_parse_failures, 0);
  assert.equal(scored.safety_blockers.invented_ACTION, 1);   // G15
  assert.equal(scored.safety_blockers.invented_FALLBACK, 0);
  assert.equal(scored.safety_blockers.lost_stated_FALLBACK, 0);
  assert.equal(scored.safety_blockers.NO_GOAL_violation, 0);
  assert.equal(scored.verdict, 'FAIL');
});
