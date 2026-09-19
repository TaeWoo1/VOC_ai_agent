#!/usr/bin/env node
// L1 + L2 + L3 → need- and case-level outcomes and the headline metrics. Pure apart from reading the three inputs.
//   node tools/inquiry-need-eval/score.mjs --dataset <dir> --snapshot <S.json> --obs <run.jsonl>
//        [--baseline <run.jsonl>] [--json <out.json>]
// Definitions: docs/inquiry_need_eval_v1.md §5–§6.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDataset, readJsonl, parseRef, likeToRegExp } from './io.mjs';
import { RANK, bestOf, SYSTEM_ACTION } from './vocabulary.mjs';
import { deriveTruth } from './truth.mjs';

/** Did this run observe this ref? Ids are compared by prefix, so an 8-char gold id matches a full runtime uuid. */
export function observed(ref, row) {
  const p = parseRef(ref);
  const statements = row.catalogue?.statements ?? [];
  const onProduct = (s) => s.product?.startsWith(p.id);
  switch (p.kind) {
    case 'PK': return row.current.some((c) => c.scope === 'PRODUCT' && c.source.startsWith(p.id));
    case 'OK': return row.current.some((c) => c.scope === 'ORG_OPERATIONS' && c.source.startsWith(p.id));
    case 'CAT': return statements.some(onProduct);
    case 'FACT': return statements.some((s) => onProduct(s) && (s.fact_key ?? '').startsWith(p.pattern));
    case 'ADDON': return statements.some((s) => onProduct(s) && s.field === 'SUPPLEMENT' && likeToRegExp(p.pattern).test(s.text ?? ''));
    case 'OPT':
      return (!!row.variant?.option_name && (row.resolved_product ?? '').startsWith(p.id)
        && likeToRegExp(p.pattern).test(row.variant.option_name))
        || statements.some((s) => onProduct(s) && s.field === 'OPTION' && likeToRegExp(p.pattern).test(s.text ?? ''));
    case 'ORDER': return (row.order_state ?? '').startsWith('OBSERVED');
    default: return false; // IMG, C24: nothing reads them
  }
}

export function scoreNeed(t, row) {
  const matched = t.sets.filter((s) => s.status === 'AVAILABLE' && s.refs.every((r) => observed(r, row)));
  const suff = bestOf(matched.map((s) => s.suff)) ?? 'NONE';
  const retrieval = !t.reachable ? 'NOT_REACHABLE' : matched.length ? 'MATCHED' : 'MISSED';
  const bestAvail = bestOf(t.sets.filter((s) => s.status === 'AVAILABLE').map((s) => s.suff));
  const covered = suff === 'FULL' || suff === 'CONDITIONAL';
  const offered = [...row.memory, ...(row.precedent ? [row.precedent] : [])];
  const precedentHit = t.precedents.length ? offered.some((m) => t.precedents.some((g) => m.startsWith(g))) : null;
  let uncovered = null;
  if (!covered) {
    uncovered = (t.answerability === 'FULL' || t.answerability === 'CONDITIONAL') ? 'RETRIEVAL_MISS' : t.knowledgeGap;
  } else if (RANK[suff] < RANK[bestAvail]) {
    uncovered = null; // covered, just not at the best level the snapshot holds (e.g. CONDITIONAL where FULL exists)
  }
  return {
    q: t.q, need: t.need, retrieval, observedSufficiency: suff, covered, bestMatched: RANK[suff] === RANK[bestAvail],
    precedentHit, uncovered,
  };
}

export function scoreCase(c, needTruths, needScores, row, ds) {
  const action = SYSTEM_ACTION[row.basis];
  if (!action) throw new Error(`unknown basis ${row.basis} for ${row.q}`);
  const goldRefs = new Set(needTruths.flatMap((t) => t.sets.flatMap((s) => s.refs)));
  const cited = row.current.map((cur) => ({ ...cur, attributed: [...goldRefs].some((r) => {
    const p = parseRef(r);
    return (p.kind === 'PK' && cur.scope === 'PRODUCT' || p.kind === 'OK' && cur.scope === 'ORG_OPERATIONS') && cur.source.startsWith(p.id);
  }) }));
  let outcome;
  let prefill = null;
  if (action === 'ASK_SELLER') {
    outcome = c.nextStep === 'ANSWER' || c.nextStep === 'ASK_CUSTOMER' ? 'UNNECESSARY_ESCALATION'
      : c.nextStep === 'SYSTEM_ACQUIRE' && c.terminal !== 'ASK_SELLER' ? 'ESCALATION_BEFORE_ACQUIRE'
      : 'CORRECT_ESCALATION';
    const gold = needTruths.flatMap((t) => t.precedents);
    if (row.prefill_shown) prefill = gold.some((g) => row.precedent?.startsWith(g)) ? 'PREFILL_RIGHT' : 'PREFILL_WRONG';
    else prefill = gold.length ? 'PREFILL_MISSED' : 'NO_PREFILL_NEEDED';
  } else {
    const evidence = cited.length > 0 || row.catalogue?.grounds;
    const allCovered = needScores.every((n) => n.covered);
    const anyMatched = needScores.some((n) => n.observedSufficiency !== 'NONE');
    const needsClarify = needScores.some((n) => n.observedSufficiency === 'CONDITIONAL');
    if (!evidence) outcome = 'WRONG'; // no citation at all: conservatively unsafe
    else if (allCovered) {
      outcome = needsClarify ? (action === 'ASK_CUSTOMER' ? 'SAFE_CLARIFY' : 'UNDER_CLARIFY')
        : (action === 'ANSWER' ? 'SAFE_ANSWER' : 'OVER_CLARIFY');
    } else outcome = anyMatched ? 'PARTIAL_LEAK' : 'WRONG';
  }
  return { q: c.q, canonical: c.canonical, action, outcome, prefill, cited: cited.length,
    unattributed: cited.filter((x) => !x.attributed).length };
}

const pct = (n, d) => (d ? n / d : null);
const count = (xs, f) => xs.filter(f).length;
const dist = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});

export function score(ds, snapshot, rows) {
  const truth = deriveTruth(ds, snapshot);
  const byQ = new Map(rows.map((r) => [r.q, r]));
  const needScores = truth.needs.map((t) => scoreNeed(t, byQ.get(t.q)));
  const caseScores = truth.cases.map((c) => scoreCase(c, truth.needs.filter((t) => t.q === c.q),
    needScores.filter((n) => n.q === c.q), byQ.get(c.q), ds));
  const canon = new Set(truth.cases.filter((c) => c.canonical).map((c) => c.q));
  const N = truth.needs.filter((n) => canon.has(n.q));
  const NS = needScores.filter((n) => canon.has(n.q));
  const C = truth.cases.filter((c) => canon.has(c.q));
  const CS = caseScores.filter((c) => canon.has(c.q));
  const noAsk = CS.filter((c) => c.action !== 'ASK_SELLER');
  const safe = count(noAsk, (c) => c.outcome === 'SAFE_ANSWER' || c.outcome === 'SAFE_CLARIFY');
  const automatable = count(C, (c) => c.nextStep === 'ANSWER' || c.nextStep === 'ASK_CUSTOMER');
  const askedSeller = CS.filter((c) => c.action === 'ASK_SELLER');
  const reachable = NS.filter((n) => n.retrieval !== 'NOT_REACHABLE');
  const withPrecedent = NS.filter((n) => n.precedentHit !== null);
  const cited = CS.reduce((s, c) => s + c.cited, 0);
  const metrics = {
    counts: { canonical_cases: C.length, canonical_needs: N.length, raw_cases: truth.cases.length, raw_needs: truth.needs.length },
    knowledge: {
      need_source_state: dist(N, (n) => n.sourceState),
      source_coverage: pct(count(N, (n) => n.sourceState === 'AVAILABLE'), N.length),
      acquisition_adjusted_coverage: pct(count(N, (n) => n.sourceState === 'AVAILABLE' || n.sourceState === 'ACQUIRABLE'), N.length),
      need_answerability: dist(N, (n) => n.answerability),
      case_answerability: dist(C, (c) => c.answerability),
      need_terminal: dist(N, (n) => n.terminal),
      case_terminal: dist(C, (c) => c.terminal),
    },
    retrieval: {
      reachable_needs: reachable.length,
      retrieval_recall: pct(count(reachable, (n) => n.retrieval === 'MATCHED'), reachable.length),
      best_sufficiency_recall: pct(count(reachable, (n) => n.bestMatched), reachable.length),
      precedent_needs: withPrecedent.length,
      precedent_recall: pct(count(withPrecedent, (n) => n.precedentHit), withPrecedent.length),
      cited_passages: cited,
      unattributed_evidence_rate: pct(CS.reduce((s, c) => s + c.unattributed, 0), cited),
      prefill: dist(askedSeller, (c) => c.prefill),
    },
    decision: {
      outcomes: dist(CS, (c) => c.outcome),
      no_ask_cases: noAsk.length,
      strict_safe_no_ask_precision: pct(safe, noAsk.length),
      safe_automation_coverage: pct(safe, automatable),
      automatable_cases: automatable,
      partial_leak_rate: pct(count(noAsk, (c) => c.outcome === 'PARTIAL_LEAK'), noAsk.length),
      wrong_automation_rate: pct(count(noAsk, (c) => c.outcome === 'WRONG'), noAsk.length),
      under_clarify: count(CS, (c) => c.outcome === 'UNDER_CLARIFY'),
      over_clarification: count(CS, (c) => c.outcome === 'OVER_CLARIFY'),
      unnecessary_seller_escalation: count(CS, (c) => c.outcome === 'UNNECESSARY_ESCALATION'),
      unnecessary_seller_escalation_rate: pct(count(CS, (c) => c.outcome === 'UNNECESSARY_ESCALATION'), askedSeller.length),
    },
    product: {
      truth_next_step: dist(C, (c) => c.nextStep),
      observed_action: dist(CS, (c) => c.action),
      observed_seller_touch: pct(askedSeller.length, C.length),
      terminal_seller_touch_requirement: pct(count(C, (c) => c.terminal === 'ASK_SELLER'), C.length),
      seller_ask_reason_needs: dist(N.filter((n) => n.terminal === 'ASK_SELLER'), (n) => n.terminalReason),
    },
    failure: failureTaxonomy(N, NS, CS),
  };
  return { truth, needScores, caseScores, metrics };
}

/** Each bottleneck with the needs and cases it touches (canonical). One need may carry one knowledge/retrieval
 *  reason; the two decision failures are case-level. */
export function failureTaxonomy(N, NS, CS) {
  const out = {};
  const add = (k, need, q) => {
    out[k] ??= { needs: 0, cases: new Set() };
    if (need) out[k].needs += 1;
    out[k].cases.add(q);
  };
  for (const s of NS) if (s.uncovered) add(s.uncovered, true, s.q);
  for (const c of CS) {
    if (['PARTIAL_LEAK', 'WRONG', 'UNDER_CLARIFY', 'OVER_CLARIFY'].includes(c.outcome)) add('SUFFICIENCY_JUDGMENT_FAILURE', false, c.q);
    if (c.outcome === 'UNNECESSARY_ESCALATION') add('OVER_ESCALATION', false, c.q);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { needs: v.needs, cases: v.cases.size }]));
}

/** Two runs on the same snapshot: what moved, need by need and case by case. */
export function compare(base, run) {
  const bn = new Map(base.needScores.map((n) => [`${n.q}.${n.need}`, n]));
  const bc = new Map(base.caseScores.map((c) => [c.q, c]));
  const canon = new Set(run.truth.cases.filter((c) => c.canonical).map((c) => c.q));
  const needs = run.needScores.filter((n) => canon.has(n.q));
  const cases = run.caseScores.filter((c) => canon.has(c.q));
  const needChanged = needs.filter((n) => {
    const b = bn.get(`${n.q}.${n.need}`);
    return b.retrieval !== n.retrieval || b.observedSufficiency !== n.observedSufficiency || b.precedentHit !== n.precedentHit;
  });
  const caseChanged = cases.filter((c) => bc.get(c.q).outcome !== c.outcome || bc.get(c.q).action !== c.action);
  const retrievalGained = needs.filter((n) => bn.get(`${n.q}.${n.need}`).retrieval === 'MISSED' && n.retrieval === 'MATCHED');
  const retrievalLost = needs.filter((n) => bn.get(`${n.q}.${n.need}`).retrieval === 'MATCHED' && n.retrieval === 'MISSED');
  const precedentGained = needs.filter((n) => bn.get(`${n.q}.${n.need}`).precedentHit === false && n.precedentHit === true);
  const precedentLost = needs.filter((n) => bn.get(`${n.q}.${n.need}`).precedentHit === true && n.precedentHit === false);
  const unsafe = new Set(['PARTIAL_LEAK', 'WRONG', 'UNDER_CLARIFY']);
  const newUnsafe = cases.filter((c) => unsafe.has(c.outcome) && !unsafe.has(bc.get(c.q).outcome));
  const fixedUnsafe = cases.filter((c) => !unsafe.has(c.outcome) && unsafe.has(bc.get(c.q).outcome));
  const ids = (xs) => xs.map((x) => (x.need ? `${x.q}.${x.need}` : x.q));
  return {
    need_change_rate: pct(needChanged.length, needs.length),
    case_change_rate: pct(caseChanged.length, cases.length),
    case_changes: caseChanged.map((c) => `${c.q}: ${bc.get(c.q).outcome} → ${c.outcome}`),
    retrieval_gained: ids(retrievalGained), retrieval_lost: ids(retrievalLost),
    precedent_gained: ids(precedentGained), precedent_lost: ids(precedentLost),
    new_unsafe_no_ask: ids(newUnsafe), fixed_unsafe_no_ask: ids(fixedUnsafe),
  };
}

function args() {
  const a = {};
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const ds = loadDataset(a.dataset);
  const snapshot = JSON.parse(readFileSync(a.snapshot, 'utf8'));
  if (snapshot.dataset_hash !== ds.hash) throw new Error(`snapshot was censused for dataset ${snapshot.dataset_hash}, not ${ds.hash}`);
  const run = score(ds, snapshot, readJsonl(a.obs));
  const out = { dataset_hash: ds.hash, snapshot: snapshot.snapshot, state_hash: snapshot.state_hash, obs: a.obs, metrics: run.metrics };
  if (a.baseline) out.versus_baseline = compare(score(ds, snapshot, readJsonl(a.baseline)), run);
  if (a.json) writeFileSync(a.json, JSON.stringify({ ...out, needs: run.needScores, cases: run.caseScores, truth: run.truth }, null, 1));
  console.log(JSON.stringify(out, null, 1));
}
