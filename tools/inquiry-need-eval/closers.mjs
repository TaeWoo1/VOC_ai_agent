#!/usr/bin/env node
// Closing-authority semantics, offline (Inquiry v3 WP-3.1). No model, no network, no marketplace.
//
// WHY THIS EXISTS. WP-3's closing contract says exactly one authority may close a need, and that a PRECONDITION is
// written before its closer. Together those two rules make the LAST STEP WRITTEN the closer — and the model has a
// stable habit about where it writes SELLER. In WP-2's 201 calls, SELLER appeared beside another authority 49 times
// and was the last step written 49 of 49. Under v2 that habit was cosmetic, because both steps could close. Under v3
// it decides which authority answers the customer.
//
// So the question this tool asks is not "was the right authority in the plan" — the WP-2 headline of 1.000 answered
// that, and answered it for plans that named the right authority AND the seller as co-closers. It is:
//
//     WHO CLOSES, and when the seller closes, WHY IS THE SELLER THERE?
//
// The taxonomy (§3 of the brief), applied per gold goal against the needs assigned to it by goals.mjs:
//
//   A_GENUINE_MULTI_AUTHORITY  the gold says the seller closes, and a non-seller authority is read first.
//                              KNOWLEDGE(policy) PRECONDITION -> SELLER(exception judgment) CLOSES.
//   B_OPERATIONAL_FALLBACK     the gold says something else closes, that authority IS in the plan, and the seller was
//                              appended anyway and took the ending. "Knowledge will answer, and if not, the seller."
//   B_SELLER_SUBSTITUTED       the same, except the right authority is not in the plan at all although it could act
//                              here. The seller did not take the ending from it; it replaced it.
//   C_CAPABILITY_GAP_FALLBACK  the authority the gold requires CANNOT act on this snapshot, and the seller was put in
//                              its place. This is the one the architecture already has an answer for and the plan must
//                              not express: it is a ResolutionState.CAPABILITY_GAP the runtime records, not an
//                              authority the planner chooses.
//   D_TRUE_SELLER_ONLY         the gold says the seller closes and nothing else is needed.
//
// and, for the WP-2 shape only, WP2_AMBIGUOUS_CO_CLOSER: the right authority and the seller BOTH marked CLOSES. That
// shape is why the old recall was 1.000. It is not a category of seller use — it is a plan that names two endings and
// says nothing about which one is the answer.
//
//   node tools/inquiry-need-eval/closers.mjs --obs <run.jsonl> --gold <plans.jsonl> [--project] [--rep N] [--json out]
//
// --project reads a v2-shaped recorded run through contract.mjs's projection, which is an ESTIMATE of what the model
// would have written had the retired slots never been offered. It cannot invent a step the model did not write, and
// it does not change any role. Roles are what this tool reads, so the projection is neutral for this measurement —
// stated here rather than assumed.
import { realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readJsonl } from './io.mjs';
import { index, project } from './contract.mjs';
import { assign, authorityOf, facts, loadVocabulary } from './goals.mjs';

const inc = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const sorted = (s) => [...s].sort();

/** The authorities a set of needs says may end the goal, and the ones it merely reads. */
function roles(needs, ix) {
  const closes = new Set();
  const reads = new Set();
  for (const n of needs) {
    n.closingAuthorities.forEach((a) => closes.add(a));
    for (const s of n.raw.steps ?? []) {
      const a = ix.get(s.capability);
      if (!n.closingAuthorities.has(a)) reads.add(a);
    }
  }
  return { closes, reads };
}

/**
 * Could the authority the gold requires have acted here? Read from the snapshot the row carries (WP-3.1), never
 * guessed. Without a registry block the question is unanswerable and the tool says so rather than defaulting to
 * "available", which would silently reclassify every C as a B.
 */
function goldAuthorityCanAct(goal, registry) {
  if (!registry) return null;
  const caps = [...goal.closingCapabilities];
  if (!caps.length) return null;
  return caps.every((c) => registry.capabilities[c] === 'AVAILABLE');
}

export function classify(rows, gold, { rep = 1, projected = false } = {}) {
  const vocab = loadVocabulary();
  const ix = authorityOf(vocab);
  const cIx = index(vocab);
  const goldByCase = new Map();
  for (const g of gold.filter((r) => r.status === 'FROZEN')) {
    goldByCase.set(g.q, [...(goldByCase.get(g.q) ?? []), g]);
  }
  const out = {
    goals: 0, answered_goals: 0, taxonomy: {}, closer: { correct: 0, wrong: 0, absent: 0 },
    seller_goals: 0, seller_last_written: 0, seller_beside_another_authority: 0,
    detail: [], by_gold_closer: {},
  };
  const byCase = new Map(rows.filter((r) => r.rep === rep).map((r) => [r.q, r]));

  for (const [q, goalRows] of goldByCase) {
    const row = byCase.get(q);
    const goals = goalRows.map((r) => ({ ...facts(r, ix), row: r }));
    out.goals += goals.length;
    let plan = row?.plan;
    if (plan && projected) plan = project(plan, cIx).plan;
    if (!plan?.needs?.length) {
      goals.forEach((g) => {
        inc(out.taxonomy, 'NO_PLAN');
        inc(out.by_gold_closer, `${[...g.closingAuthorities][0]}/NO_PLAN`);
      });
      continue;
    }
    const needs = plan.needs.map((n) => ({ ...facts(n, ix), raw: n }));
    const { assignment } = assign(needs, goals);
    // Needs the assignment could not place. A need whose only authority is SELLER shares nothing with a knowledge or
    // entity goal, so it can never be assigned to one — which means "the seller was put in the missing authority's
    // place" is invisible from inside the assignment and has to be read from what is left over.
    const leftoverSellerClosers = needs.filter((n, ni) => assignment[ni] === -1 && n.closingAuthorities.has('SELLER'));

    goals.forEach((g, gi) => {
      const mine = assignment.map((a, ni) => (a === gi ? needs[ni] : null)).filter(Boolean);
      const goldCloser = [...g.closingAuthorities][0];
      if (!mine.length) {
        const canActHere = goldAuthorityCanAct(g, row.registry);
        const kind = !leftoverSellerClosers.length ? 'GOAL_NOT_PLANNED'
          : canActHere === false ? 'C_CAPABILITY_GAP_FALLBACK' : 'B_SELLER_SUBSTITUTED';
        inc(out.taxonomy, kind);
        inc(out.by_gold_closer, `${goldCloser}/${kind}`);
        if (kind !== 'GOAL_NOT_PLANNED') {
          out.closer.wrong++;
          out.detail.push({
            goal: `${g.row.q}.${g.row.goal}`, kind, gold_closer: goldCloser,
            gold_capabilities: sorted(g.capabilities), predicted_closes: ['SELLER'], predicted_reads: [],
            seller_last_written: true, gold_authority_can_act: canActHere,
            shape: leftoverSellerClosers.map((n) => (n.raw.steps ?? [])
              .map((s) => `${s.capability}/${s.role}`).join(' > ')),
          });
        }
        return;
      }
      out.answered_goals++;
      const { closes, reads } = roles(mine, ix);
      const sellerPresent = closes.has('SELLER') || reads.has('SELLER');
      const canAct = goldAuthorityCanAct(g, row.registry);

      // where SELLER stands in the written order — the mechanism, measured rather than asserted
      let lastWritten = null;
      for (const n of mine) {
        const steps = n.raw.steps ?? [];
        if (steps.length) lastWritten = ix.get(steps[steps.length - 1].capability);
      }
      if (sellerPresent) {
        out.seller_goals++;
        const withOther = mine.some((n) => (n.raw.steps ?? []).length > 1
          && (n.raw.steps ?? []).some((s) => ix.get(s.capability) === 'SELLER')
          && (n.raw.steps ?? []).some((s) => ix.get(s.capability) !== 'SELLER'));
        if (withOther) {
          out.seller_beside_another_authority++;
          if (lastWritten === 'SELLER') out.seller_last_written++;
        }
      }

      // Two closers ACROSS needs is a split, which this scorer tolerates by design; two closers INSIDE one need is the
      // v2 shape that names two endings, and it is what the v3 contract made inexpressible.
      const ambiguous = mine.some((n) => n.ambiguous);

      let kind;
      if (ambiguous) {
        kind = closes.has('SELLER') && closes.has(goldCloser) && goldCloser !== 'SELLER'
          ? 'WP2_AMBIGUOUS_CO_CLOSER' : 'AMBIGUOUS_CLOSER_OTHER';
      } else if (!closes.size) {
        kind = 'NO_CLOSER';
      } else if (closes.has(goldCloser)) {
        kind = goldCloser === 'SELLER'
          ? (reads.size || mine.some((n) => (n.raw.steps ?? []).length > 1)
            ? 'A_GENUINE_MULTI_AUTHORITY' : 'D_TRUE_SELLER_ONLY')
          : (mine.length > 1 ? 'CORRECT_CLOSER_VIA_SPLIT' : 'CORRECT_CLOSER');
      } else if (closes.has('SELLER')) {
        if (reads.has(goldCloser)) kind = 'B_OPERATIONAL_FALLBACK';
        else if (canAct === false) kind = 'C_CAPABILITY_GAP_FALLBACK';
        else kind = 'B_SELLER_SUBSTITUTED';
      } else {
        kind = 'WRONG_CLOSER_NON_SELLER';
      }

      inc(out.taxonomy, kind);
      inc(out.by_gold_closer, `${goldCloser}/${kind}`);
      const correct = kind === 'CORRECT_CLOSER' || kind === 'CORRECT_CLOSER_VIA_SPLIT'
        || kind === 'A_GENUINE_MULTI_AUTHORITY' || kind === 'D_TRUE_SELLER_ONLY';
      if (correct) out.closer.correct++;
      else if (kind === 'NO_CLOSER') out.closer.absent++;
      else out.closer.wrong++;

      out.detail.push({
        goal: `${g.row.q}.${g.row.goal}`, kind,
        gold_closer: goldCloser, gold_capabilities: sorted(g.capabilities),
        predicted_closes: sorted(closes), predicted_reads: sorted(reads),
        seller_last_written: lastWritten === 'SELLER',
        gold_authority_can_act: canAct,
        shape: mine.map((n) => (n.raw.steps ?? []).map((s) => `${s.capability}/${s.role}`).join(' > ')),
      });
    });
  }
  return out;
}

function main(argv) {
  const arg = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
  const report = classify(readJsonl(arg('--obs')), readJsonl(arg('--gold')), {
    rep: Number(arg('--rep') ?? 1), projected: argv.includes('--project'),
  });
  const text = JSON.stringify(report, null, 1);
  if (arg('--json')) writeFileSync(arg('--json'), text + '\n');
  console.log(JSON.stringify({ ...report, detail: `${report.detail.length} goals (see --json)` }, null, 1));
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
