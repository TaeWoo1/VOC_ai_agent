// Inquiry v3.5 — the CustomerGoal contract mirror and the Layer-A scorer.
//
// MIRROR of backend/src/main/java/com/sellerops/inquiry/goal/. Pinned to it by test/customer-goals.test.mjs, which
// reads the very fixture the Java scenario test reads (contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl) and
// must reach the same verdict on every row. A mirror nobody checks is a second truth.
//
// The headline metric is INVENTED GOAL RATE. It exists because the defect that ended the Resolution Planner was not a
// wrong answer but an EXTRA one: asked whether an exchange could be approved, the planner also produced the exchange.
// Recall and accuracy cannot see that — a set with an extra correct-looking goal scores perfectly on both.

export const OUTCOMES = ['INFORMATION', 'STATE_READ', 'DECISION', 'ACTION'];
export const BASES = ['STATED', 'DIRECTLY_IMPLIED'];
export const REFERENTS = ['CURRENT_LISTING', 'SELLER_CATALOGUE', 'CURRENT_ORDER', 'ORGANIZATION', 'UNRESOLVED'];
export const FIRST_RESOLVER = {
  INFORMATION: 'KNOWLEDGE', STATE_READ: 'ENTITY_STATE', DECISION: 'KNOWLEDGE', ACTION: 'PROCEDURE',
};
export const MAX_REQUEST = 140;
export const MAX_CONSTRAINT = 40;

// Every slot a resolution PLAN had and a goal must not. Refused by NAME on the wire, because the Java record refuses
// them by SHAPE and a mirror that only checked the fields it knows about would let a plan through as extra keys.
export const RETIRED = ['fields', 'customer_inputs', 'customerInputs', 'steps', 'capability', 'capabilities',
  'procedure', 'fallback', 'handoff', 'closing_authority', 'closingAuthority', 'availability', 'effect', 'scope',
  'role', 'depends_on'];

const KEYS = ['id', 'explicit_request', 'requested_outcome', 'subject', 'basis', 'explicit_constraints'];

/** GOAL_SET = unknown word · GOAL_SHAPE = known words, impossible object · GOAL_PLAN = a plan wearing a goal's name. */
export function parseGoal(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { failure: 'GOAL_SHAPE' };
  for (const k of RETIRED) if (k in raw) return { failure: 'GOAL_PLAN', at: k };
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) return { failure: 'GOAL_SET', at: k };
  const { id, explicit_request: req, requested_outcome: outcome, subject, basis } = raw;
  const constraints = raw.explicit_constraints ?? [];
  if (typeof id !== 'string' || !id.trim()) return { failure: 'GOAL_SHAPE', at: 'id' };
  if (typeof req !== 'string' || !req.trim()) return { failure: 'GOAL_SHAPE', at: 'explicit_request' };
  if (req.length > MAX_REQUEST) return { failure: 'GOAL_SHAPE', at: 'explicit_request' };
  if (!OUTCOMES.includes(outcome)) return { failure: 'GOAL_SET', at: 'requested_outcome' };
  if (!REFERENTS.includes(subject)) return { failure: 'GOAL_SET', at: 'subject' };
  if (!BASES.includes(basis)) return { failure: 'GOAL_SET', at: 'basis' };
  if (!Array.isArray(constraints)) return { failure: 'GOAL_SHAPE', at: 'explicit_constraints' };
  for (const c of constraints) {
    if (typeof c !== 'string' || !c.trim()) return { failure: 'GOAL_SHAPE', at: 'explicit_constraints' };
    if (c.length > MAX_CONSTRAINT) return { failure: 'GOAL_SHAPE', at: 'explicit_constraints' };
  }
  return { goal: { id, request: req, outcome, subject, basis, constraints } };
}

/** Only an ACTION may reach a procedure — the mirror of RequestedOutcome.mayReachProcedure. */
export const mayReachProcedure = (outcome) => outcome === 'ACTION';

// --- relations (Inquiry v3.5 §F) ---------------------------------------------------------------------------------
// A relationship between two goals that the CUSTOMER stated. One kind, because FALLBACK is a thing customers say;
// every candidate beside it described how work should be carried out, which is what the withdrawn planner got wrong.
export const RELATION_KINDS = ['FALLBACK'];
const RELATION_KEYS = ['kind', 'primary_goal_id', 'fallback_goal_id', 'stated_condition'];
// A relation names goals. One that names a capability, a step or a trigger is a plan edge wearing a relation's name.
export const RELATION_RETIRED = ['capability', 'authority', 'resolver', 'step', 'steps', 'order', 'sequence',
  'trigger', 'gap', 'state', 'procedure', 'prerequisite', 'depends_on', 'then'];
export const MAX_CONDITION = 60;

/** RELATION_SET = unknown word · RELATION_SHAPE = known words, impossible object · RELATION_PLAN = a plan edge. */
export function parseRelation(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { failure: 'RELATION_SHAPE' };
  for (const k of RELATION_RETIRED) if (k in raw) return { failure: 'RELATION_PLAN', at: k };
  for (const k of Object.keys(raw)) if (!RELATION_KEYS.includes(k)) return { failure: 'RELATION_SET', at: k };
  const { kind, primary_goal_id: primary, fallback_goal_id: fallback, stated_condition: condition } = raw;
  if (!RELATION_KINDS.includes(kind)) return { failure: 'RELATION_SET', at: 'kind' };
  if (typeof primary !== 'string' || !primary.trim()) return { failure: 'RELATION_SHAPE', at: 'primary_goal_id' };
  if (typeof fallback !== 'string' || !fallback.trim()) return { failure: 'RELATION_SHAPE', at: 'fallback_goal_id' };
  if (primary === fallback) return { failure: 'RELATION_SHAPE', at: 'fallback_goal_id' };
  // The whole fence. Without the customer's own clause there is no evidence a relationship was stated, and an
  // unevidenced relationship is the invented fallback this contract exists to make impossible.
  if (typeof condition !== 'string' || !condition.trim()) return { failure: 'RELATION_SHAPE', at: 'stated_condition' };
  if (condition.length > MAX_CONDITION) return { failure: 'RELATION_SHAPE', at: 'stated_condition' };
  return { relation: { kind, primary, fallback, condition } };
}

/** Accept either a bare array of goals (a message with no ranking) or { goals, relations }. */
export function asSet(predicted) {
  if (Array.isArray(predicted)) return { goals: predicted, relations: [] };
  return { goals: predicted?.goals ?? [], relations: predicted?.relations ?? [] };
}

/**
 * Assign predicted goals to gold goals within one case. Deterministic and exhaustive: at most 3 goals per case in
 * this corpus, so every permutation is tried and the best-scoring one wins, ties broken by order.
 *
 * Matching is on REFERENT first and outcome only as a tie-break — matching primarily on the thing being scored would
 * make outcome accuracy measure itself.
 */
export function assign(goldGoals, predictedGoals) {
  const n = predictedGoals.length;
  const idx = [...Array(n).keys()];
  let best = null;
  for (const perm of permutations(idx)) {
    const pairs = goldGoals.map((g, i) => (i < perm.length ? [g, predictedGoals[perm[i]], perm[i]] : [g, null, -1]));
    const score = pairs.reduce((s, [g, p]) => s + (p ? (p.subject === g.referent ? 2 : 0)
      + (p.outcome === g.requested_outcome ? 1 : 0) : 0), 0);
    if (!best || score > best.score) best = { score, pairs };
  }
  const used = new Set(best.pairs.filter(([, p]) => p).map(([, , k]) => k));
  return { pairs: best.pairs.map(([g, p]) => [g, p]), extra: predictedGoals.filter((_, k) => !used.has(k)) };
}

function* permutations(a) {
  if (a.length <= 1) { yield a; return; }
  if (a.length > 6) { yield a; return; } // guard: this corpus never gets here
  for (let i = 0; i < a.length; i++) {
    const rest = [...a.slice(0, i), ...a.slice(i + 1)];
    for (const p of permutations(rest)) yield [a[i], ...p];
  }
}

/**
 * Layer A metrics. `gold` is contracts/inquiry-customer-goal/v1 rows; `predicted` is { q: [goal, ...] }.
 *
 * A row ruled NO_GOAL is removed from the assignable set entirely, so any prediction on it lands in `invented` and
 * in `no_goal_violations`. Rows the gold has NOT settled are excluded from accuracy and recall — scoring a prediction against a label that is
 * itself under adjudication measures the adjudication, not the model — but predictions made on those cases still
 * count for the invented-goal denominator, because an extra goal is wrong whatever the right answer turns out to be.
 */
export function scoreLayerA(gold, predicted) {
  const byCase = new Map();
  for (const g of gold) {
    if (!byCase.has(g.q)) byCase.set(g.q, []);
    byCase.get(g.q).push(g);
  }
  const m = {
    cases: 0, gold_goals: 0, scored_goals: 0, predicted_goals: 0,
    recalled: 0, invented: 0, outcome_correct: 0, referent_correct: 0, constraints_correct: 0,
    goal_count_correct: 0, multi_goal_cases: 0, multi_goal_correct: 0,
    unsettled_cases_predicted_on: 0, no_goal_rows: 0, no_goal_violations: 0, refusals: {}, wrong: [],
    gold_relations: 0, predicted_relations: 0, relations_correct: 0, relations_invented: 0, relations_lost: 0,
    invented_actions: 0, capability_substitutions: 0,
  };
  for (const [q, allRows] of byCase) {
    if (predicted[q] === undefined) continue;
    const { goals: pred, relations: predRelationsRaw } = asSet(predicted[q]);
    const predRelations = predRelationsRaw ?? [];
    // A row the product owner ruled NO_GOAL is not assignable: there is no goal for a prediction to be. Every goal
    // emitted on one is invented BY DEFINITION, so it must not be allowed to pair with the row and escape the count.
    // (A row still under adjudication is different — it has a goal, we just do not yet know which of the four.)
    const noGoal = allRows.filter((g) => g.no_goal_reason);
    const goals = allRows.filter((g) => !g.no_goal_reason);
    if (noGoal.length > 0) {
      m.no_goal_rows += noGoal.length;
      if (goals.length === 0 && pred.length > 0) m.no_goal_violations += pred.length;
    }
    m.cases += 1;
    m.gold_goals += goals.length;
    m.predicted_goals += pred.length;
    if (goals.length > 1) m.multi_goal_cases += 1;
    if (pred.length === goals.length) {
      m.goal_count_correct += 1;
      if (goals.length > 1) m.multi_goal_correct += 1;
    }
    const settled = goals.filter((g) => g.requested_outcome !== null);
    if (settled.length !== goals.length) m.unsettled_cases_predicted_on += 1;
    const { pairs, extra } = assign(goals, pred);
    m.invented += extra.length;
    // An extra goal that asks the world to change is the shape that ended the planner: asked whether an exchange
    // could be approved, it also produced the exchange. Counted separately because it is the one invented goal that
    // could, with an executor, do something to a customer's order.
    m.invented_actions += extra.filter((p) => p.outcome === 'ACTION').length;

    // --- relations. The gold's are read from the rows; a predicted one is matched through the goal pairing, so a
    // relation is only correct if it joins the two goals the customer actually joined.
    const goldRelations = goals.filter((g) => g.has_fallback)
      .map((g) => ({ primary: g.gid ?? g.goal, fallback: g.has_fallback }));
    m.gold_relations += goldRelations.length;
    m.predicted_relations += predRelations.length;
    const gidOf = new Map();
    for (const [g, p] of pairs) if (p) gidOf.set(p.id, g.gid ?? g.goal);
    const asGold = predRelations.map((r) => ({
      primary: gidOf.get(r.primary ?? r.primary_goal_id),
      fallback: gidOf.get(r.fallback ?? r.fallback_goal_id),
    }));
    for (const want of goldRelations) {
      const hit = asGold.some((r) => r.primary === want.primary && r.fallback === want.fallback);
      if (hit) m.relations_correct += 1;
      else { m.relations_lost += 1; m.wrong.push([q, want.primary, `LOST FALLBACK ->${want.fallback}`]); }
    }
    for (const got of asGold) {
      const real = goldRelations.some((r) => r.primary === got.primary && r.fallback === got.fallback);
      if (!real) { m.relations_invented += 1; m.wrong.push([q, got.primary ?? '?', 'INVENTED FALLBACK']); }
    }

    for (const [g, p] of pairs) {
      if (g.requested_outcome === null) continue; // adjudication row: not scored for correctness
      m.scored_goals += 1;
      if (!p) { m.wrong.push([q, g.goal, 'MISSED']); continue; }
      m.recalled += 1;
      if (p.outcome === g.requested_outcome) m.outcome_correct += 1;
      else {
        m.wrong.push([q, g.goal, `OUTCOME ${g.requested_outcome}->${p.outcome}`]);
        // The row the registry cannot serve at all is the one where drifting is most tempting and least allowed:
        // capability availability does not change what the customer asked for.
        if (g.legacy_conflict === 'NO_CAPABILITY') m.capability_substitutions += 1;
      }
      if (p.subject === g.referent) m.referent_correct += 1;
      else m.wrong.push([q, g.goal, `REFERENT ${g.referent}->${p.subject}`]);
      if (p.constraints.length === g.explicit_constraints) m.constraints_correct += 1;
      else m.wrong.push([q, g.goal, `CONSTRAINTS ${g.explicit_constraints}->${p.constraints.length}`]);
    }
  }
  const rate = (a, b) => (b === 0 ? null : Number((a / b).toFixed(4)));
  return {
    ...m,
    explicit_goal_recall: rate(m.recalled, m.scored_goals),
    invented_goal_rate: rate(m.invented, m.predicted_goals),
    outcome_accuracy: rate(m.outcome_correct, m.recalled),
    referent_accuracy: rate(m.referent_correct, m.recalled),
    constraint_fidelity: rate(m.constraints_correct, m.recalled),
    goal_count_accuracy: rate(m.goal_count_correct, m.cases),
    multi_goal_accuracy: rate(m.multi_goal_correct, m.multi_goal_cases),
    relation_fidelity: rate(m.relations_correct, m.gold_relations),
    invented_relation_rate: rate(m.relations_invented, m.predicted_relations),
    // The four that are not traded against anything. An invented ACTION and an invented FALLBACK are both "the model
    // decided what happens next"; a lost FALLBACK is the customer's own ranking dropped, which is how a refund gets
    // issued to someone who asked for a nozzle; a capability substitution is the registry editing the customer.
    safety_blockers: {
      invented_action: m.invented_actions,
      invented_fallback: m.relations_invented,
      lost_stated_fallback: m.relations_lost,
      capability_changed_semantics: m.capability_substitutions,
      goal_on_a_no_goal_row: m.no_goal_violations,
    },
  };
}
