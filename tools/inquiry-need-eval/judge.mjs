#!/usr/bin/env node
// CoverageJudge calibration scorer (Inquiry Decision v2.1) — the judge as a component, held to the human gold on the
// exact candidates it was shown. Reads the rows CoverageJudgeCalibrationIT writes (ids and closed tokens only).
//   node tools/inquiry-need-eval/judge.mjs --obs <arm.jsonl> [--needs <needs.jsonl> --precedents <precedents.jsonl>]
//        [--json <out.json>]
//   node tools/inquiry-need-eval/judge.mjs --parity <armA.jsonl>,<armB.jsonl> --may-differ system_fp,schema_fp
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

/**
 * <b>Judge-component case projection</b> (v2.2): what the product would do with each question, from the need statuses in
 * `field`, against what the pool gold says it should do — the same aggregation NeedAggregation applies (any need not
 * covered → seller; any CONDITIONAL → ask the customer; else answer). Gold needs as the plan and the judge's own pool,
 * so these are NOT the Eval v1 pipeline numbers and must not be compared with them. A failed call sends the case to
 * the seller.
 */
export function caseOutcomes(rows, field) {
  const byQ = {};
  for (const r of rows) (byQ[r.q] ??= []).push(r);
  const decide = (ss) => (ss.some((x) => !COVERED.has(x)) ? 'ASK_SELLER'
    : ss.some((x) => x === 'CONDITIONAL_ON_CUSTOMER') ? 'ASK_CUSTOMER' : 'ANSWER');
  const out = {};
  const cases = {};
  for (const [q, needs] of Object.entries(byQ)) {
    const truth = decide(needs.map((r) => r.gold));
    const sys = needs.some((r) => r.failed) ? 'ASK_SELLER' : decide(needs.map((r) => r[field] ?? 'NONE'));
    let o;
    if (sys === 'ASK_SELLER') o = truth === 'ASK_SELLER' ? 'CORRECT_ESCALATION' : 'UNNECESSARY_ESCALATION';
    else if (truth === 'ASK_SELLER') o = needs.some((r) => COVERED.has(r.gold)) ? 'PARTIAL_LEAK' : 'WRONG';
    else if (sys === 'ANSWER' && truth === 'ASK_CUSTOMER') o = 'UNDER_CLARIFY';
    else if (sys === 'ASK_CUSTOMER' && truth === 'ANSWER') o = 'OVER_CLARIFY';
    else o = sys === 'ANSWER' ? 'SAFE_ANSWER' : 'SAFE_CLARIFY';
    out[o] = (out[o] ?? 0) + 1;
    cases[q] = o;
  }
  const noAsk = Object.values(cases).filter((o) => !o.endsWith('ESCALATION')).length;
  const safe = (out.SAFE_ANSWER ?? 0) + (out.SAFE_CLARIFY ?? 0);
  const safeTruth = Object.entries(byQ).filter(([, n]) => decide(n.map((r) => r.gold)) !== 'ASK_SELLER').length;
  return {
    cases: Object.keys(byQ).length,
    outcomes: out,
    no_ask: noAsk,
    strict_safe_precision: ratio(safe, noAsk),
    unsafe_automation: (out.PARTIAL_LEAK ?? 0) + (out.WRONG ?? 0) + (out.UNDER_CLARIFY ?? 0),
    safe_automation_coverage: ratio(safe, safeTruth),
    unsafe_cases: Object.entries(cases).filter(([, o]) => ['PARTIAL_LEAK', 'WRONG', 'UNDER_CLARIFY'].includes(o)).map(([q, o]) => `${q}:${o}`),
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
/**
 * Why an arm's rows cannot be trusted, before any metric is read. Every entry is a harness or protocol fault, never a
 * judgement: the arm is INVALID while this list is non-empty (Inquiry Decision v2.1 audit, after apr-80adf54f).
 */
export function integrity(rows, { needsGold = [] } = {}) {
  const problems = [];
  const needs = rows.filter((r) => r.type === 'need');
  const calls = rows.filter((r) => r.type === 'call');
  const seen = new Set();
  for (const r of needs) {
    const k = `${r.run}|${r.q}|${r.variant}|${r.target}|${r.need}`;
    if (seen.has(k)) problems.push(`DUPLICATE_ROW ${k}`);
    seen.add(k);
  }
  const unmatched = calls.reduce((a, c) => a + (c.unmatched_verdicts ?? 0), 0);
  if (unmatched) problems.push(`UNMATCHED_VERDICTS ${unmatched}`);
  // A verdict set is all or nothing since the v2.1 audit: a need left unjudged inside an ANSWERED call can only be a
  // mapping fault — exactly how apr-80adf54f lost 11–40 needs per arm.
  const notJudged = needs.filter((r) => !r.failed && r.enforcement === 'NOT_JUDGED').length;
  if (notJudged) problems.push(`NOT_JUDGED ${notJudged}`);
  // The same variant must have sent the same input on every run of this arm.
  const fp = {};
  for (const c of calls) {
    if (!c.input_fp) continue;
    const k = `${c.q}|${c.variant}|${c.target}`;
    if (fp[k] && fp[k] !== c.input_fp) problems.push(`INPUT_DRIFT ${k}`);
    fp[k] ??= c.input_fp;
  }
  // Each ORIGINAL run must hold exactly the gold needs of every question it touched — no more, no fewer.
  if (needsGold.length) {
    const goldByQ = {};
    for (const n of needsGold) (goldByQ[n.q] ??= new Set()).add(n.need);
    const byRunQ = {};
    for (const r of needs.filter((x) => x.variant === 'ORIGINAL')) (byRunQ[`${r.run}|${r.q}`] ??= []).push(r.need);
    for (const [k, got] of Object.entries(byRunQ)) {
      const want = goldByQ[k.split('|')[1]];
      const same = want && got.length === want.size && got.every((x) => want.has(x));
      if (!same) problems.push(`GOLD_MAPPING ${k}`);
    }
  }
  return problems;
}

/**
 * Two arms are comparable only if every call sent byte-identical INPUT for the same variant and the same model, format
 * and token limit; what may differ is declared by the caller (A/B: the instruction and its schema; B/C: the effort).
 */
export function parity(armA, armB, { mayDiffer = [] } = {}) {
  const key = (c) => `${c.q}|${c.variant}|${c.target}|${c.run}`;
  const callsOf = (rows) => Object.fromEntries(rows.filter((r) => r.type === 'call' && r.judge !== 'WORST_CASE').map((c) => [key(c), c]));
  const a = callsOf(armA);
  const b = callsOf(armB);
  const problems = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const fields = ['input_fp', 'model', 'max_tokens', 'format', 'system_fp', 'schema_fp', 'effort'];
  const differed = new Set();
  for (const k of keys) {
    if (!a[k] || !b[k]) { problems.push(`MISSING_CALL ${k}`); continue; }
    for (const f of fields) {
      if (a[k][f] !== b[k][f]) {
        if (mayDiffer.includes(f)) differed.add(f); else problems.push(`${f.toUpperCase()}_DIFFERS ${k}`);
      }
    }
  }
  return { comparable: problems.length === 0, problems, differed: [...differed].sort() };
}

export function scoreJudge(rows, { needsGold = [], reusable = new Set() } = {}) {
  const problems = integrity(rows, { needsGold });
  const failedNeeds = rows.filter((r) => r.type === 'need' && r.failed);
  // A failed call has no verdict; its needs are reported as failures and never enter a quality metric as NONE.
  rows = rows.filter((r) => !(r.type === 'need' && r.failed));
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
  return {
    arm,
    valid: problems.length === 0,
    problems,
    failed_needs: failedNeeds.length,
    failures: failedNeeds.reduce((a, r) => ((a[r.failure] = (a[r.failure] ?? 0) + 1), a), {}),
    not_judged_needs: notJudged,
    judge: metricsOf(run1, 'judged'),
    enforced: metricsOf(run1, 'enforced'),
    cases_judged: caseOutcomes(run1, 'judged'),
    cases_enforced: caseOutcomes(run1, 'enforced'),
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
  if (args.parity) {
    const [x, y] = args.parity.split(',');
    const res = parity(readJsonl(x), readJsonl(y), { mayDiffer: (args['may-differ'] ?? '').split(',').filter(Boolean) });
    console.log(JSON.stringify({ ...res, problems: res.problems.slice(0, 20) }, null, 2));
    process.exit(res.comparable ? 0 : 1);
  }
  const rows = readJsonl(args.obs);
  const needsGold = args.needs ? readJsonl(args.needs) : [];
  const reusable = new Set(args.precedents ? readJsonl(args.precedents).filter((p) => p.precedent_scope === 'REUSABLE').map((p) => p.memory) : []);
  const out = scoreJudge(rows, { needsGold, reusable });
  if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 2));
  if (!out.valid) console.error(`INVALID ARM: ${out.problems.slice(0, 5).join('; ')}`);
  console.log(JSON.stringify({ arm: out.arm, valid: out.valid, not_judged_needs: out.not_judged_needs, judge: out.judge, enforced: out.enforced, stability: out.stability.map(({ changed, ...s }) => s),
    counterfactuals: Object.fromEntries(Object.entries(out.counterfactuals).map(([k, v]) => [k, { fixtures: v.fixtures, violations: v.violations, injected_cited: v.injected_cited }])),
    precedents: out.precedents, calls: out.calls }, null, 2));
}
