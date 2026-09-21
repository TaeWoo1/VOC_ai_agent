// Inquiry v3.5 — score the PAIRED HOLDOUT (§25.13, §26.6).
//
//   node tools/inquiry-need-eval/score-goal-holdout.mjs <v2-rows.jsonl> <v3-rows.jsonl> [cases.jsonl]
//
// WHAT THIS ANSWERS, and nothing else: does merging DECISION into ANSWER raise the rate at which an ambiguous
// answering request leaks to ACTION? The decision rule is registered in
// contracts/inquiry-goal-holdout/v1/dataset.meta.json and in §26.6, and it was fixed BEFORE the run. This file
// implements that rule and offers no other.
//
// THE PAIRING. Both arms saw the same 75 inputs — asserted at prepare time by the two manifests agreeing on
// `input_set_fp`, and re-checked here from the rows themselves. So the comparison is PAIRED: each case contributes
// one before/after pair, and the statistic is the DISAGREEMENT between arms, not two independent proportions.
// McNemar's exact test is the paired test for a binary outcome; a two-proportion test on the same data would throw
// away the pairing and report a wider interval than the design earns.
//
// THE FOLD. The v2 arm speaks four tokens. Its INFORMATION and DECISION fold to ANSWER before anything is compared,
// because the gold is written in v3's three-token space. The fold never runs the other way: ANSWER does not
// decompose, and which of the two it would have been is exactly the fact v3 stopped recording.
//
// WHAT IS NOT HERE. No accuracy headline — the arms have different label spaces and the question is not accuracy.
// No tuning knob, no threshold to pick, no alternative test to fall back on if the first one is unflattering.

import { readFileSync } from 'node:fs';
import { asSet, assign, foldOutcome, MERGED_INTO_ANSWER } from './customer-goals.mjs';
import { predictionsOf, provenanceOf } from './score-goal-run.mjs';

const lines = (path) => readFileSync(path, 'utf8').trim().split('\n').filter((l) => l.trim());

export const LABEL = 'PAIRED_HOLDOUT_V1';

/** The holdout's own shape, adapted to the gold ROW shape the scorer already reads. One row per goal. */
export function holdoutGold(cases) {
  const rows = [];
  for (const c of cases) {
    const goals = c.goals ?? [];
    if (goals.length === 0) {
      rows.push({ q: c.q, gid: 'n1', goal: 'n1', emits_goal: false, no_goal_reason: c.why ?? 'no request',
        requested_outcome: null, referent: null, basis: null, explicit_constraints: 0,
        stratum: c.s, conf: c.conf, pair: c.pair ?? null, source: c.source });
      continue;
    }
    const rel = c.relation ?? null;
    goals.forEach(([outcome, referent, basis, n], i) => {
      rows.push({
        q: c.q, gid: `n${i + 1}`, goal: `n${i + 1}`, emits_goal: true,
        requested_outcome: outcome, referent, basis, explicit_constraints: n,
        has_fallback: rel && rel[0] === i ? `n${rel[1] + 1}` : null,
        fallback_of: rel && rel[1] === i ? `n${rel[0] + 1}` : null,
        stratum: c.s, conf: c.conf, pair: c.pair ?? null, source: c.source,
      });
    });
  }
  return rows;
}

const outcomeOf = (g, fold) => (fold ? foldOutcome(g.outcome ?? g.requested_outcome)
  : (g.outcome ?? g.requested_outcome));

/**
 * Per-case verdict for ONE arm.
 *
 * `leaked` is the primary observation: this case's gold says ANSWER somewhere, and the arm answered ACTION in the
 * slot a gold ANSWER occupies. It is deliberately read off the ALIGNED pair rather than off the raw prediction
 * list — "the model also produced an ACTION" is a different failure (`invented_ACTION`) and is counted separately,
 * because widening one counter into the other is how two distinct defects come to share one number.
 */
export function armVerdicts(cases, gold, predicted, fold) {
  const byCase = new Map();
  for (const row of gold) {
    if (!byCase.has(row.q)) byCase.set(row.q, []);
    byCase.get(row.q).push(row);
  }
  const out = new Map();
  for (const c of cases) {
    const all = byCase.get(c.q) ?? [];
    const expected = all.filter((g) => g.emits_goal);
    const isNoGoal = expected.length === 0;
    const { goals: pred } = asSet(predicted[c.q] ?? { goals: [], relations: [] });
    const { pairs, extra } = assign(expected, pred);

    let outcomeOk = 0;
    let referentOk = 0;
    let constraintOk = 0;
    let scored = 0;
    let leaked = false;
    let reverseLeaked = false;
    let substituted = 0;
    for (const [g, p] of pairs) {
      if (!p) continue;
      scored += 1;
      const want = g.requested_outcome;
      const got = outcomeOf(p, fold);
      if (want === got) outcomeOk += 1;
      if (g.referent === (p.subject ?? p.referent)) referentOk += 1;
      if (g.explicit_constraints === (p.constraints?.length ?? 0)) constraintOk += 1;
      if (want === 'ANSWER' && got === 'ACTION') leaked = true;
      if (want === 'ACTION' && got === 'ANSWER') reverseLeaked = true;
      if (want !== null && want !== 'ACTION' && got === 'ACTION') substituted += 1;
    }
    out.set(c.q, {
      q: c.q, stratum: c.s, conf: c.conf, pair: c.pair ?? null,
      answerGold: expected.some((g) => g.requested_outcome === 'ANSWER'),
      actionGold: expected.some((g) => g.requested_outcome === 'ACTION'),
      noGoal: isNoGoal,
      leaked, reverseLeaked, substituted,
      inventedGoal: extra.length,
      inventedAction: extra.filter((p) => outcomeOf(p, fold) === 'ACTION').length,
      noGoalViolation: isNoGoal ? pred.length : 0,
      missing: pairs.filter(([, p]) => !p).length,
      scored, outcomeOk, referentOk, constraintOk,
      predicted: pred.map((p) => outcomeOf(p, fold)),
      expected: expected.map((g) => g.requested_outcome),
    });
  }
  return out;
}

/**
 * McNemar's EXACT test, two-sided, on the discordant pairs.
 *
 * Exact rather than the chi-square approximation because b + c here is a handful, which is precisely where the
 * approximation is not trustworthy — and choosing the test after seeing the counts is how a result gets chosen.
 * Registered in §26.6 before the run.
 */
export function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return { b, c, n, p: 1 };
  const logC = (k) => {
    let s = 0;
    for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1);
    return s;
  };
  const pmf = (k) => Math.exp(logC(k) + n * Math.log(0.5));
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += pmf(i);
  return { b, c, n, p: Math.min(1, 2 * tail) };
}

/** The registered decision rule, applied mechanically. No branch here was added after a number was seen. */
export function verdictOf(b, c, p) {
  if (b <= c) {
    return { verdict: 'NO_INCREASE', ships: true,
      why: 'the v3 arm leaked on no more cases than the v2 arm did' };
  }
  if (p >= 0.05) {
    return b - c <= 2
      ? { verdict: 'NOT_DISTINGUISHABLE', ships: true,
        why: `b-c = ${b - c} (<= 2) and p = ${p.toFixed(3)}: within what this size can resolve` }
      : { verdict: 'HOLD', ships: false,
        why: `b-c = ${b - c} (> 2) with p = ${p.toFixed(3)}: not significant, but larger than the registered `
          + 'tolerance for shipping on an inconclusive result' };
  }
  return { verdict: 'INCREASE_CONFIRMED', ships: false,
    why: `p = ${p.toFixed(4)} < 0.05: the merge raises ACTION leakage and does not ship as it stands` };
}

function totals(v, filter) {
  const rows = [...v.values()].filter(filter);
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  return {
    cases: rows.length,
    outcome: `${sum((r) => r.outcomeOk)}/${sum((r) => r.scored)}`,
    referent: `${sum((r) => r.referentOk)}/${sum((r) => r.scored)}`,
    constraints: `${sum((r) => r.constraintOk)}/${sum((r) => r.scored)}`,
    invented_goal: sum((r) => r.inventedGoal),
    invented_ACTION: sum((r) => r.inventedAction),
    substituted_ACTION: sum((r) => r.substituted),
    missing_goal: sum((r) => r.missing),
    NO_GOAL_violation: sum((r) => r.noGoalViolation),
  };
}

export function score(v2Rows, v3Rows, cases) {
  const gold = holdoutGold(cases);
  const ids = cases.map((c) => c.q);

  // The pairing, re-checked from the rows rather than trusted from the manifests.
  const seen = (rows) => rows.map((r) => r.id ?? r.q).sort().join('\u0000');
  const problems = [];
  if (seen(v2Rows) !== seen(v3Rows)) problems.push('THE ARMS DID NOT SEE THE SAME CASES');
  for (const [name, rows] of [['v2', v2Rows], ['v3', v3Rows]]) {
    const missing = ids.filter((id) => !rows.some((r) => (r.id ?? r.q) === id));
    if (missing.length) problems.push(`${name} is short ${missing.length}: ${missing.slice(0, 5).join(', ')}`);
    const inputFps = new Map(rows.map((r) => [r.id ?? r.q, r.input_fp]));
    if (name === 'v3') {
      const v2Fps = new Map(v2Rows.map((r) => [r.id ?? r.q, r.input_fp]));
      // The customer's half of the request. Identical bytes, or the two arms answered different questions.
      const differing = [...inputFps].filter(([id, fp]) => v2Fps.get(id) !== fp).map(([id]) => id);
      if (differing.length) problems.push(`the arms were asked differently on ${differing.length} case(s)`);
    }
  }
  const armOf = (rows) => [...new Set(rows.map((r) => r.prompt_version))];
  const v2Arm = armOf(v2Rows);
  const v3Arm = armOf(v3Rows);
  if (v2Arm.length !== 1 || !MERGED_INTO_ANSWER.length) problems.push('the v2 arm is not one contract');
  if (v3Arm.length !== 1) problems.push('the v3 arm is not one contract');
  if (v2Arm[0] === v3Arm[0]) problems.push('both arms recorded the SAME prompt_version — this is not a comparison');

  const v2Pred = predictionsOf(v2Rows);
  const v3Pred = predictionsOf(v3Rows);
  const v2 = armVerdicts(cases, gold, v2Pred.predicted, true);
  const v3 = armVerdicts(cases, gold, v3Pred.predicted, false);

  // PRIMARY — HIGH-confidence cases whose gold says ANSWER. Registered before the run; MEDIUM never folded in.
  const primaryIds = cases.filter((c) => c.conf === 'HIGH' && (c.goals ?? []).some((g) => g[0] === 'ANSWER'))
    .map((c) => c.q);
  let b = 0;
  let c = 0;
  const gained = [];
  const lost = [];
  for (const id of primaryIds) {
    const was = v2.get(id).leaked;
    const now = v3.get(id).leaked;
    if (!was && now) { b += 1; gained.push(id); }
    if (was && !now) { c += 1; lost.push(id); }
  }
  const test = mcnemarExact(b, c);
  const decision = verdictOf(b, c, test.p);

  const leakRate = (v) => {
    const n = primaryIds.filter((id) => v.get(id).leaked).length;
    return { leaked: n, of: primaryIds.length, rate: primaryIds.length ? n / primaryIds.length : null };
  };

  return {
    label: LABEL,
    evaluation_valid: problems.length === 0,
    problems,
    provenance: { v2: provenanceOf(v2Rows), v3: provenanceOf(v3Rows) },
    primary: {
      question: 'does merging DECISION into ANSWER raise ACTION leakage on ambiguous answering requests?',
      denominator: 'HIGH-confidence cases whose gold carries an ANSWER goal',
      n: primaryIds.length,
      v2: leakRate(v2),
      v3: leakRate(v3),
      mcnemar: test,
      leaks_gained_by_v3: gained,
      leaks_fixed_by_v3: lost,
      ...decision,
    },
    secondary: {
      v2_all: totals(v2, () => true),
      v3_all: totals(v3, () => true),
      v2_HIGH: totals(v2, (r) => r.conf === 'HIGH'),
      v3_HIGH: totals(v3, (r) => r.conf === 'HIGH'),
      reverse_leak_v2: [...v2.values()].filter((r) => r.reverseLeaked).map((r) => r.q),
      reverse_leak_v3: [...v3.values()].filter((r) => r.reverseLeaked).map((r) => r.q),
      refusals: { v2: v2Pred.refusals, v3: v3Pred.refusals },
      by_stratum: Object.fromEntries(['C', 'A', 'T', 'S', 'N', 'R'].map((s) => [s, {
        v2: totals(v2, (r) => r.stratum === s), v3: totals(v3, (r) => r.stratum === s),
      }])),
    },
    per_case: [...v3.keys()].map((id) => ({
      q: id, stratum: v3.get(id).stratum, conf: v3.get(id).conf, pair: v3.get(id).pair,
      expected: v3.get(id).expected,
      v2: v2.get(id).predicted, v3: v3.get(id).predicted,
      v2_leaked: v2.get(id).leaked, v3_leaked: v3.get(id).leaked,
    })),
  };
}

if (process.argv[1] && process.argv[1].endsWith('score-goal-holdout.mjs')) {
  const [, , v2Path, v3Path, casesPath] = process.argv;
  const cases = lines(casesPath
    ?? `${process.env.HOME}/.cache/sellerops-eval/inquiry-goal-holdout/v1/cases.jsonl`).map((l) => JSON.parse(l));
  const out = score(lines(v2Path).map((l) => JSON.parse(l)), lines(v3Path).map((l) => JSON.parse(l)), cases);
  console.log(JSON.stringify(out, null, 1));
}
