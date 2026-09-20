#!/usr/bin/env node
// Split-tolerant resolution-goal scoring (Inquiry v3 WP-3). Offline; no model; no LLM judge.
//
// WHY THIS EXISTS. The WP-2 scorer lined a predicted plan up with the gold BY POSITION: gold need i was compared with
// predicted need i. That is only meaningful when both split the customer's message the same way, and the 201-call shadow
// split it differently in 27 of 67 cases — always by splitting further, never by merging. So its headline numbers were
// read off 43 cases and quietly mis-aligned the rest, and the honest part of that report was the caveat rather than the
// figure.
//
// WHAT REPLACES IT. The unit of evaluation is a RESOLUTION GOAL — one thing the customer needs resolved — and the
// question is "was every goal planned", not "was the message cut into the same pieces". A planner that splits one gold
// goal into two atomic needs has not made a mistake, so many predicted needs may serve one goal.
//
// WHAT KEEPS THAT FROM BEING FREE. Each predicted need is assigned to AT MOST ONE goal. Merging is therefore not
// tolerated: a planner that answers two distinct gold goals with a single need can have that need counted for only one
// of them, and the other is reported as uncovered. Assignment is an exhaustive search over a tiny space (≤6 needs, ≤3
// goals) resolved by a fixed lexicographic objective, so it is deterministic — no judge, no embedding, no text.
//
// WHAT IT CANNOT DO, STATED. Compatibility is judged on capabilities, which is all a plan carries. Where one case has
// two goals whose gold plans name the same capabilities, this scorer cannot tell them apart, and coverage there is a
// claim about COUNT and not about identity. `goals_indistinguishable` reports exactly how many goals are in that
// position (4 of 72 in v3.1, in 2 of 67 cases) so the figure is never read as more than it is.
//
//   node tools/inquiry-need-eval/goals.mjs --gold <plans.jsonl> --obs <run.jsonl> [--json out.json]
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonl } from './io.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const VOCAB_PATH = join(here, '../../contracts/inquiry-authority/v1/vocabulary.json');
export const loadVocabulary = (p = VOCAB_PATH) => JSON.parse(readFileSync(p, 'utf8'));

export const authorityOf = (vocab) => new Map(vocab.capabilities.map((c) => [c.id, c.authority]));
/** Capabilities that are about more than one kind of instance — the only ones whose scope a plan can get wrong. */
const scopeChoices = (vocab) => new Map(Object.entries(vocab.scope_by_capability).map(([c, v]) => [c, v.length]));
const byCase = (rows, k = 'q') => rows.reduce((m, r) => m.set(r[k], [...(m.get(r[k]) ?? []), r]), new Map());
const set = (xs) => new Set(xs.filter((x) => x !== undefined && x !== null));
const sorted = (s) => [...s].sort();

/**
 * Who resolves this need, and how we know.
 *
 * WP-3.1 onwards a need DECLARES `closing_authority`, so there is one answer and it cannot be two. Older gold and
 * older recorded runs said it with step roles, and this scorer still reads them — the WP-2 comparison in
 * docs/inquiry_architecture_v3_wp31.md §6 depends on scoring both representations with one scorer. `declared` says
 * which representation was read, and `ambiguous` can only ever be true of the older one: a plan that marked two
 * different authorities CLOSES offered two endings and said nothing about which was the answer.
 */
function closingOf(row, ix) {
  if (row.closing_authority) {
    return { closingAuthorities: new Set([row.closing_authority]), declared: true, ambiguous: false };
  }
  const closers = set((row.steps ?? []).filter((s) => s.role === 'CLOSES').map((s) => ix.get(s.capability)));
  return { closingAuthorities: closers, declared: false, ambiguous: closers.size > 1 };
}

/** Everything about one side of the comparison that the matcher is allowed to look at. */
export function facts(row, ix) {
  const steps = row.steps ?? [];
  const { closingAuthorities, declared, ambiguous } = closingOf(row, ix);
  return {
    capabilities: set(steps.map((s) => s.capability)),
    closingCapabilities: set(steps.filter((s) => closingAuthorities.has(ix.get(s.capability)))
      .map((s) => s.capability)),
    closingAuthorities,
    declared,
    ambiguous,
    authorities: set(steps.map((s) => ix.get(s.capability))),
    // execution order. Under WP-3.1 a step has no role, so the sequence is the capabilities in the order written.
    sequence: steps.map((s) => (s.role ? `${s.capability}/${s.role}` : s.capability)).join('>'),
    entitySteps: steps.filter((s) => Array.isArray(s.fields)),
    // every required step, kept whole — capability AND the instance it is about
    steps: steps.map((s) => ({ capability: s.capability, scope: s.scope ?? null })),
  };
}

/**
 * A predicted need may serve a goal only if it names at least one of the goal's AUTHORITIES. Authority is the unit this
 * architecture is about, so a need that answers a catalogue question with the product's spec has still reached for the
 * right kind of answer and is scored as a capability mismatch inside a covered goal — not as if the goal had gone
 * unplanned. What compatibility does rule out is parking a knowledge need on an order goal to keep it out of the
 * "extra" column: the authorities must actually meet.
 */
const compatible = (need, goal) => [...need.authorities].some((a) => goal.authorities.has(a));

/** How much of the goal's own capability list a need names — the tie-break that keeps two same-authority goals apart. */
const overlap = (need, goal) => [...need.capabilities].filter((c) => goal.capabilities.has(c)).length;

function coverage(goal, assigned) {
  const closing = new Set();
  const all = new Set();
  for (const n of assigned) {
    n.closingAuthorities.forEach((a) => closing.add(a));
    n.authorities.forEach((a) => all.add(a));
  }
  const missing = [...goal.closingAuthorities].filter((a) => !closing.has(a));
  const unnecessary = [...all].filter((a) => !goal.authorities.has(a));
  return { covered: assigned.length > 0 && missing.length === 0, missing, unnecessary, assigned };
}

/**
 * The assignment: every predicted need goes to one compatible goal or to nothing. Chosen by a fixed lexicographic
 * objective — most goals covered, then fewest needs left over, then fewest unnecessary authorities, then the
 * lexicographically smallest assignment so two equally good answers always resolve the same way.
 */
export function assign(needs, goals) {
  const options = needs.map((n) => [...goals.keys()].filter((g) => compatible(n, goals[g])).concat([-1]));
  let best = null;
  const pick = (i, acc) => {
    if (i === needs.length) {
      const buckets = goals.map((g, gi) => coverage(g, acc.map((a, ni) => (a === gi ? needs[ni] : null))
        .filter(Boolean)));
      const score = [
        -buckets.filter((b) => b.covered).length,
        -acc.reduce((s, a, ni) => s + (a >= 0 ? overlap(needs[ni], goals[a]) : 0), 0),
        acc.filter((a) => a === -1).length,
        buckets.reduce((s, b) => s + b.unnecessary.length, 0),
        acc.join(','),
      ];
      if (!best || cmp(score, best.score) < 0) best = { score, assignment: [...acc], buckets };
      return;
    }
    for (const g of options[i]) pick(i + 1, [...acc, g]);
  };
  pick(0, []);
  return best ?? { score: [0, 0, 0, 0, ''], assignment: [], buckets: goals.map((g) => coverage(g, [])) };
}

function cmp(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * Score predicted plans (one per case: `{q, needs:[{steps, customer_inputs}]}`) against the frozen goal gold.
 * `forbiddenInputs` is the identity set — asking for one is a safety failure, counted on its own and never averaged in.
 */
export function scoreGoals(plans, gold, vocab = loadVocabulary()) {
  const ix = authorityOf(vocab);
  const goldByCase = byCase(gold.filter((r) => r.status === 'FROZEN'));
  const predByCase = new Map(plans.map((p) => [p.q, p]));
  const forbidden = new Set(vocab.customer_inputs.filter((i) => i.kind === 'IDENTITY').map((i) => i.id));
  const out = {
    cases: 0, goals: 0, unplanned_case: 0,
    goal_covered: 0, uncovered: [], uncovered_due_to_merge: 0, wrong_authority: [], capability_mismatch: [],
    required_authority_recall: 0, unnecessary_authority_goals: 0, order_misses: [], procedure_for_read: [],
    // WP-3.1 headline: presence and closing are different claims, and only the second is what the customer gets.
    required_authority_present: 0, correct_closer: 0, wrong_closer: [], ambiguous_closer: [],
    fallback_authority_inserted: [], seller_only_extra_needs: 0,
    envelope_failures: {}, answered_cases: 0,
    planner_only_extra_needs: 0, goals_split: 0, split_histogram: {},
    sequence_compared: 0, sequence_correct: 0, sequence_incomparable: 0,
    entity_compared: 0, entity_correct: 0, entity_over_read: 0, entity_under_read: 0, over_read_fields: {},
    inputs: {
      goals_compared: 0, exact: 0, over: 0, under: 0, required_recall: 0, required_total: 0,
      unnecessary_total: 0, forbidden: 0, over_by_type: {}, under_by_type: {},
    },
    goals_indistinguishable: 0,
    /**
     * WP-3.2. The capability comparison above answers "did the plan reach for the right KIND of answer". It does not
     * answer "about which instance", and the Candidate C smoke showed why that matters: C3 and C7 both chose
     * KNOWLEDGE.CATALOGUE/THIS_LISTING where the gold says SELLER_CATALOGUE — the seller's whole range asked of one
     * listing. `capability_mismatch` reported 0, correctly and uselessly.
     *
     * `scope_decidable` is the honest denominator: only a capability that is about more than one kind of instance can
     * have its scope got wrong, and in this vocabulary that is KNOWLEDGE.CATALOGUE alone. A scope rate quoted over
     * every step would be mostly made of steps that had no choice to make.
     */
    scope: {
      steps_compared: 0, capability_present: 0, capability_missing: 0, capability_extra: 0,
      scope_decidable: 0, scope_correct: 0, scope_wrong: 0, wrong_scope_detail: [],
      unavailable_but_correct: 0,
    },
  };
  const id = (r) => `${r.q}.${r.goal ?? r.need}`;
  for (const [q, rows] of goldByCase) {
    out.cases++;
    out.goals += rows.length;
    const goals = rows.map((r) => ({ ...facts(r, ix), row: r }));
    // goals this scorer provably cannot tell apart: same capability multiset, same asked inputs
    const signature = (g) => sorted(g.capabilities).join('+') + '|' + sorted(new Set(g.row.customer_inputs ?? [])).join('+');
    const seen = new Map();
    goals.forEach((g) => seen.set(signature(g), (seen.get(signature(g)) ?? 0) + 1));
    out.goals_indistinguishable += goals.filter((g) => seen.get(signature(g)) > 1).length;

    const pred = predByCase.get(q);
    if (!pred || !pred.needs?.length) {
      out.unplanned_case++;
      // An envelope that never produced an answer and a planner that planned the wrong thing are different failures.
      // Folding them together reads a truncation as a semantic miss, which is how four cut-off answers arrived in the
      // WP-4 report inside `goal_coverage` (WP-3.1 §1).
      const why = pred?.failure ? `NO_ANSWER:${pred.failure}` : 'NO_PLAN';
      if (pred?.failure) out.envelope_failures[pred.failure] = (out.envelope_failures[pred.failure] ?? 0) + 1;
      rows.forEach((r) => out.uncovered.push({ goal: id(r), why }));
      continue;
    }
    out.answered_cases++;
    const needs = pred.needs.map((n) => ({ ...facts(n, ix), inputs: set(n.customer_inputs ?? []), raw: n }));
    const { assignment, buckets } = assign(needs, goals);
    out.planner_only_extra_needs += assignment.filter((a) => a === -1).length;
    // A need the assignment could not place, whose ending is the seller. It cannot show up as a demoted authority
    // because it shares no authority with any goal — it did not take the ending from the right authority, it stands
    // where that authority is absent. Counted here so that substituting the seller for a capability the snapshot
    // cannot offer is visible as something, rather than only as a goal nobody planned (WP-3.1 §4).
    out.seller_only_extra_needs += assignment
      .filter((a, ni) => a === -1 && needs[ni].closingAuthorities.has('SELLER')).length;

    goals.forEach((g, gi) => {
      const b = buckets[gi];
      const id = `${g.row.q}.${g.row.goal ?? g.row.need}`;
      const mine = assignment.map((a, ni) => (a === gi ? needs[ni] : null)).filter(Boolean);
      if (b.covered) out.goal_covered++;
      if (b.missing.length === 0 && mine.length) out.required_authority_recall++;
      if (mine.length) {
        // PRESENCE: the gold's closing authority appears somewhere in the plan, in any role. This is the claim the
        // WP-2 headline of 1.000 actually made — a plan naming KNOWLEDGE(CLOSES) and SELLER(CLOSES) satisfied it, and
        // so does a plan that demotes KNOWLEDGE to PRECONDITION and lets SELLER close. It is reported so the gap
        // between it and `correct_closer` is visible instead of being the difference between two reports.
        const anywhere = new Set(mine.flatMap((n) => [...n.authorities]));
        if ([...g.closingAuthorities].every((a) => anywhere.has(a))) out.required_authority_present++;
        // AMBIGUITY IS WITHIN A NEED. One need naming two closing authorities offers two endings and says nothing
        // about which is the answer; a goal SPLIT across needs legitimately has a different ending in each, which is
        // what split-tolerance means. The v3 contract makes the first inexpressible — so this counter is 0 on any v3
        // run by construction, and it is kept because it is the whole of the WP-2 overestimate (WP-3.1 §6).
        const ambiguous = mine.some((n) => n.ambiguous);
        const closedBy = sorted(new Set(mine.flatMap((n) => [...n.closingAuthorities])));
        const demoted = [...g.closingAuthorities].every((a) => anywhere.has(a));
        if (ambiguous) {
          out.ambiguous_closer.push({ goal: id, expected: [...g.closingAuthorities], closed_by: closedBy });
        } else if (b.missing.length === 0) {
          out.correct_closer++;
        } else {
          out.wrong_closer.push({ goal: id, expected: [...g.closingAuthorities], closed_by: closedBy, demoted });
        }
        // A seller ending on a goal the gold does not end with the seller: the fallback this contract must not express.
        if (!g.closingAuthorities.has('SELLER')
            && mine.some((n) => n.closingAuthorities.has('SELLER'))) {
          out.fallback_authority_inserted.push(id);
        }
      }
      else if (!mine.length) {
        // was there a compatible need that another goal took? then a merge cost us this goal
        const taken = needs.some((n) => compatible(n, g));
        if (taken) out.uncovered_due_to_merge++;
        out.uncovered.push({ goal: id, why: taken ? 'MERGED_INTO_ANOTHER_GOAL' : 'NOT_PLANNED' });
      } else {
        out.wrong_authority.push({ goal: id, missing: b.missing, got: sorted(new Set(mine.flatMap((n) => [...n.closingAuthorities]))) });
      }
      if (b.unnecessary.length) out.unnecessary_authority_goals++;
      if (mine.length) {
        const got = new Set(mine.flatMap((n) => [...n.closingCapabilities]));
        const missing = [...g.closingCapabilities].filter((c) => !got.has(c));
        if (missing.length) out.capability_mismatch.push({ goal: id, expected: missing, got: sorted(got) });
      }
      if (g.capabilities.has('ENTITY.ORDER') && !mine.some((n) => n.capabilities.has('ENTITY.ORDER'))) {
        out.order_misses.push(id);
      }
      if (!g.authorities.has('PROCEDURE') && mine.some((n) => n.authorities.has('PROCEDURE'))) {
        out.procedure_for_read.push(id);
      }
      if (mine.length > 1) {
        out.goals_split++;
        out.split_histogram[mine.length] = (out.split_histogram[mine.length] ?? 0) + 1;
      }
      // sequence: only where the gold's goal takes more than one acting step
      if (g.sequence.includes('>')) {
        if (mine.length === 1) {
          out.sequence_compared++;
          if (mine[0].sequence === g.sequence) out.sequence_correct++;
        } else {
          // a multi-step goal the planner split across needs has no single sequence to compare
          out.sequence_incomparable++;
        }
      }
      // entity + scope: for each gold entity step, the assigned need's step on the same capability
      for (const gs of g.entitySteps) {
        const ps = mine.flatMap((n) => n.entitySteps).find((s) => s.capability === gs.capability);
        if (!ps) continue;
        out.entity_compared++;
        const want = new Set(gs.fields ?? []);
        const got = new Set(ps.fields ?? []);
        const extra = [...got].filter((f) => !want.has(f));
        const missing = [...want].filter((f) => !got.has(f));
        if (!extra.length && !missing.length) out.entity_correct++;
        if (extra.length) out.entity_over_read++;
        if (missing.length) out.entity_under_read++;
        for (const f of extra) out.over_read_fields[f] = (out.over_read_fields[f] ?? 0) + 1;
      }
      if (mine.length) scope(out.scope, g, mine, vocab, pred.registry);
      if (mine.length) inputs(out.inputs, new Set(g.row.customer_inputs ?? []),
        new Set(mine.flatMap((n) => [...n.inputs])), forbidden);
    });
  }
  const rate = (x, d) => (d ? x / d : null);
  const scored = out.goals;
  return {
    ...out,
    goal_coverage: rate(out.goal_covered, scored),
    required_authority_recall_rate: rate(out.required_authority_recall, scored),
    // WP-3.1 headline (docs/inquiry_architecture_v3_wp31.md §6). `authority_presence_rate` is deliberately reported
    // beside `correct_closer_rate`: the first is the old claim, the second is the one the customer experiences, and
    // the distance between them is the size of the overestimate.
    authority_presence_rate: rate(out.required_authority_present, scored),
    correct_closer_rate: rate(out.correct_closer, scored),
    wrong_closer_rate: rate(out.wrong_closer.length, scored),
    ambiguous_closer_rate: rate(out.ambiguous_closer.length, scored),
    correct_closer_rate_of_answered: rate(out.correct_closer,
      out.correct_closer + out.wrong_closer.length + out.ambiguous_closer.length),
    sequence_correct_rate: rate(out.sequence_correct, out.sequence_compared),
    entity_scope_accuracy: rate(out.entity_correct, out.entity_compared),
    scope: {
      ...out.scope,
      capability_accuracy: rate(out.scope.capability_present, out.scope.steps_compared),
      scope_accuracy: rate(out.scope.scope_correct, out.scope.scope_decidable),
    },
    inputs: {
      ...out.inputs,
      exact_rate: rate(out.inputs.exact, out.inputs.goals_compared),
      over_rate: rate(out.inputs.over, out.inputs.goals_compared),
      under_rate: rate(out.inputs.under, out.inputs.goals_compared),
      required_recall_rate: rate(out.inputs.required_recall, out.inputs.required_total),
      unnecessary_rate: rate(out.inputs.unnecessary_total, out.inputs.goals_compared),
      forbidden_rate: rate(out.inputs.forbidden, out.inputs.goals_compared),
    },
  };
}

/**
 * Capability AND instance, compared step by step (WP-3.2 §3). A predicted step matches a gold step when the capability
 * is the same; the scope is then a separate verdict, so "right capability, wrong instance" is its own number rather
 * than a silent pass.
 */
function scope(acc, goal, needs, vocab, registry) {
  const choices = scopeChoices(vocab);
  const predicted = needs.flatMap((n) => n.steps);
  const used = new Set();
  for (const want of goal.steps) {
    acc.steps_compared++;
    // Prefer a step that matches capability AND instance before one that matches only the capability. A plan may
    // name the same capability about two instances (the C7 answer did: this listing in one need, the seller's range
    // in another), and comparing against whichever came first would report a wrong scope for a plan that contains
    // the right one. The extra read is still counted, by capability_extra.
    const exact = predicted.findIndex((p, k) => !used.has(k) && p.capability === want.capability
      && p.scope === want.scope);
    const i = exact >= 0 ? exact
      : predicted.findIndex((p, k) => !used.has(k) && p.capability === want.capability);
    if (i < 0) {
      acc.capability_missing++;
      continue;
    }
    used.add(i);
    acc.capability_present++;
    // the plan reached for exactly the right thing and this deployment cannot act on it — a gap, not a planning error
    if (registry && predicted[i].scope === want.scope
        && registry.capabilities?.[want.capability] !== 'AVAILABLE') {
      acc.unavailable_but_correct++;
    }
    if ((choices.get(want.capability) ?? 1) > 1) {
      acc.scope_decidable++;
      if (predicted[i].scope === want.scope) {
        acc.scope_correct++;
      } else {
        acc.scope_wrong++;
        acc.wrong_scope_detail.push({ goal: `${goal.row.q}.${goal.row.goal ?? goal.row.need}`,
          capability: want.capability, expected: want.scope, got: predicted[i].scope });
      }
    }
  }
  acc.capability_extra += predicted.length - used.size;
}

/**
 * Customer-input quality for one goal (WP-3 §5). Four independent questions, deliberately not averaged into one score:
 * did the plan ask for everything the answer depends on (recall), did it ask for anything it did not need, did it match
 * exactly, and did it ask for identity — which is a safety failure and not a quality one.
 */
function inputs(acc, want, got, forbidden) {
  acc.goals_compared++;
  acc.required_total += want.size;
  for (const w of want) if (got.has(w)) acc.required_recall++;
  const extra = [...got].filter((g) => !want.has(g));
  const missing = [...want].filter((w) => !got.has(w));
  acc.unnecessary_total += extra.length;
  for (const e of extra) {
    acc.over_by_type[e] = (acc.over_by_type[e] ?? 0) + 1;
    if (forbidden.has(e)) acc.forbidden++;
  }
  for (const m of missing) acc.under_by_type[m] = (acc.under_by_type[m] ?? 0) + 1;
  if (!extra.length && !missing.length) acc.exact++;
  else if (extra.length && !missing.length) acc.over++;
  else if (!extra.length && missing.length) acc.under++;
  else { acc.over++; acc.under++; }
}

/** Observation rows (the harness's `plan` column) → one predicted plan per case, for a chosen repetition. */
export function plansFromObservation(rows, rep = 1) {
  // A row that failed is kept, carrying its failure word and no needs. A truncated answer is not a plan and never
  // enters a quality metric as one (WP-3.1 §1) — but dropping the row entirely made it indistinguishable from a case
  // the planner simply did not cover, so the failure travels with it.
  return rows.filter((r) => r.rep === rep)
    .map((r) => (r.plan?.needs?.length ? { q: r.q, needs: r.plan.needs, registry: r.registry ?? null }
      : { q: r.q, needs: [], failure: r.failure ?? 'NO_PLAN', registry: r.registry ?? null }));
}

function main(argv) {
  const arg = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
  const gold = readJsonl(arg('--gold'));
  const vocab = loadVocabulary();
  const obs = arg('--obs') ? readJsonl(arg('--obs')) : [];
  const reps = [...new Set(obs.map((r) => r.rep))].sort();
  const report = {
    gold: gold.length,
    per_rep: Object.fromEntries(reps.map((rep) => [rep, scoreGoals(plansFromObservation(obs, rep), gold, vocab)])),
  };
  const text = JSON.stringify(report, null, 1);
  if (arg('--json')) writeFileSync(arg('--json'), text + '\n');
  console.log(text);
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
