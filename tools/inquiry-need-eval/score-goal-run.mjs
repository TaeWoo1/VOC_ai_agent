// Inquiry v3.5 — score a recorded Customer Goal Interpreter run.
//
//   node tools/inquiry-need-eval/score-goal-run.mjs <rows.jsonl> <gold.jsonl>
//
// Reads what the runner WROTE, never what it would write. Scoring is a separate step from transport on purpose: raw
// answers cannot be produced a second time, so a scorer that ran inside the runner could take an observation down
// with it when it failed. Every number here is recomputed from the stored rows and can be recomputed again.
//
// A row that failed is not an absent prediction. `GOAL_CONTRACT` means the model said something the contract will
// not construct, and that is a fact about the model rather than a gap in the corpus, so refusals are counted and
// reported beside the metrics rather than dropped.

import { readFileSync } from 'node:fs';
import { parseGoal, parseRelation, requiresEvidence, outcomesFor, foreignArm, scoreLayerA }
  from './customer-goals.mjs';

const lines = (path) => readFileSync(path, 'utf8').trim().split('\n').filter((l) => l.trim());

/**
 * The only verdicts a wrong-contract parse can produce. A truncated answer, an unparseable one or a vendor failure
 * is a fact about the CALL and no contract disagrees about it, so those are never revisited.
 */
const REBUTTABLE = ['GOAL_CONTRACT', 'GOAL_SET'];

/**
 * Re-read a foreign-arm row under its own contract, or return null and leave the refusal standing.
 *
 * The bar is that the mirror INDEPENDENTLY ACCEPTS the whole answer — every goal, every relation, and the set
 * rules. Anything it still refuses keeps the refusal it had. So this cannot launder a real contract failure: it
 * only declines to inherit a verdict that was reached with the wrong vocabulary.
 */
function readUnderItsOwnContract(row) {
  let parsed;
  try {
    parsed = JSON.parse(row.raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const evidence = requiresEvidence(row.prompt_version);
  const outcomes = outcomesFor(row.prompt_version);
  const goals = [];
  for (const raw of parsed.goals ?? []) {
    const one = parseGoal(raw, { evidence, outcomes });
    if (!one.goal) return null;
    goals.push(one.goal);
  }
  const relations = [];
  for (const raw of parsed.relations ?? []) {
    const one = parseRelation(raw);
    if (!one.relation) return null;
    relations.push(one.relation);
  }
  return { ...row, failure: null, goals: parsed.goals ?? [], relations: parsed.relations ?? [] };
}

/** Turn recorded rows into the { q: {goals, relations} } shape the scorer reads, and count what could not be read. */
export function predictionsOf(rows) {
  const predicted = {};
  const refusals = {};
  let readjudicated = 0;
  for (let row of rows) {
    const id = row.id ?? row.q;
    // THE RUNNER'S VERDICT IS ONLY AUTHORITATIVE FOR ITS OWN CONTRACT.
    //
    // A comparison arm (§26.7) sends a retired prompt, but the Java runner builds records from the contract its
    // COMMIT ships — so a v2 answer saying INFORMATION was recorded `GOAL_CONTRACT` by a v3 record that cannot
    // express the word. Measured on the v2 holdout arm: 39 of 75 rows, and the correspondence with "contains a
    // retired token" was exact in both directions. The vendor had answered all 75 with finish=stop.
    //
    // So for a foreign arm the failure field is re-adjudicated here, from the answer the vendor actually sent,
    // under that arm's own vocabulary. This is NOT laundering a refusal: the mirror applies the same shape rules
    // the record does — it is pinned to the same fixture by customer-goals.test.mjs — and anything it still
    // refuses stays refused. It only declines to inherit a verdict the runner was not entitled to reach.
    // Two row shapes reach this branch, and both are foreign-arm rows whose answer this mirror must read:
    //   * `failure: GOAL_CONTRACT` — written by a runner that judged a v2 answer with v3's records (the defect);
    //   * `failure: null, goals: null, parsed_by_this_commit: false` — written by a runner that knows it has no
    //     records for this arm and says so, which is what the fix made it do.
    // Handling only the first would have left every row produced AFTER the fix unscoreable, which is the quiet way
    // a repair breaks the thing it repaired.
    const unreadHere = REBUTTABLE.includes(row.failure) || row.parsed_by_this_commit === false
      || (!row.failure && (row.goals === null || row.goals === undefined));
    if (foreignArm(row.prompt_version) && row.raw && unreadHere) {
      const rebuilt = readUnderItsOwnContract(row);
      if (rebuilt) {
        row = rebuilt;
        readjudicated += 1;
      }
    }
    if (row.failure) {
      // The row is kept in the denominator: a case the model refused is a case it did not answer, and silently
      // omitting it would make a refusing model look like a cautious one.
      refusals[row.failure] = (refusals[row.failure] ?? 0) + 1;
      predicted[id] = { goals: [], relations: [] };
      continue;
    }
    const goals = [];
    // Each row is read under the contract it was PRODUCED under, which its own prompt_version names. A recorded
    // pre-evidence run stays scoreable; anything that does not say it is one is held to the current contract.
    const evidence = requiresEvidence(row.prompt_version);
    // The same rule for the outcome vocabulary: v1 and v2 rows say INFORMATION or DECISION and are not wrong for
    // saying so. Refusing them here would make the v3 merge retroactively unmake our own recorded runs.
    const outcomes = outcomesFor(row.prompt_version);
    for (const raw of row.goals ?? []) {
      const parsed = parseGoal(raw, { evidence, outcomes });
      if (!parsed.goal) {
        refusals[parsed.failure] = (refusals[parsed.failure] ?? 0) + 1;
        continue;
      }
      goals.push(parsed.goal);
    }
    const relations = [];
    for (const raw of row.relations ?? []) {
      const parsed = parseRelation(raw);
      if (!parsed.relation) {
        refusals[parsed.failure] = (refusals[parsed.failure] ?? 0) + 1;
        continue;
      }
      relations.push(parsed.relation);
    }
    predicted[id] = { goals, relations };
  }
  return { predicted, refusals, readjudicated };
}

/** The run's own identity, carried out of the rows so a score is attributable to the bytes that produced it. */
export function provenanceOf(rows) {
  const one = (field) => [...new Set(rows.map((r) => r[field]))];
  return {
    run_id: one('run_id'), mode: one('mode'), runner: one('runner'), prompt_version: one('prompt_version'),
    model: one('model'), reasoning_effort: one('reasoning_effort'),
    system_fp: one('system_fp'), schema_fp: one('schema_fp'),
    rows: rows.length, request_fps: rows.map((r) => r.request_fp),
  };
}

export function scoreRun(rows, gold) {
  const { predicted, refusals } = predictionsOf(rows);
  const metrics = scoreLayerA(gold, predicted);
  // After the spread deliberately: scoreLayerA carries a `refusals` slot of its own that nothing fills, and the
  // counts that matter are the ones gathered above from the recorded rows.
  return { provenance: provenanceOf(rows), ...metrics, refusals };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [rowsPath, goldPath] = process.argv.slice(2);
  if (!rowsPath || !goldPath) {
    console.error('usage: score-goal-run.mjs <rows.jsonl> <gold.jsonl>');
    process.exit(2);
  }
  const rows = lines(rowsPath).map((l) => JSON.parse(l));
  const gold = lines(goldPath).map((l) => JSON.parse(l));
  const scored = scoreRun(rows, gold);
  // A mode other than RUN is a re-score or a dry build; saying so stops a PREPARE run being read as a result.
  if (!scored.provenance.mode.includes('RUN')) {
    scored.warning = `these rows were produced in ${scored.provenance.mode.join('/')} — no model answered them`;
  }
  console.log(JSON.stringify(scored, null, 1));
}
