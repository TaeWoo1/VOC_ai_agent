#!/usr/bin/env node
// Offline replay of a frozen planner run under the WP-3 contract (Inquiry v3 WP-3). NO MODEL CALL. The raw observations
// of run wp2-shadow (67 cases x 3 repetitions, prompt resolution-planner/v2) are read, never written, and every number
// below is derived from them.
//
// TWO KINDS OF CLAIM LIVE HERE AND THEY ARE NOT MIXED:
//
//   MEASURED  — what the recorded answers say under a scorer change alone. The split-tolerant goal scores are of this
//               kind: the plans are exactly what the model produced, only the comparison changed.
//   ESTIMATED — what the recorded answers say after being PROJECTED into the WP-3 step shapes (contract.mjs `project`).
//               The projection is deterministic, but the model was never asked under the new schema, so an estimate of
//               "this violation becomes impossible" is a claim about the SHAPE, not about the model. Whether a planner
//               given the new schema writes the same authorities at all is the thing only an actual-model run can say.
//
//   node tools/inquiry-need-eval/wp3-replay.mjs --obs <run.jsonl> --gold <v3.2 plans.jsonl> [--json out.json]
import { realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readJsonl } from './io.mjs';
import * as C from './contract.mjs';
import { scoreGoals } from './goals.mjs';
import { scorePlans, plansFromObservation as positional } from './plan.mjs';

const count = (xs) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});

/**
 * Every violation the run actually recorded, and whether the WP-3 shapes remove it.
 * A code is REMOVED_BY_SHAPE when no object with that fault can be built; SURVIVES when the fault is a relationship
 * between steps, which no schema can express.
 */
export const DISPOSITION = {
  FIELDS_ON_NON_ENTITY: 'REMOVED_BY_SHAPE',
  FIELD_OF_OTHER_CAPABILITY: 'REMOVED_BY_SHAPE',
  SCOPE_MISMATCH: 'REMOVED_BY_SHAPE',
  ENTITY_WITHOUT_FIELDS: 'REMOVED_BY_SHAPE',
  PROCEDURE_WITHOUT_EFFECT: 'REMOVED_BY_SHAPE',
  EFFECT_ON_NON_PROCEDURE: 'REMOVED_BY_SHAPE',
  BAD_DEPENDENCY: 'REMOVED_BY_SHAPE',
  PROCEDURE_WITHOUT_ORDER_PRECONDITION: 'SURVIVES',
  NO_CLOSING_STEP: 'SURVIVES',
  DUPLICATE_STEP: 'SURVIVES',
  NEED_ID_ORDER: 'SURVIVES',
  EMPTY_ASK: 'SURVIVES',
  IDENTITY_INPUT: 'SURVIVES',
  UNNAMED_INPUT: 'SURVIVES',
  DUPLICATE_INPUT: 'SURVIVES',
  NO_NEEDS: 'SURVIVES',
  TOO_MANY_NEEDS: 'SURVIVES',
  TOO_MANY_STEPS: 'SURVIVES',
  NO_STEPS: 'SURVIVES',
};

export function replay(rows, gold, vocab = C.loadVocabulary()) {
  const ix = C.index(vocab);
  const before = { rows: rows.length, invalid: 0, by_code: {}, rows_by_code: {} };
  const after = { invalid: 0, by_code: {}, projection: { dropped_effect: 0, dropped_depends_on: 0, dropped_fields: 0, corrected_scope: 0 } };
  const removed = {};
  const survived = {};
  const introduced = {};
  const seller = [];
  for (const row of rows) {
    const v2 = (row.violations ?? []).map((x) => x.code);
    if (v2.length) before.invalid++;
    for (const c of v2) {
      before.by_code[c] = (before.by_code[c] ?? 0) + 1;
      (before.rows_by_code[c] ??= new Set()).add(`${row.q}|${row.rep}`);
    }
    if (!row.plan) continue;
    const { plan, changes } = C.project(row.plan, ix);
    for (const k of Object.keys(changes)) after.projection[k] += changes[k];
    const parsed = C.parsePlan(plan, ix);
    const v3 = parsed.failure ? [`PARSE:${parsed.failure}`] : C.validate(parsed.plan, ix).map((x) => x.code);
    if (v3.length) after.invalid++;
    for (const c of v3) after.by_code[c] = (after.by_code[c] ?? 0) + 1;
    for (const c of new Set(v2)) (new Set(v3).has(c) ? survived : removed)[c] = ((new Set(v3).has(c) ? survived : removed)[c] ?? 0) + 1;
    for (const c of new Set(v3)) if (!new Set(v2).has(c)) introduced[c] = (introduced[c] ?? 0) + 1;
    // the seller-authority question, per need
    for (const n of row.plan.needs ?? []) {
      const closers = (n.steps ?? []).filter((s) => s.role === 'CLOSES');
      const authorities = [...new Set(closers.map((s) => ix.authority.get(s.capability)))];
      if (authorities.includes('SELLER') && authorities.length > 1) {
        seller.push({
          q: row.q, rep: row.rep, need: n.id,
          steps: (n.steps ?? []).map((s) => `${s.capability}/${s.role}`),
          other_closers: authorities.filter((a) => a !== 'SELLER'),
        });
      }
    }
  }
  before.rows_by_code = Object.fromEntries(Object.entries(before.rows_by_code).map(([k, v]) => [k, v.size]));
  const reps = [...new Set(rows.map((r) => r.rep))].sort();
  const goalScores = Object.fromEntries(reps.map((rep) => {
    const plans = rows.filter((r) => r.rep === rep && r.plan?.needs?.length).map((r) => {
      const { plan } = C.project(r.plan, ix);
      return { q: r.q, needs: plan.needs };
    });
    return [rep, scoreGoals(plans, gold, vocab)];
  }));
  return {
    contract: { kind: 'ESTIMATED', before, after, removed_by_shape: removed, survived, introduced, disposition: DISPOSITION },
    seller_closers: { kind: 'MEASURED', total: seller.length, cases: new Set(seller.map((s) => `${s.q}.${s.need}`)).size, rows: seller },
    goals: { kind: 'MEASURED_SCORER_CHANGE', per_rep: goalScores },
  };
}

function main(argv) {
  const arg = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
  const rows = readJsonl(arg('--obs'));
  const gold = readJsonl(arg('--gold')).map((g) => ({ ...g, need: g.goal ?? g.need }));
  const vocab = C.loadVocabulary();
  const report = replay(rows, gold, vocab);
  // the WP-2 positional scorer on the same rows, so the difference is visible rather than asserted
  const goldPositional = gold.map((g) => ({ ...g, status: g.status }));
  report.positional = Object.fromEntries([...new Set(rows.map((r) => r.rep))].sort().map((rep) => {
    const { rows: pred } = positional(rows.filter((r) => r.rep === rep), goldPositional);
    return [rep, scorePlans(pred, goldPositional, vocab)];
  }));
  const text = JSON.stringify(report, null, 1);
  if (arg('--json')) writeFileSync(arg('--json'), text + '\n');
  else console.log(text);
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
