#!/usr/bin/env node
// Over-read and partial availability, offline (Inquiry v3 WP-3.1). No model, no network, no marketplace.
//
// WHY THIS EXISTS. The WP-4 smoke found P01 — a question the system can answer — recorded as a capability gap. The
// need wanted one field (ORDER_FULFILLMENT, available on that snapshot); the planner also asked for ORDER_TRACKING,
// which no source in this repository reads on any channel; and ResolutionPlanValidator.gapOf ends with
//
//     if (s.fields().stream().anyMatch(f -> snapshot.status(f) != AVAILABLE)) return GapReason.NOT_SUPPORTED;
//
// so ONE unreadable field marks the whole step unavailable. The planner asking for more than it needed therefore did
// not cost an extra read — it cost the answer.
//
// WHAT THIS MEASURES, AND WHAT IT DOES NOT. It classifies every entity read in a recorded run against what the gold
// says that goal required, and it prices three availability semantics against the same rows. It changes no semantics:
// candidates 2 and 3 are computed, printed, and left as a decision. A measurement that edits the thing it measures is
// not a measurement.
//
// INPUT. Rows written by ResolutionPlannerRunner at or after WP-3.1, which carry `registry` (the snapshot's own
// capability and field statuses) and `availability[].unavailable_fields`. Those come from the Java registry and
// validator, so this tool holds no second copy of the registry policy — it reads the snapshot's answer. Rows recorded
// before WP-3.1 are re-derived for free with PLAN_MODE=replay, which refuses any row whose request is not the one
// being rebuilt.
//
//   node tools/inquiry-need-eval/availability.mjs --obs <replay.jsonl> --gold <plans.jsonl> [--json out.json]
import { realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readJsonl } from './io.mjs';

const ENTITY = (c) => c.startsWith('ENTITY.');
const inc = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

/** Gold entity reads, by case and capability. No case in v3.2 has two goals reading the same entity, so this is 1:1. */
export function goldEntityReads(gold) {
  const out = new Map();
  for (const g of gold.filter((r) => r.status === 'FROZEN')) {
    for (const s of g.steps ?? []) {
      if (!ENTITY(s.capability)) continue;
      const key = `${g.q}|${s.capability}`;
      if (out.has(key)) throw new Error(`two gold goals read ${s.capability} in ${g.q}; pairing is not 1:1`);
      out.set(key, { goal: `${g.q}.${g.goal}`, role: s.role, fields: new Set(s.fields ?? []) });
    }
  }
  return out;
}

/**
 * Is this step a gap for a reason that has nothing to do with which fields were named? Mirrors the first half of
 * `gapOf`: the capability's own status, and an ENTITY.ORDER step on an inquiry no order is bound to. When this is
 * true the field question is moot, and counting the step as an over-read would blame the planner for a gap it did
 * not cause.
 */
function capabilityGap(capability, registry) {
  const status = registry.capabilities[capability];
  if (status !== 'AVAILABLE') return status;
  if (capability === 'ENTITY.ORDER' && !registry.order_bound) return 'UNBOUND';
  return null;
}

const unavailable = (fields, registry) => [...fields].filter((f) => registry.fields[f] !== 'AVAILABLE');

/**
 * The three availability semantics, priced on the same recorded step.
 *
 *  1. ALL_OR_NOTHING — today. One unreadable field among those named makes the step a gap.
 *  2. FIELD_LEVEL    — the step proceeds on the fields that ARE readable and reports the rest as unobserved; it is a
 *                      gap only when nothing it named can be read.
 *  3. NEED_MINIMUM   — the planner's field list is not an instruction about what to read. The resolver reads what the
 *                      need requires (here: what the gold says it requires), so an over-read cannot cost anything.
 */
function candidates(named, goldFields, registry, capGap) {
  const namedBad = unavailable(named, registry);
  const goldBad = goldFields ? unavailable(goldFields, registry) : null;
  return {
    ALL_OR_NOTHING: capGap ?? (namedBad.length ? 'NOT_SUPPORTED' : null),
    FIELD_LEVEL: capGap ?? (named.size && namedBad.length === named.size ? 'NOT_SUPPORTED' : null),
    NEED_MINIMUM: capGap ?? (goldBad === null ? (namedBad.length ? 'NOT_SUPPORTED' : null)
      : goldBad.length ? 'NOT_SUPPORTED' : null),
    degraded_under_field_level: capGap == null && namedBad.length > 0 && namedBad.length < named.size,
  };
}

export function analyse(rows, gold) {
  const goldReads = goldEntityReads(gold);
  const goldGoals = gold.filter((r) => r.status === 'FROZEN');
  const out = {
    rows_scored: 0, answered: 0, entity_steps: 0,
    classes: {}, by_capability: {}, over_read_fields: {}, under_read_fields: {},
    steps: [],
    goal_terminal: { ALL_OR_NOTHING: {}, FIELD_LEVEL: {}, NEED_MINIMUM: {} },
    flipped_by_over_read: [],
    order_tracking: { steps_naming_it: 0, steps_it_alone_gapped: 0, goals_it_alone_blocked: [] },
  };
  for (const row of rows) {
    out.rows_scored++;
    if (!row.plan?.needs?.length) continue;
    out.answered++;
    const registry = row.registry;
    if (!registry) throw new Error(`row ${row.q} has no registry block — replay it with a WP-3.1 harness`);
    for (const need of row.plan.needs) {
      for (const [k, step] of (need.steps ?? []).entries()) {
        if (!ENTITY(step.capability)) continue;
        out.entity_steps++;
        const named = new Set(step.fields ?? []);
        const g = goldReads.get(`${row.q}|${step.capability}`);
        const capGap = capabilityGap(step.capability, registry);
        const cand = candidates(named, g?.fields ?? null, registry, capGap);
        const extra = g ? [...named].filter((f) => !g.fields.has(f)) : [...named];
        const missing = g ? [...g.fields].filter((f) => !named.has(f)) : [];
        const extraBad = unavailable(extra, registry);

        let cls;
        if (!g) cls = 'PLANNER_ONLY_ENTITY_READ';
        else if (capGap) cls = 'CAPABILITY_GAP';
        else if (unavailable(g.fields, registry).length) cls = 'D_GENUINELY_UNAVAILABLE';
        else if (!extra.length) cls = missing.length ? 'UNDER_READ' : 'A_EXACT';
        else if (extraBad.length) cls = 'C_HARMFUL_OVER_READ';
        else cls = 'B_HARMLESS_OVER_READ';

        inc(out.classes, cls);
        inc(out.by_capability, `${step.capability}/${cls}`);
        for (const f of extra) inc(out.over_read_fields, f);
        for (const f of missing) inc(out.under_read_fields, f);
        if (named.has('ORDER_TRACKING')) {
          out.order_tracking.steps_naming_it++;
          // would this step have been readable if ORDER_TRACKING were the only thing it did not get?
          const withoutTracking = new Set([...named].filter((f) => f !== 'ORDER_TRACKING'));
          if (!capGap && unavailable(named, registry).length && !unavailable(withoutTracking, registry).length) {
            out.order_tracking.steps_it_alone_gapped++;
          }
        }
        out.steps.push({
          q: row.q, need: need.id, step: k, capability: step.capability, role: step.role,
          named: [...named], gold: g ? [...g.fields] : null, goal: g?.goal ?? null,
          extra, missing, extra_unavailable: extraBad, class: cls,
          gap: { ALL_OR_NOTHING: cand.ALL_OR_NOTHING, FIELD_LEVEL: cand.FIELD_LEVEL, NEED_MINIMUM: cand.NEED_MINIMUM },
        });
      }
    }
  }
  goalTerminals(out, rows, goldGoals);
  return out;
}

/**
 * Roll the step verdicts up to the question the product actually asks: was this goal left unresolved because something
 * could not act? A CONTEXT step that cannot act does not block a goal — it is read and never closes — so only acting
 * steps (CLOSES, PRECONDITION) count. Non-entity steps are unaffected by any of the three candidates and are scored
 * identically in all of them, so a difference between columns is always a difference about fields.
 */
function goalTerminals(out, rows, goldGoals) {
  const byCase = new Map(rows.map((r) => [r.q, r]));
  const stepsByCase = new Map();
  for (const s of out.steps) stepsByCase.set(s.q, [...(stepsByCase.get(s.q) ?? []), s]);
  for (const goal of goldGoals) {
    const row = byCase.get(goal.q);
    const id = `${goal.q}.${goal.goal}`;
    const verdicts = {};
    for (const semantics of ['ALL_OR_NOTHING', 'FIELD_LEVEL', 'NEED_MINIMUM']) {
      let state = 'RESOLVABLE';
      if (!row || !row.plan?.needs?.length) state = 'NO_PLAN';
      else {
        // non-entity gaps, from the row the Java validator wrote
        const nonEntity = (row.availability ?? []).filter((a) => !ENTITY(a.capability) && a.gap);
        const acting = (stepsByCase.get(goal.q) ?? []).filter((s) => s.role !== 'CONTEXT'
          && (s.goal === id || s.goal === null));
        if (nonEntity.length || acting.some((s) => s.gap[semantics])) state = 'BLOCKED';
      }
      verdicts[semantics] = state;
      inc(out.goal_terminal[semantics], state);
    }
    if (verdicts.ALL_OR_NOTHING === 'BLOCKED' && verdicts.NEED_MINIMUM === 'RESOLVABLE') {
      out.flipped_by_over_read.push({ goal: id, field_level: verdicts.FIELD_LEVEL });
      const blamed = (stepsByCase.get(goal.q) ?? []).filter((s) => s.class === 'C_HARMFUL_OVER_READ');
      if (blamed.some((s) => s.extra_unavailable.includes('ORDER_TRACKING'))) {
        out.order_tracking.goals_it_alone_blocked.push(id);
      }
    }
  }
}

function main(argv) {
  const arg = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
  const report = analyse(readJsonl(arg('--obs')), readJsonl(arg('--gold')));
  const text = JSON.stringify(report, null, 1);
  if (arg('--json')) writeFileSync(arg('--json'), text + '\n');
  console.log(JSON.stringify({ ...report, steps: `${report.steps.length} rows (see --json)` }, null, 1));
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
