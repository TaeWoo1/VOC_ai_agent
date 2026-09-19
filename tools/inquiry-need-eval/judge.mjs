#!/usr/bin/env node
// CoverageJudge calibration scorer (Inquiry Decision v2.1) — the judge as a component, held to the human gold on the
// exact candidates it was shown. Reads the rows CoverageJudgeCalibrationIT writes (ids and closed tokens only).
//   node tools/inquiry-need-eval/judge.mjs --obs <arm.jsonl> [--needs <needs.jsonl> --precedents <precedents.jsonl>]
//        [--json <out.json>]
// Definitions: docs/inquiry_decision_v2_1.md §5. Pure apart from reading its inputs.
import { writeFileSync } from 'node:fs';
import { readJsonl } from './io.mjs';

export const STATUSES = ['FULL', 'CONDITIONAL_ON_CUSTOMER', 'PARTIAL', 'NONE', 'UNKNOWN'];
const COVERED = new Set(['FULL', 'CONDITIONAL_ON_CUSTOMER']);
const RANK = { FULL: 3, CONDITIONAL_ON_CUSTOMER: 2, PARTIAL: 1, NONE: 0, UNKNOWN: 0 };
const ratio = (a, b) => (b ? a / b : null);
const key = (r) => `${r.q}.${r.need}`;

/** gold × said, over one field ('judged' = the model's word, 'enforced' = after code). A missing verdict is NONE. */
export function confusion(rows, field) {
  const m = Object.fromEntries(STATUSES.map((g) => [g, Object.fromEntries(STATUSES.map((s) => [s, 0]))]));
  for (const r of rows) m[r.gold][r[field] ?? 'NONE'] += 1;
  return m;
}

/** The headline numbers of one confusion matrix. FULL precision is the one that decides safety. */
export function metricsOf(rows, field) {
  const said = (r) => r[field] ?? 'NONE';
  const n = rows.length;
  const saidFull = rows.filter((r) => said(r) === 'FULL');
  const goldFull = rows.filter((r) => r.gold === 'FULL');
  const goldNotFull = rows.filter((r) => r.gold !== 'FULL');
  const saidCond = rows.filter((r) => said(r) === 'CONDITIONAL_ON_CUSTOMER');
  const goldCond = rows.filter((r) => r.gold === 'CONDITIONAL_ON_CUSTOMER');
  const goldCovered = rows.filter((r) => COVERED.has(r.gold));
  const goldUncovered = rows.filter((r) => !COVERED.has(r.gold));
  const pn = rows.filter((r) => ['PARTIAL', 'NONE'].includes(r.gold) && ['PARTIAL', 'NONE'].includes(said(r)));
  return {
    needs: n,
    full_precision: ratio(saidFull.filter((r) => r.gold === 'FULL').length, saidFull.length),
    said_full: saidFull.length,
    unsafe_full_promotions: saidFull.filter((r) => r.gold !== 'FULL').length,
    unsafe_full_promotion_rate: ratio(saidFull.filter((r) => r.gold !== 'FULL').length, goldNotFull.length),
    // A need the gold does not cover at all, declared covered: the PARTIAL_LEAK / WRONG shape at need level.
    unsafe_coverage_rate: ratio(goldUncovered.filter((r) => COVERED.has(said(r))).length, goldUncovered.length),
    // Gold CONDITIONAL said FULL: the UNDER_CLARIFY shape at need level.
    conditional_said_full: goldCond.filter((r) => said(r) === 'FULL').length,
    full_recall: ratio(goldFull.filter((r) => said(r) === 'FULL').length, goldFull.length),
    conditional_precision: ratio(saidCond.filter((r) => r.gold === 'CONDITIONAL_ON_CUSTOMER').length, saidCond.length),
    conditional_recall: ratio(goldCond.filter((r) => said(r) === 'CONDITIONAL_ON_CUSTOMER').length, goldCond.length),
    // Covered at the right sufficiency, over everything the gold covers: what is left of usefulness.
    useful_coverage: ratio(goldCovered.filter((r) => said(r) === r.gold).length, goldCovered.length),
    // Among needs both call uncovered: did the judge tell 「partly there」 from 「not there」?
    partial_none_agreement: ratio(pn.filter((r) => said(r) === r.gold).length, pn.length),
    exact_agreement: ratio(rows.filter((r) => said(r) === r.gold).length, n),
    coverage_agreement: ratio(rows.filter((r) => (said(r) === 'FULL' ? 'F' : COVERED.has(said(r)) ? 'C' : 'U')
      === (r.gold === 'FULL' ? 'F' : COVERED.has(r.gold) ? 'C' : 'U')).length, n),
    gold: Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.gold === s).length])),
  };
}

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

/**
 * @param rows        one arm's observation rows (need + call)
 * @param needsGold   optional Eval v1 needs (for precedent scoring)
 * @param reusable    optional set of REUSABLE memory prefixes
 */
export function scoreJudge(rows, { needsGold = [], reusable = new Set() } = {}) {
  const needs = rows.filter((r) => r.type === 'need');
  const calls = rows.filter((r) => r.type === 'call');
  const arm = rows[0]?.arm ?? null;
  const orig = needs.filter((r) => r.variant === 'ORIGINAL');
  const run1 = orig.filter((r) => r.run === 1);
  const runs = [...new Set(orig.map((r) => r.run))].sort();

  // Run-to-run agreement on the originals: every later run against run 1, need by need.
  const byRun = Object.fromEntries(runs.map((k) => [k, Object.fromEntries(orig.filter((r) => r.run === k).map((r) => [key(r), r]))]));
  const stability = runs.slice(1).map((k) => {
    const pairs = Object.keys(byRun[1]).filter((x) => byRun[k][x]);
    const same = (f) => pairs.filter((x) => (byRun[1][x][f] ?? 'NONE') === (byRun[k][x][f] ?? 'NONE')).length;
    return { run: k, needs: pairs.length, judged_agreement: ratio(same('judged'), pairs.length),
      enforced_agreement: ratio(same('enforced'), pairs.length),
      changed: pairs.filter((x) => (byRun[1][x].judged ?? 'NONE') !== (byRun[k][x].judged ?? 'NONE')) };
  });

  // Counterfactuals: each kind against its expectation. NO_RISE compares with THIS arm's run-1 verdict on the original.
  const cf = {};
  for (const r of needs.filter((x) => x.variant !== 'ORIGINAL')) {
    const scored = r.target === '*' || r.target === r.need;
    if (!scored) continue;
    const c = (cf[r.variant] ??= { fixtures: new Set(), scored_needs: 0, violations: [], injected_cited: 0 });
    c.fixtures.add(`${r.q}|${r.target}`);
    c.scored_needs += 1;
    const judged = r.judged ?? 'NONE';
    let bad = false;
    switch (r.expectation) {
      case 'NOT_COVERED': bad = COVERED.has(judged); break;
      case 'NOT_FULL': bad = judged === 'FULL'; break;
      case 'NOT_COVERED_ENFORCED': bad = COVERED.has(r.enforced); break;
      case 'NO_RISE': {
        const base = byRun[1]?.[key(r)];
        bad = !!base && RANK[judged] > RANK[base.judged ?? 'NONE'];
        if (r.injected_cited) c.injected_cited += 1;
        break;
      }
      default: break;
    }
    if (bad) c.violations.push(`${r.q}.${r.need}`);
  }
  const counterfactuals = Object.fromEntries(Object.entries(cf).map(([k, c]) => [k, {
    fixtures: c.fixtures.size, scored_needs: c.scored_needs, violations: c.violations.length,
    violation_rate: ratio(c.violations.length, c.scored_needs), injected_cited: c.injected_cited,
    violating: c.violations,
  }]));

  // Precedent proposals on the originals (run 1), against the need's gold precedents. With provenance in force only
  // REUSABLE answers were offered, so a wrong proposal is one the gold did not list for THIS need.
  const goldPrec = Object.fromEntries(needsGold.map((n) => [`${n.q}.${n.need}`, n.precedents ?? []]));
  let proposed = 0; let right = 0; let wrong = 0;
  const reachable = run1.filter((r) => (goldPrec[key(r)] ?? []).some((g) => reusable.has(g)) && !COVERED.has(r.gold));
  let recalled = 0;
  for (const r of run1) {
    for (const p of r.precedents ?? []) {
      proposed += 1;
      if ((goldPrec[key(r)] ?? []).some((g) => p.startsWith(g) || g.startsWith(p))) right += 1; else wrong += 1;
    }
  }
  for (const r of reachable) {
    if ((r.precedents ?? []).some((p) => goldPrec[key(r)].some((g) => p.startsWith(g) || g.startsWith(p)))) recalled += 1;
  }

  const notJudged = run1.filter((r) => r.enforcement === 'NOT_JUDGED').length;
  const enforcement = {};
  for (const r of run1) if (r.enforcement) enforcement[r.enforcement] = (enforcement[r.enforcement] ?? 0) + 1;
  const declared = { missing: 0, customer_input: 0, assumptions: 0 };
  for (const r of run1) {
    if (r.missing_n) declared.missing += 1;
    if (r.customer_input_n) declared.customer_input += 1;
    if (r.assumptions_n) declared.assumptions += 1;
  }

  const timed = calls.filter((c) => c.elapsed_ms != null);
  const unmatched = calls.reduce((a, c) => a + (c.unmatched_verdicts ?? 0), 0);
  return {
    arm,
    valid: unmatched === 0,
    not_judged_needs: notJudged,
    judge: metricsOf(run1, 'judged'),
    enforced: metricsOf(run1, 'enforced'),
    confusion_judged: confusion(run1, 'judged'),
    confusion_enforced: confusion(run1, 'enforced'),
    pooled_runs: runs.length > 1 ? metricsOf(orig, 'judged') : null,
    stability,
    counterfactuals,
    precedents: { proposed, right, wrong, reachable_needs: reachable.length, recalled,
      recall: ratio(recalled, reachable.length) },
    enforcement,
    declared_reasons: declared,
    calls: {
      total: calls.filter((c) => c.variant !== 'OTHER_LISTING').length,
      unanswered: calls.filter((c) => !c.answered).length,
      // Verdicts keyed by an id the input never sent: a protocol/harness fault. Non-zero makes the arm invalid.
      unmatched_verdicts: calls.reduce((a, c) => a + (c.unmatched_verdicts ?? 0), 0),
      p50_ms: pct(timed.map((c) => c.elapsed_ms), 50),
      p95_ms: pct(timed.map((c) => c.elapsed_ms), 95),
      mean_prompt_tokens: timed.length ? timed.reduce((a, c) => a + c.prompt_tokens, 0) / timed.length : null,
      mean_completion_tokens: timed.length ? timed.reduce((a, c) => a + c.completion_tokens, 0) / timed.length : null,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
  const rows = readJsonl(args.obs);
  const needsGold = args.needs ? readJsonl(args.needs) : [];
  const reusable = new Set(args.precedents ? readJsonl(args.precedents).filter((p) => p.precedent_scope === 'REUSABLE').map((p) => p.memory) : []);
  const out = scoreJudge(rows, { needsGold, reusable });
  if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 2));
  if (!out.valid) console.error(`INVALID ARM: ${out.calls.unmatched_verdicts} verdicts matched no need that was sent`);
  console.log(JSON.stringify({ arm: out.arm, valid: out.valid, not_judged_needs: out.not_judged_needs, judge: out.judge, enforced: out.enforced, stability: out.stability.map(({ changed, ...s }) => s),
    counterfactuals: Object.fromEntries(Object.entries(out.counterfactuals).map(([k, v]) => [k, { fixtures: v.fixtures, violations: v.violations, injected_cited: v.injected_cited }])),
    precedents: out.precedents, calls: out.calls }, null, 2));
}
