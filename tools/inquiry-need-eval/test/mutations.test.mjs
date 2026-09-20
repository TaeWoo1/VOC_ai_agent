// node --test tools/inquiry-need-eval/test/mutations.test.mjs
// Mutation testing for the WP-3 contract mirror and the split-tolerant scorer (Inquiry v3 WP-3).
//
// A green suite says the code passes its tests. It does not say the tests would notice if the code stopped being right.
// So each mutation below breaks ONE rule at the source level, loads the broken module, and asserts that a named
// property of the real one no longer holds. A mutation that survives is a rule nothing is actually checking — in WP-1
// exactly one survived, and the scenario written to kill it found a real gap in the fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..');
let seq = 0;

/** Load a module with one textual mutation applied, from beside the original so its relative imports still resolve. */
async function mutant(file, from, to) {
  const source = readFileSync(join(dir, file), 'utf8');
  assert.ok(source.includes(from), `mutation target not found in ${file}: ${from}`);
  const path = join(dir, `.mutant-${seq++}-${file}`);
  writeFileSync(path, source.replace(from, to));
  try {
    return await import(`${path}?v=${seq}`);
  } finally {
    rmSync(path, { force: true });
  }
}

// Same notation as goals.test.mjs: a test says which step closes, and the helpers emit the WP-3.1 shape — roleless
// steps under a declared closing_authority.
const AUTH = { 'KNOWLEDGE.PRODUCT': 'KNOWLEDGE', 'KNOWLEDGE.CATALOGUE': 'KNOWLEDGE', 'KNOWLEDGE.ORG': 'KNOWLEDGE',
  'ENTITY.ORDER': 'ENTITY_STATE', 'ENTITY.LISTING': 'ENTITY_STATE', 'PROCEDURE.ORDER_ACTION': 'PROCEDURE',
  SELLER: 'SELLER' };
const K = (capability, role, scope) => (scope ? { capability, role, scope } : { capability, role });
const E = (capability, role, fields) => ({ capability, role, fields });
const roleless = (steps) => steps.map(({ role, ...rest }) => rest);
const closingOf = (steps) => [...new Set(steps.filter((s) => s.role === 'CLOSES').map((s) => AUTH[s.capability]))][0];
const need = (steps, customer_inputs = []) => ({ closing_authority: closingOf(steps), steps: roleless(steps),
  customer_inputs });
const goal = (q, g, steps, customer_inputs = []) => ({ q, goal: g, status: 'FROZEN',
  closing_authority: closingOf(steps), steps: roleless(steps), customer_inputs });
const plan = (closing, steps, customer_inputs = []) => ({ needs: [{ id: 'N1', ask: 'a', closing_authority: closing,
  steps: roleless(steps), customer_inputs }] });

const MUTATIONS = [
  {
    name: 'a need may declare a resolution it never asked for',
    file: 'contract.mjs',
    from: "    if (!steps.some((s) => ix.authority.get(s.capability) === need.closing_authority)) {",
    to: '    if (false) {',
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.validate(plan('SELLER', [K('KNOWLEDGE.PRODUCT', 'CLOSES')]), ix)
        .map((v) => v.code).includes('CLOSING_AUTHORITY_UNSUPPORTED');
    },
    real: true, mutated: false,
  },
  {
    name: 'a plan that states no ending stops being reported as no plan',
    file: 'contract.mjs',
    from: "    if (n.closing_authority === undefined || n.closing_authority === null) return { failure: 'UNPARSEABLE' };",
    to: '',
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.parsePlan({ needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
        steps: [{ capability: 'KNOWLEDGE.ORG' }] }] }, ix).failure ?? 'PARSED';
    },
    // Still refused — the enum check below catches it — but with the WRONG WORD. "this was not a plan" and "this
    // used a token I do not know" are different facts about a run, and a run artifact that confuses them sends the
    // next diagnosis at the vendor's vocabulary instead of at a missing field.
    real: 'UNPARSEABLE', mutated: 'PLAN_SET',
  },
  {
    name: 'a knowledge step is allowed to carry entity fields again',
    file: 'contract.mjs', from: "if (!entity && s.fields !== undefined) return { failure: 'PLAN_SHAPE' };", to: '',
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.parseStep({ capability: 'KNOWLEDGE.CATALOGUE', scope: 'THIS_LISTING',
        fields: ['LISTING_OPTION_SALE_STATUS'] }, ix).failure ?? 'PARSED';
    },
    real: 'PLAN_SHAPE', mutated: 'PARSED',
  },
  {
    name: 'a retired slot (effect / depends_on) is quietly accepted',
    file: 'contract.mjs',
    from: "if (s.effect !== undefined || s.depends_on !== undefined || s.role !== undefined) return { failure: 'PLAN_SHAPE' };",
    to: "if (s.depends_on !== undefined || s.role !== undefined) return { failure: 'PLAN_SHAPE' };",
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.parseStep({ capability: 'KNOWLEDGE.ORG', effect: 'BOUNDED_WORKFLOW' }, ix).failure ?? 'PARSED';
    },
    real: 'PLAN_SHAPE', mutated: 'PARSED',
  },
  {
    name: 'a retired role is quietly accepted, so a v3 answer is read as if it had said nothing about the ending',
    file: 'contract.mjs',
    from: "  if (s.effect !== undefined || s.depends_on !== undefined || s.role !== undefined) return { failure: 'PLAN_SHAPE' };",
    to: "  if (s.effect !== undefined || s.depends_on !== undefined) return { failure: 'PLAN_SHAPE' };",
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.parseStep({ capability: 'KNOWLEDGE.ORG', role: 'CLOSES' }, ix).failure ?? 'PARSED';
    },
    real: 'PLAN_SHAPE', mutated: 'PARSED',
  },
  {
    name: 'a procedure no longer has to read the order it changes',
    file: 'contract.mjs',
    from: "    if (need.closing_authority === 'PROCEDURE' && !steps.some((s) => s.capability === 'ENTITY.ORDER')) {",
    to: '    if (false) {',
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.validate(plan('PROCEDURE', [K('PROCEDURE.ORDER_ACTION', 'CLOSES')]), ix)
        .map((v) => v.code).includes('PROCEDURE_WITHOUT_ORDER_READ');
    },
    real: true, mutated: false,
  },
  {
    name: 'POSITION DECIDES AGAIN: the closer is taken from the last step written',
    file: 'goals.mjs',
    from: '    return { closingAuthorities: new Set([row.closing_authority]), declared: true, ambiguous: false };',
    to: '    const last = (row.steps ?? [])[(row.steps ?? []).length - 1];\n'
      + '    return { closingAuthorities: new Set([ix.get(last.capability)]), declared: true, ambiguous: false };',
    witness: async (M) => {
      // the R:8989a9d0 shape, written correctly: knowledge resolves it and the seller judgment is beside it
      const goals = [goal('C1', 'n1', [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'SELLER_CATALOGUE')])];
      return M.scoreGoals([{ q: 'C1', needs: [{ closing_authority: 'KNOWLEDGE', customer_inputs: [],
        steps: [{ capability: 'KNOWLEDGE.CATALOGUE', scope: 'SELLER_CATALOGUE' }, { capability: 'SELLER' }] }] }],
      goals).correct_closer;
    },
    real: 1, mutated: 0,
  },
  {
    name: 'an entity step may read another capability\'s field',
    file: 'contract.mjs', from: 'fields.some((f) => ix.field.get(f) !== s.capability)', to: 'false',
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.parseStep({ capability: 'ENTITY.ORDER', fields: ['LISTING_SALE_STATUS'] }, ix).failure ?? 'PARSED';
    },
    real: 'PLAN_SHAPE', mutated: 'PARSED',
  },
  {
    name: 'any need may serve any goal, so merging two goals into one need passes',
    file: 'goals.mjs', from: "const compatible = (need, goal) => [...need.authorities].some((a) => goal.authorities.has(a));",
    to: 'const compatible = () => true;',
    witness: async (M) => {
      const goals = [goal('C1', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')])];
      return M.scoreGoals([{ q: 'C1', needs: [need([E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])] }], goals)
        .planner_only_extra_needs;
    },
    real: 1, mutated: 0,
  },
  {
    name: 'the assignment stops preferring the goal whose own capability a need names',
    file: 'goals.mjs', from: "        -acc.reduce((s, a, ni) => s + (a >= 0 ? overlap(needs[ni], goals[a]) : 0), 0),\n", to: '',
    witness: async (M) => {
      const goals = [goal('C1', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')]),
        goal('C1', 'n2', [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'THIS_LISTING')])];
      return M.scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'THIS_LISTING')]),
        need([K('KNOWLEDGE.PRODUCT', 'CLOSES')])] }], goals).capability_mismatch.length;
    },
    real: 0, mutated: 2,
  },
  {
    name: 'over-asking the customer stops being counted as anything',
    file: 'goals.mjs', from: '  acc.unnecessary_total += extra.length;', to: '',
    witness: async (M) => {
      const goals = [goal('C1', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')], ['OPTION'])];
      return M.scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')], ['OPTION', 'SIZE'])] }], goals)
        .inputs.unnecessary_total;
    },
    real: 1, mutated: 0,
  },
  {
    name: 'identity asked of the customer stops being separated from ordinary over-asking',
    file: 'goals.mjs', from: '    if (forbidden.has(e)) acc.forbidden++;', to: '',
    witness: async (M) => {
      const goals = [goal('C1', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])];
      return M.scoreGoals([{ q: 'C1', needs: [need([E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])], ['ORDER_NUMBER'])] }], goals)
        .inputs.forbidden;
    },
    real: 1, mutated: 0,
  },
  {
    name: 'an entity step read too widely counts as correct',
    file: 'goals.mjs', from: '        if (!extra.length && !missing.length) out.entity_correct++;',
    to: '        if (!missing.length) out.entity_correct++;',
    witness: async (M) => {
      const goals = [goal('C1', 'n1', [E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT'])])];
      return M.scoreGoals([{ q: 'C1', needs: [need([E('ENTITY.ORDER', 'CLOSES', ['ORDER_FULFILLMENT', 'ORDER_TRACKING'])])] }], goals)
        .entity_correct;
    },
    real: 0, mutated: 1,
  },
  {
    name: 'goals this scorer cannot tell apart stop being counted',
    file: 'goals.mjs', from: '    out.goals_indistinguishable += goals.filter((g) => seen.get(signature(g)) > 1).length;', to: '',
    witness: async (M) => {
      const same = [goal('C1', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')]), goal('C1', 'n2', [K('KNOWLEDGE.PRODUCT', 'CLOSES')])];
      return M.scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')]), need([K('KNOWLEDGE.PRODUCT', 'CLOSES')])] }], same)
        .goals_indistinguishable;
    },
    real: 2, mutated: 0,
  },
  // ── WP-3.1: the closer rules ────────────────────────────────────────────────────────────────────────────────────
  {
    name: 'a recorded two-ending plan counts as a correct close again — the WP-2 overestimate, restored',
    file: 'goals.mjs', from: '        const ambiguous = mine.some((n) => n.ambiguous);',
    to: '        const ambiguous = false;',
    witness: async (M) => {
      // the shape RECORDED before WP-3.1: two endings in one need, which is how recall reached 1.000
      const both = { steps: [{ capability: 'KNOWLEDGE.CATALOGUE', role: 'CLOSES', scope: 'SELLER_CATALOGUE' },
        { capability: 'SELLER', role: 'CLOSES' }], customer_inputs: [] };
      return M.scoreGoals([{ q: 'C1', needs: [both] }],
        [goal('C1', 'n1', [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'SELLER_CATALOGUE')])]).correct_closer;
    },
    real: 0, mutated: 1,
  },
  {
    name: 'a seller ending on a goal the seller does not close stops being named a fallback',
    file: 'goals.mjs', from: "          out.fallback_authority_inserted.push(id);", to: '',
    witness: async (M) => M.scoreGoals([{ q: 'C1', needs: [need([
      K('KNOWLEDGE.CATALOGUE', 'PRECONDITION', 'SELLER_CATALOGUE'), K('SELLER', 'CLOSES')])] }],
    [goal('C1', 'n1', [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'SELLER_CATALOGUE')])]).fallback_authority_inserted.length,
    real: 1, mutated: 0,
  },
  {
    name: 'the seller put in a missing capability\'s place stops being counted at all',
    file: 'goals.mjs', from: "      .filter((a, ni) => a === -1 && needs[ni].closingAuthorities.has('SELLER')).length;",
    to: '      .filter(() => false).length;',
    witness: async (M) => M.scoreGoals([{ q: 'C1', needs: [need([K('SELLER', 'CLOSES')])] }],
      [goal('C1', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')])]).seller_only_extra_needs,
    real: 1, mutated: 0,
  },
  {
    name: 'an answer that never arrived is folded back into planning misses',
    file: 'goals.mjs', from: "      const why = pred?.failure ? `NO_ANSWER:${pred.failure}` : 'NO_PLAN';",
    to: "      const why = 'NO_PLAN';",
    witness: async (M) => M.scoreGoals(M.plansFromObservation([{ q: 'C1', rep: 1, plan: null, failure: 'TRUNCATED' }]),
      [goal('C1', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')])]).uncovered[0].why,
    real: 'NO_ANSWER:TRUNCATED', mutated: 'NO_PLAN',
  },
  {
    name: 'the presence claim and the closing claim become the same number again',
    file: 'goals.mjs', from: 'if ([...g.closingAuthorities].every((a) => anywhere.has(a))) out.required_authority_present++;',
    to: 'if (b.missing.length === 0) out.required_authority_present++;',
    witness: async (M) => M.scoreGoals([{ q: 'C1', needs: [need([
      K('KNOWLEDGE.CATALOGUE', 'PRECONDITION', 'SELLER_CATALOGUE'), K('SELLER', 'CLOSES')])] }],
    [goal('C1', 'n1', [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'SELLER_CATALOGUE')])]).required_authority_present,
    real: 1, mutated: 0,
  },
  // ── WP-3.2 ────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    name: 'a procedure may be carried as another authority\'s optional follow-up again',
    file: 'contract.mjs',
    from: "    if (need.closing_authority !== 'PROCEDURE'\n        && steps.some((s) => ix.authority.get(s.capability) === 'PROCEDURE')) {",
    to: '    if (false) {',
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.validate(plan('SELLER', [K('SELLER', 'CLOSES'), K('PROCEDURE.ORDER_ACTION', 'CONTEXT')]), ix)
        .map((v) => v.code).includes('PROCEDURE_NOT_CLOSING');
    },
    real: true, mutated: false,
  },
  {
    name: 'the wrong instance stops being distinguished from the right one',
    file: 'goals.mjs', from: '      if (predicted[i].scope === want.scope) {', to: '      if (true) {',
    witness: async (M) => M.scoreGoals(
      [{ q: 'C1', needs: [need([K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'THIS_LISTING')])] }],
      [goal('C1', 'n1', [K('KNOWLEDGE.CATALOGUE', 'CLOSES', 'SELLER_CATALOGUE')])]).scope.scope_wrong,
    real: 1, mutated: 0,
  },
  {
    name: 'scope is scored over steps that never had a choice, diluting it',
    file: 'goals.mjs', from: "    if ((choices.get(want.capability) ?? 1) > 1) {", to: '    if (true) {',
    witness: async (M) => M.scoreGoals([{ q: 'C1', needs: [need([K('KNOWLEDGE.PRODUCT', 'CLOSES')])] }],
      [goal('C1', 'n1', [K('KNOWLEDGE.PRODUCT', 'CLOSES')])]).scope.scope_decidable,
    real: 0, mutated: 1,
  },
  // --- Inquiry v3.5: the CustomerGoal contract and the Layer-A headline --------------------------------------
  {
    name: 'a plan may arrive wearing a goal name',
    file: 'customer-goals.mjs',
    from: "  for (const k of RETIRED) if (k in raw) return { failure: 'GOAL_PLAN', at: k };",
    to: '  ;',
    witness: async (M) => M.parseGoal({ id: 'g1', explicit_request: 'r', requested_outcome: 'DECISION',
      subject: 'CURRENT_ORDER', basis: 'STATED', explicit_constraints: [], procedure: 'EXCHANGE' }).failure ?? 'ACCEPTED',
    real: 'GOAL_PLAN', mutated: 'GOAL_SET',
  },
  {
    name: 'a decision is allowed to reach a procedure',
    file: 'customer-goals.mjs',
    from: "export const mayReachProcedure = (outcome) => outcome === 'ACTION';",
    to: 'export const mayReachProcedure = () => true;',
    witness: async (M) => M.OUTCOMES.filter((o) => M.mayReachProcedure(o)),
    real: ['ACTION'], mutated: ['INFORMATION', 'STATE_READ', 'DECISION', 'ACTION'],
  },
  {
    name: 'a decision is routed straight to the seller instead of asking knowledge first',
    file: 'customer-goals.mjs',
    from: "DECISION: 'KNOWLEDGE', ACTION: 'PROCEDURE',",
    to: "DECISION: 'SELLER', ACTION: 'PROCEDURE',",
    witness: async (M) => M.FIRST_RESOLVER.DECISION,
    real: 'KNOWLEDGE', mutated: 'SELLER',
  },
  {
    name: 'an extra goal nobody asked for stops being counted',
    file: 'customer-goals.mjs',
    from: '    m.invented += extra.length;',
    to: '    m.invented += 0;',
    witness: async (M) => M.scoreLayerA(
      [{ q: 'C6', goal: 'n1', requested_outcome: 'DECISION', referent: 'CURRENT_ORDER', basis: 'STATED',
        explicit_constraints: 0 }],
      { C6: [{ id: 'g1', request: 'r', outcome: 'DECISION', subject: 'CURRENT_ORDER', basis: 'STATED', constraints: [] },
        { id: 'g2', request: 'r', outcome: 'ACTION', subject: 'CURRENT_ORDER', basis: 'STATED', constraints: [] }] },
    ).invented_goal_rate,
    real: 0.5, mutated: 0,
  },
  {
    name: 'a goal emitted on a NO_GOAL row pairs with it instead of being counted as invented',
    file: 'customer-goals.mjs',
    from: '    const goals = allRows.filter((g) => !g.no_goal_reason);',
    to: '    const goals = allRows;',
    witness: async (M) => M.scoreLayerA(
      [{ q: 'X', goal: 'n1', requested_outcome: null, referent: 'CURRENT_ORDER', basis: null,
        explicit_constraints: 0, no_goal_reason: 'no request was made' }],
      { X: [{ id: 'g1', request: 'r', outcome: 'ACTION', subject: 'CURRENT_ORDER', basis: 'STATED', constraints: [] }] },
    ).invented,
    real: 1, mutated: 0,
  },
  {
    name: 'a label still under adjudication is scored as if it were settled',
    file: 'customer-goals.mjs',
    from: '      if (g.requested_outcome === null) continue; // adjudication row: not scored for correctness',
    to: '      ;',
    witness: async (M) => M.scoreLayerA(
      [{ q: 'X', goal: 'n1', requested_outcome: null, referent: 'CURRENT_ORDER', basis: null, explicit_constraints: 0 }],
      { X: [{ id: 'g1', request: 'r', outcome: 'ACTION', subject: 'CURRENT_ORDER', basis: 'STATED', constraints: [] }] },
    ).scored_goals,
    real: 0, mutated: 1,
  },
];

for (const m of MUTATIONS) {
  test(`mutation is caught: ${m.name}`, async () => {
    const real = await import(join(dir, m.file));
    assert.deepEqual(await m.witness(real), m.real, 'the real module holds the property');
    const broken = await mutant(m.file, m.from, m.to);
    assert.deepEqual(await m.witness(broken), m.mutated, 'the mutation changes what the property says');
    assert.notDeepEqual(m.real, m.mutated, 'a mutation that changes nothing is not a mutation');
  });
}
