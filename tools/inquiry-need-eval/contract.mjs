#!/usr/bin/env node
// The plan contract, offline (Inquiry v3 WP-3 step shapes; WP-3.1 declared ending): the step shapes, the declared
// closing authority, the projection of an older plan into them, and the validator rules that survive. This is a MIRROR of the Java (ResolutionPlan / ResolutionPlanParser /
// ResolutionPlanValidator) and is pinned to it by test/plan.test.mjs, which runs it over the very same fixture file the
// Java scenario tests read (contracts/inquiry-planner/v3/synthetic/planner-scenarios.jsonl). A mirror nobody checks is a
// second opinion; a mirror checked against the original on the shared fixtures is a way to score recorded runs without a
// JVM.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const loadVocabulary = (p = join(here, '../../contracts/inquiry-authority/v1/vocabulary.json')) =>
  JSON.parse(readFileSync(p, 'utf8'));

export const index = (vocab) => ({
  authority: new Map(vocab.capabilities.map((c) => [c.id, c.authority])),
  effect: new Map(vocab.capabilities.map((c) => [c.id, c.effect])),
  field: new Map(vocab.entity_fields.map((f) => [f.id, f.capability])),
  scope: new Map(Object.entries(vocab.scope_by_capability)),
  identity: new Set(vocab.customer_inputs.filter((i) => i.kind === 'IDENTITY').map((i) => i.id)),
  bridgeOnly: new Set(vocab.customer_inputs.filter((i) => i.bridge_only).map((i) => i.id)),
});

export const AUTHORITIES = ['KNOWLEDGE', 'ENTITY_STATE', 'PROCEDURE', 'SELLER'];

const only = (ix, capability) => (ix.scope.get(capability) ?? [])[0];
const chooses = (ix, capability) => (ix.scope.get(capability) ?? []).length > 1;
const isEntity = (ix, capability) => ix.authority.get(capability) === 'ENTITY_STATE';

/**
 * The parser's job: turn a wire step into one of the four shapes, or say which kind of refusal it is.
 * `PLAN_SET` = a word this system does not know. `PLAN_SHAPE` = known words, impossible object.
 *
 * WP-3.1: `role` joins `effect` and `depends_on` as a retired slot. An answer still carrying one was written against
 * the v3 contract, where the role decided the ending; reading it as a WP-3.1 plan would discard the model's own
 * statement about the ending and keep the rest.
 */
export function parseStep(s, ix) {
  const authority = ix.authority.get(s.capability);
  if (!authority) return { failure: 'PLAN_SET' };
  const entity = isEntity(ix, s.capability);
  if (!entity && s.fields !== undefined) return { failure: 'PLAN_SHAPE' };
  if (!chooses(ix, s.capability) && s.scope !== undefined) return { failure: 'PLAN_SHAPE' };
  if (s.effect !== undefined || s.depends_on !== undefined || s.role !== undefined) return { failure: 'PLAN_SHAPE' };
  if (entity) {
    const fields = s.fields ?? [];
    if (fields.some((f) => !ix.field.has(f))) return { failure: 'PLAN_SET' };
    if (!fields.length || fields.some((f) => ix.field.get(f) !== s.capability)) return { failure: 'PLAN_SHAPE' };
    return { step: { capability: s.capability, scope: only(ix, s.capability), fields } };
  }
  const scope = chooses(ix, s.capability) ? s.scope : only(ix, s.capability);
  if (scope === undefined || scope === null) return { failure: 'PLAN_SET' };
  if (!(ix.scope.get(s.capability) ?? []).includes(scope)) {
    return { failure: chooses(ix, s.capability) ? 'PLAN_SET' : 'PLAN_SHAPE' };
  }
  return { step: { capability: s.capability, scope } };
}

/** A whole plan through the parser. Returns `{plan}` or `{failure}` — one bad step fails the plan, never a dropped step. */
export function parsePlan(plan, ix) {
  const needs = [];
  for (const n of plan?.needs ?? []) {
    if (!n.id || !n.ask || !(n.steps ?? []).length) return { failure: 'UNPARSEABLE' };
    // the ending is read, never inferred: a need that does not state one is not a plan
    if (n.closing_authority === undefined || n.closing_authority === null) return { failure: 'UNPARSEABLE' };
    if (!AUTHORITIES.includes(n.closing_authority)) return { failure: 'PLAN_SET' };
    const steps = [];
    for (const s of n.steps) {
      const r = parseStep(s, ix);
      if (r.failure) return { failure: r.failure };
      steps.push(r.step);
    }
    needs.push({ id: n.id, ask: n.ask, closing_authority: n.closing_authority, steps,
      customer_inputs: n.customer_inputs ?? [] });
  }
  return needs.length ? { plan: { needs } } : { failure: 'UNPARSEABLE' };
}

export const MAX_NEEDS = 6;
export const MAX_STEPS = 3;

/** The rules a shape cannot carry. Mirrors ResolutionPlanValidator.Code. */
export function validate(plan, ix) {
  const v = [];
  const needs = plan?.needs ?? [];
  if (!needs.length) return [{ need: null, step: null, code: 'NO_NEEDS' }];
  if (needs.length > MAX_NEEDS) v.push({ need: null, step: null, code: 'TOO_MANY_NEEDS' });
  needs.forEach((need, i) => {
    const id = need.id;
    if (id !== `N${i + 1}`) v.push({ need: id, step: null, code: 'NEED_ID_ORDER' });
    if (!need.ask || !need.ask.trim()) v.push({ need: id, step: null, code: 'EMPTY_ASK' });
    const steps = need.steps ?? [];
    if (!steps.length) { v.push({ need: id, step: null, code: 'NO_STEPS' }); return; }
    if (steps.length > MAX_STEPS) v.push({ need: id, step: null, code: 'TOO_MANY_STEPS' });
    // WP-3.1: the declared resolution must be one the plan actually asked for. `NO_CLOSING_STEP` and
    // `MULTIPLE_CLOSING_AUTHORITIES` are gone — a single enum cannot say "none" or "two".
    if (!steps.some((s) => ix.authority.get(s.capability) === need.closing_authority)) {
      v.push({ need: id, step: null, code: 'CLOSING_AUTHORITY_UNSUPPORTED' });
    }
    // a procedure that acts on an order must read that order — an absence rule, not a position rule
    if (need.closing_authority === 'PROCEDURE' && !steps.some((s) => s.capability === 'ENTITY.ORDER')) {
      v.push({ need: id, step: null, code: 'PROCEDURE_WITHOUT_ORDER_READ' });
    }
    // WP-3.2: a procedure is never another authority's optional follow-up. Audited on all 72 gold goals first — the 7
    // that require a procedure are all resolved by it, zero counterexamples. Does NOT catch a follow-up split into a
    // second need (the C6 residual); no per-need rule can.
    if (need.closing_authority !== 'PROCEDURE'
        && steps.some((s) => ix.authority.get(s.capability) === 'PROCEDURE')) {
      v.push({ need: id, step: null, code: 'PROCEDURE_NOT_CLOSING' });
    }
    const seen = [];
    steps.forEach((s, k) => {
      const sig = `${s.capability}/${s.scope}`;
      if (seen.includes(sig)) v.push({ need: id, step: k, code: 'DUPLICATE_STEP' });
      seen.push(sig);
    });
    const inputSeen = new Set();
    for (const i of need.customer_inputs ?? []) {
      if (ix.identity.has(i)) v.push({ need: id, step: null, code: 'IDENTITY_INPUT' });
      if (ix.bridgeOnly.has(i)) v.push({ need: id, step: null, code: 'UNNAMED_INPUT' });
      if (inputSeen.has(i)) v.push({ need: id, step: null, code: 'DUPLICATE_INPUT' });
      inputSeen.add(i);
    }
  });
  return v;
}

/**
 * Project a v2-shaped recorded plan into the WP-3 shapes — the ONLY way to say anything about the frozen shadow under
 * the new contract without calling the model again.
 *
 * <p>Each rule below is a deterministic rewrite, and each is an ESTIMATE of what the model would have emitted had the
 * slot never been offered. The estimate is credible in different degrees and the report says which is which:
 * dropping `effect` and `depends_on` removes slots whose values the new schema has nowhere to put; dropping `fields`
 * from a non-entity step assumes the model filled them only because the slot was required; and replacing the scope of a
 * single-instance capability CORRECTS a value the model chose wrongly, which is the most generous of the three. What it
 * can never do is guess a step the model did not write.
 */
export function project(plan, ix) {
  const changes = { dropped_effect: 0, dropped_depends_on: 0, dropped_fields: 0, corrected_scope: 0,
    dropped_role: 0, closing_authority_from_roles: 0 };
  const needs = (plan?.needs ?? []).map((n) => {
    // WP-3.1: where the older plan said the ending with roles, read it off the roles. Where it said two endings, the
    // projection CANNOT choose one — it reports null and the caller must not pretend otherwise.
    let closing = n.closing_authority ?? null;
    if (closing === null) {
      const closers = [...new Set((n.steps ?? []).filter((s) => s.role === 'CLOSES')
        .map((s) => ix.authority.get(s.capability)))];
      closing = closers.length === 1 ? closers[0] : null;
      if (closing !== null) changes.closing_authority_from_roles++;
    }
    return {
    id: n.id,
    ask: n.ask,
    closing_authority: closing,
    customer_inputs: n.customer_inputs ?? [],
    steps: (n.steps ?? []).map((s) => {
      const out = { capability: s.capability };
      if (s.role !== undefined) changes.dropped_role++;
      if (s.effect !== undefined) changes.dropped_effect++;
      if (s.depends_on !== undefined && s.depends_on !== null) changes.dropped_depends_on++;
      if (isEntity(ix, s.capability)) {
        out.fields = s.fields ?? [];
      } else if ((s.fields ?? []).length) {
        changes.dropped_fields++;
      }
      if (chooses(ix, s.capability)) {
        out.scope = s.scope;
      } else if (s.scope !== undefined && s.scope !== only(ix, s.capability)) {
        // the new shape has no scope slot here at all, so a wrong value simply cannot be carried
        changes.corrected_scope++;
      }
      return out;
    }),
    };
  });
  return { plan: { needs }, changes };
}
