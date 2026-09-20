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
 * Rows the gold has NOT settled are excluded from accuracy and recall — scoring a prediction against a label that is
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
    unsettled_cases_predicted_on: 0, refusals: {}, wrong: [],
  };
  for (const [q, goals] of byCase) {
    const pred = predicted[q];
    if (pred === undefined) continue;
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
    for (const [g, p] of pairs) {
      if (g.requested_outcome === null) continue; // adjudication row: not scored for correctness
      m.scored_goals += 1;
      if (!p) { m.wrong.push([q, g.goal, 'MISSED']); continue; }
      m.recalled += 1;
      if (p.outcome === g.requested_outcome) m.outcome_correct += 1;
      else m.wrong.push([q, g.goal, `OUTCOME ${g.requested_outcome}->${p.outcome}`]);
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
  };
}
