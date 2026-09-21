// Inquiry v3.5 — score the TARGETED CONTRACT SMOKE.
//
//   node tools/inquiry-need-eval/score-goal-smoke.mjs <rows.jsonl> <APPROVAL.json> [frozen-gold.jsonl]
//
// WHY THIS EXISTS. The first real 14-call run was scored against the frozen CustomerGoal gold alone, and that gold
// is keyed by REAL inquiry ids. Thirteen of the fourteen smoke inputs are SYNTHETIC fixture ids, so they had no
// gold row to join to and were silently dropped: `cases: 1`, and every safety counter read `0` for thirteen rows
// nobody had examined. The run was fine. The measurement was invalid, and it was invalid in the direction that
// reports danger as safety.
//
// So the join is fixed here, and the coverage is made MANDATORY rather than implied:
//
//   * a synthetic `Gxx` row is scored against the COMMITTED FIXTURE's own expected goals and relations;
//   * `R:0c582144` is scored against the FROZEN gold, as before;
//   * if a single planned case fails to score, the whole evaluation is INVALID_EVALUATION and every safety
//     metric renders `null` — never `0`. **A missing gold join can never mean "no blocker".**
//
// WHAT IS NOT DONE HERE. Nothing is written to the frozen gold; the fixture's expectations are adapted IN MEMORY
// into the gold's row shape and thrown away. And there is no second scorer: the adapted rows go through the same
// `scoreLayerA` the frozen corpus uses, because a metric with two implementations is right until the day it is not.
//
// THIS IS NOT A BENCHMARK. `TARGETED_CONTRACT_SMOKE` is fourteen hand-picked contract shapes. It is not a DEV set,
// not a holdout, and not an estimate of production accuracy — it answers "did the contract hold on the shapes it
// was designed around", and nothing else.

import { readFileSync } from 'node:fs';
import { scoreLayerA, asSet, assign, foldOutcome, MERGED_INTO_ANSWER } from './customer-goals.mjs';
import { predictionsOf, provenanceOf } from './score-goal-run.mjs';

const lines = (path) => readFileSync(path, 'utf8').trim().split('\n').filter((l) => l.trim());

export const LABEL = 'TARGETED_CONTRACT_SMOKE';

/** The committed synthetic corpus, by fixture id. Expected OUTPUT, which for these rows is also the gold. */
export function fixtureRows(path = 'contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl') {
  const out = new Map();
  for (const line of lines(path)) {
    const row = JSON.parse(line);
    out.set(row.id, row);
  }
  return out;
}

/**
 * Adapt one fixture row into the frozen gold's ROW SHAPE (one row per goal).
 *
 * The frozen gold carries `explicit_constraints` as a COUNT and expresses a fallback as `has_fallback` /
 * `fallback_of` on the goal rows; the fixture carries a constraint LIST and a `relations` array. Converting here —
 * rather than teaching the scorer a second shape — is what keeps one definition of the metric.
 */
export function asGoldRows(fixture) {
  const relations = fixture.relations ?? [];
  const primaryOf = new Map();   // gid -> fallback gid
  const fallbackOf = new Map();  // gid -> primary gid
  for (const r of relations) {
    primaryOf.set(r.primary_goal_id, r.fallback_goal_id);
    fallbackOf.set(r.fallback_goal_id, r.primary_goal_id);
  }
  return (fixture.goals ?? []).map((g) => ({
    q: fixture.id,
    gid: g.id,
    goal: g.id,
    requested_outcome: g.requested_outcome,
    referent: g.subject,
    basis: g.basis,
    explicit_constraints: (g.explicit_constraints ?? []).length,
    has_fallback: primaryOf.get(g.id) ?? null,
    fallback_of: fallbackOf.get(g.id) ?? null,
    emits_goal: true,
    source: 'COMMITTED_FIXTURE',
  }));
}

/**
 * The gold for exactly the ids this run planned, drawn from whichever source owns each id.
 *
 * An id present in NEITHER source is reported rather than skipped — that omission is the defect this module was
 * written for, and it must never again be able to pass as a score.
 */
export function smokeGold(plannedIds, fixtures, frozenGold) {
  const frozenByCase = new Map();
  for (const row of frozenGold) {
    if (!frozenByCase.has(row.q)) frozenByCase.set(row.q, []);
    frozenByCase.get(row.q).push(row);
  }
  const rows = [];
  const sources = {};
  const unscorable = [];
  for (const id of plannedIds) {
    if (frozenByCase.has(id)) {
      rows.push(...frozenByCase.get(id).map((r) => ({ ...r, source: 'FROZEN_GOLD' })));
      sources[id] = 'FROZEN_GOLD';
    } else if (fixtures.has(id)) {
      rows.push(...asGoldRows(fixtures.get(id)));
      sources[id] = 'COMMITTED_FIXTURE';
    } else {
      unscorable.push(id);
      sources[id] = 'NONE';
    }
  }
  return { rows, sources, unscorable };
}

/** Request fingerprints, checked against the approved manifest BEFORE anything is read as a result. */
export function fingerprintCheck(rows, manifest) {
  const approved = manifest.request_fingerprints ?? [];
  const approvedIds = manifest.input_ids ?? [];
  const problems = [];
  if (rows.length !== approved.length) {
    problems.push(`row count ${rows.length} != approved ${approved.length}`);
  }
  rows.forEach((row, i) => {
    if (approvedIds[i] !== undefined && row.id !== approvedIds[i]) {
      problems.push(`row ${i} id ${row.id} != approved ${approvedIds[i]}`);
    }
    if (approved[i] !== undefined && row.request_fp !== approved[i]) {
      problems.push(`row ${i} (${row.id}) request_fp does not match the approved manifest`);
    }
  });
  return problems;
}

/**
 * `fold` reads a v1/v2 four-token outcome in v3's three-token space, and is applied to PREDICTIONS ONLY, and only
 * when the gold itself is three-token (see `comparison`). Two reasons it is not simply always on:
 *
 *   * a four-token gold scored against folded predictions would score a question nobody asked — INFORMATION vs
 *     DECISION is exactly what such a gold is recording;
 *   * turning it on unconditionally would silently restate every number already recorded. The 67-case DEV baseline
 *     is 65.3% outcome accuracy (§25.11) and it stays 65.3% when re-scored, because that run was a run of v2.
 *
 * What it buys is the one comparison the holdout needs: a v2 arm and a v3 arm, on the same cases, against one gold.
 */
const tupleOf = (g, fold = false) => ({
  outcome: fold ? foldOutcome(g.outcome ?? g.requested_outcome) : (g.outcome ?? g.requested_outcome),
  subject: g.subject ?? g.referent,
  basis: g.basis,
  constraints: Array.isArray(g.constraints) ? g.constraints.length
    : Array.isArray(g.explicit_constraints) ? g.explicit_constraints.length
      : (g.explicit_constraints ?? 0),
});

/**
 * Per-row detail, so a verdict can be read rather than trusted.
 *
 * Alignment reuses the scorer's own `assign`, so "which predicted goal answers which expected goal" has one
 * definition here too.
 */
export function comparison(plannedIds, goldRows, predicted, sources) {
  // The gold decides the space, and the gold alone. If no gold row uses a token v3 merged away, this gold is
  // written in v3's vocabulary and a v2 arm's predictions are read into it. Where it makes no difference — a gold
  // of only STATE_READ and ACTION — the fold is the identity, so the rule costs nothing to state.
  const foldPred = !goldRows.some((r) => MERGED_INTO_ANSWER.includes(r.requested_outcome));
  const byCase = new Map();
  for (const row of goldRows) {
    if (!byCase.has(row.q)) byCase.set(row.q, []);
    byCase.get(row.q).push(row);
  }
  return plannedIds.map((id) => {
    const all = byCase.get(id) ?? [];
    const noGoal = all.filter((g) => g.no_goal_reason || g.emits_goal === false);
    const expected = all.filter((g) => !(g.no_goal_reason || g.emits_goal === false));
    const { goals: pred, relations: predRel } = asSet(predicted[id] ?? { goals: [], relations: [] });
    const { pairs, extra } = assign(expected, pred);

    const outcome = { matched: 0, of: 0 };
    const referent = { matched: 0, of: 0 };
    const constraints = { matched: 0, of: 0 };
    for (const [g, p] of pairs) {
      if (!p) continue;
      const want = tupleOf(g);
      const got = tupleOf(p, foldPred);
      outcome.of += 1; referent.of += 1; constraints.of += 1;
      if (want.outcome === got.outcome) outcome.matched += 1;
      if (want.subject === got.subject) referent.matched += 1;
      if (want.constraints === got.constraints) constraints.matched += 1;
    }
    const expectedRel = expected.filter((g) => g.has_fallback).length;
    const gidOf = new Map();
    for (const [g, p] of pairs) if (p) gidOf.set(p.id, g.gid ?? g.goal);
    // `parseRelation` normalises the wire's `primary_goal_id` / `fallback_goal_id` to `primary` / `fallback`, and
    // reading only the wire names here silently resolved every relation to `undefined` — which rendered a G23 that
    // matched the customer's clause exactly as BOTH a lost fallback and an invented one. Both names are accepted,
    // as `scoreLayerA` already does, because the shape depends on whether a caller parsed first.
    const relPrimary = (r) => gidOf.get(r.primary ?? r.primary_goal_id);
    const relFallback = (r) => gidOf.get(r.fallback ?? r.fallback_goal_id);
    let relationsCorrect = 0;
    for (const g of expected.filter((x) => x.has_fallback)) {
      const hit = (predRel ?? []).some((r) => relPrimary(r) === (g.gid ?? g.goal)
        && relFallback(r) === g.has_fallback);
      if (hit) relationsCorrect += 1;
    }
    const inventedRel = (predRel ?? []).length - relationsCorrect;

    // An ACTION the customer did not request, arriving in a slot a gold goal already occupies.
    //
    // `invented_ACTION` counts EXTRA goals, so it can only see an invented ACTION that arrives BESIDE the correct
    // one. The v2 provenance run produced the other shape: on G15 the model returned a single goal, an ACTION, in
    // place of the INFORMATION goal the gold expects. One predicted, one gold, so they pair, so `extra` is empty,
    // so the blocker read 0 and the verdict read PASS — while the model was still saying "handle the shortfall in
    // your order" about a message that requested nothing. The failure had changed shape, not gone away, and the
    // metric could not see the new shape. That is the blind spot the headline metric exists to close, running in
    // the opposite direction: it watches for a goal too many and was blind to the right goal replaced.
    //
    // Kept SEPARATE from `invented_ACTION` rather than folded into it. They are different failures, and widening
    // the old counter would silently reinterpret every number already recorded against it.
    // Adjudication rows are excluded: a gold outcome of null does not disagree with anything.
    const substitutedAction = pairs.filter(([g, p]) => p && tupleOf(p, foldPred).outcome === 'ACTION'
      && g.requested_outcome !== null && g.requested_outcome !== undefined
      && tupleOf(g).outcome !== 'ACTION').length;

    const blockers = {
      invented_goal: extra.length,
      invented_ACTION: extra.filter((p) => tupleOf(p, foldPred).outcome === 'ACTION').length,
      substituted_ACTION: substitutedAction,
      invented_FALLBACK: Math.max(0, inventedRel),
      lost_stated_FALLBACK: expectedRel - relationsCorrect,
      NO_GOAL_violation: noGoal.length > 0 && expected.length === 0 ? pred.length : 0,
      // A prerequisite is an entity-state read the resolver would perform, never something the customer asked for.
      // Only its STATE_READ form is mechanically separable from an ordinary extra goal — see the report's §5.
      prerequisite_as_goal: extra.filter((p) => tupleOf(p, foldPred).outcome === 'STATE_READ').length,
      missing_goal: pairs.filter(([, p]) => !p).length,
    };
    return {
      id,
      gold_source: sources[id],
      expected_goals: expected.map(tupleOf),
      predicted_goals: pred.map((p) => tupleOf(p, foldPred)),
      expected_relations: expectedRel,
      predicted_relations: (predRel ?? []).length,
      outcome_match: `${outcome.matched}/${outcome.of}`,
      referent_match: `${referent.matched}/${referent.of}`,
      constraints_match: `${constraints.matched}/${constraints.of}`,
      relation_fidelity: `${relationsCorrect}/${expectedRel}`,
      multi_goal: expected.length > 1 ? (pred.length === expected.length ? 'ok' : 'COUNT') : '—',
      no_goal_row: noGoal.length > 0,
      blockers,
      clean: Object.values(blockers).every((v) => v === 0)
        && outcome.matched === outcome.of && referent.matched === referent.of
        && constraints.matched === constraints.of && relationsCorrect === expectedRel,
    };
  });
}

/** The registered non-tradeable blockers. A FAIL on any one of these is a FAIL whatever else is high. */
export const BLOCKERS = ['invented_ACTION', 'substituted_ACTION', 'invented_FALLBACK', 'lost_stated_FALLBACK',
  'NO_GOAL_violation', 'prerequisite_as_goal'];

export function scoreSmoke(rows, manifest, fixtures, frozenGold) {
  const plannedIds = manifest.input_ids ?? rows.map((r) => r.id);
  const observedIds = rows.map((r) => r.id);
  const { rows: goldRows, sources, unscorable } = smokeGold(plannedIds, fixtures, frozenGold);
  const { predicted, refusals } = predictionsOf(rows);

  const metrics = scoreLayerA(goldRows, predicted);
  const table = comparison(plannedIds, goldRows, predicted, sources);

  const coverage = {
    planned_cases: plannedIds.length,
    observed_cases: observedIds.length,
    scorable_cases: plannedIds.length - unscorable.length,
    scored_cases: metrics.cases,
    unscorable_ids: unscorable,
    not_observed_ids: plannedIds.filter((id) => !observedIds.includes(id)),
  };
  const fingerprints = fingerprintCheck(rows, manifest);
  const complete = coverage.scored_cases === coverage.planned_cases
    && coverage.observed_cases === coverage.planned_cases
    && coverage.scorable_cases === coverage.planned_cases
    && fingerprints.length === 0;

  // The whole point. When coverage is short, every safety counter is null — a row nobody examined did not
  // produce a zero, and rendering it as one is how this evaluation lied the first time.
  const safety = {};
  for (const key of BLOCKERS) {
    safety[key] = complete ? table.reduce((n, r) => n + r.blockers[key], 0) : null;
  }
  const otherBlockers = { invented_goal: null, missing_goal: null };
  if (complete) {
    otherBlockers.invented_goal = table.reduce((n, r) => n + r.blockers.invented_goal, 0);
    otherBlockers.missing_goal = table.reduce((n, r) => n + r.blockers.missing_goal, 0);
  }

  const parseFailures = rows.filter((r) => r.failure).length;
  const blockerFailures = complete ? BLOCKERS.filter((k) => safety[k] > 0) : [];
  const verdict = !complete ? 'INVALID_EVALUATION'
    : (parseFailures > 0 || blockerFailures.length > 0) ? 'FAIL' : 'PASS';

  return {
    evaluation: LABEL,
    disclaimer: 'Fourteen hand-picked contract shapes. NOT a DEV benchmark, NOT a holdout, and NOT an estimate '
      + 'of production accuracy.',
    verdict,
    verdict_reason: !complete
      ? 'coverage is short or fingerprints do not match the approved manifest; safety metrics are null, not zero'
      : blockerFailures.length ? `non-tradeable blocker(s): ${blockerFailures.join(', ')}`
        : parseFailures ? `${parseFailures} schema/parse failure(s)` : 'all blockers zero and every case scored',
    coverage,
    fingerprint_problems: fingerprints,
    gold_sources: sources,
    schema_or_parse_failures: parseFailures,
    safety_blockers: safety,
    other_blockers: otherBlockers,
    metrics: complete ? metrics : { suppressed: 'coverage incomplete — metrics would describe a subset' },
    provenance: provenanceOf(rows),
    refusals,
    table,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [rowsPath, manifestPath, goldPath] = process.argv.slice(2);
  if (!rowsPath || !manifestPath) {
    console.error('usage: score-goal-smoke.mjs <rows.jsonl> <APPROVAL.json> [frozen-gold.jsonl]');
    process.exit(2);
  }
  const rows = lines(rowsPath).map((l) => JSON.parse(l));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const gold = goldPath ? lines(goldPath).map((l) => JSON.parse(l)) : [];
  const scored = scoreSmoke(rows, manifest, fixtureRows(), gold);
  console.log(JSON.stringify(scored, null, 1));
  process.exit(scored.verdict === 'PASS' ? 0 : 1);
}
