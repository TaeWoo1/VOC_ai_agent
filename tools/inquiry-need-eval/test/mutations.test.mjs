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

const K = (capability, role, scope) => (scope ? { capability, role, scope } : { capability, role });
const E = (capability, role, fields) => ({ capability, role, fields });
const need = (steps, customer_inputs = []) => ({ steps, customer_inputs });
const goal = (q, g, steps, customer_inputs = []) => ({ q, goal: g, need: g, status: 'FROZEN', steps, customer_inputs });

const MUTATIONS = [
  {
    name: 'the closing-authority rule is weakened to allow two endings',
    file: 'contract.mjs', from: 'if (closing.length > 1)', to: 'if (closing.length > 2)',
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.validate({ needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
        steps: [K('KNOWLEDGE.PRODUCT', 'CLOSES'), K('SELLER', 'CLOSES')] }] }, ix).length;
    },
    real: 1, mutated: 0,
  },
  {
    name: 'a knowledge step is allowed to carry entity fields again',
    file: 'contract.mjs', from: "if (!entity && s.fields !== undefined) return { failure: 'PLAN_SHAPE' };", to: '',
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.parseStep({ capability: 'KNOWLEDGE.CATALOGUE', role: 'CLOSES', scope: 'THIS_LISTING',
        fields: ['LISTING_OPTION_SALE_STATUS'] }, ix).failure ?? 'PARSED';
    },
    real: 'PLAN_SHAPE', mutated: 'PARSED',
  },
  {
    name: 'a retired slot (effect / depends_on) is quietly accepted',
    file: 'contract.mjs', from: "if (s.effect !== undefined || s.depends_on !== undefined) return { failure: 'PLAN_SHAPE' };", to: '',
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.parseStep({ capability: 'KNOWLEDGE.ORG', role: 'CLOSES', effect: 'BOUNDED_WORKFLOW' }, ix).failure ?? 'PARSED';
    },
    real: 'PLAN_SHAPE', mutated: 'PARSED',
  },
  {
    name: 'a precondition standing after its closer stops being noticed',
    file: 'contract.mjs', from: 'if (s.role === \'PRECONDITION\' && lastCloser >= 0 && k > lastCloser)',
    to: 'if (s.role === \'PRECONDITION\' && lastCloser >= 0 && k > lastCloser + 1)',
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.validate({ needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
        steps: [K('PROCEDURE.ORDER_ACTION', 'CLOSES'), E('ENTITY.ORDER', 'PRECONDITION', ['ORDER_CANCELLATION'])] }] }, ix)
        .map((v) => v.code).includes('PRECONDITION_AFTER_CLOSER');
    },
    real: true, mutated: false,
  },
  {
    name: 'a procedure no longer has to read the order it changes',
    file: 'contract.mjs', from: "p.capability === 'ENTITY.ORDER' && p.role === 'PRECONDITION'",
    to: "p.capability === 'ENTITY.ORDER'",
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.validate({ needs: [{ id: 'N1', ask: 'a', customer_inputs: [],
        steps: [E('ENTITY.ORDER', 'CONTEXT', ['ORDER_FULFILLMENT']), K('PROCEDURE.ORDER_ACTION', 'CLOSES')] }] }, ix)
        .map((v) => v.code).includes('PROCEDURE_WITHOUT_ORDER_PRECONDITION');
    },
    real: true, mutated: false,
  },
  {
    name: 'an entity step may read another capability\'s field',
    file: 'contract.mjs', from: 'fields.some((f) => ix.field.get(f) !== s.capability)', to: 'false',
    witness: async (M) => {
      const ix = M.index(M.loadVocabulary());
      return M.parseStep({ capability: 'ENTITY.ORDER', role: 'CLOSES', fields: ['LISTING_SALE_STATUS'] }, ix).failure ?? 'PARSED';
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
