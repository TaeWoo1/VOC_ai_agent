#!/usr/bin/env node
// Resolution-plan gold (Inquiry v3 WP-1): validate the gold, project the v2 bridge onto it, and score a predicted plan
// against it. Offline; no model.
//
// WP-3 NOTE. This file is the WP-2 contract and the POSITIONAL scorer — gold need i compared with predicted need i — and
// it is kept unchanged on purpose, because the wp2-shadow run's published figures were produced by it and a baseline you
// edit is not a baseline. New work uses contract.mjs (the WP-3 step shapes) and goals.mjs (split-tolerant scoring);
// wp3-replay.mjs runs both over the same rows so the difference between them is shown rather than asserted. The only
// edit here is the vocabulary key `step_effects` -> `execution_effects`, which followed the effect moving to the
// registry; the v3.1 gold it reads still carries `effect` on every step and still validates. The vocabulary is contracts/inquiry-authority/v1/vocabulary.json — the same file a Java
// test pins the production enums to.
//
//   node tools/inquiry-need-eval/plan.mjs --plans <plans.jsonl> [--pred <predicted.jsonl>] [--json out.json]
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonl } from './io.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const VOCAB_PATH = join(here, '../../contracts/inquiry-authority/v1/vocabulary.json');
export const loadVocabulary = (p = VOCAB_PATH) => JSON.parse(readFileSync(p, 'utf8'));

const key = (r) => `${r.q}.${r.need}`;

function index(vocab) {
  return {
    capability: new Map(vocab.capabilities.map((c) => [c.id, c.authority])),
    field: new Map(vocab.entity_fields.map((f) => [f.id, f.capability])),
    input: new Map(vocab.customer_inputs.map((i) => [i.id, i.kind])),
    bridgeOnly: new Set(vocab.customer_inputs.filter((i) => i.bridge_only).map((i) => i.id)),
    scope: new Map(Object.entries(vocab.scope_by_capability)),
    effects: new Set(vocab.execution_effects),
    scopes: new Set(vocab.step_scopes),
    states: new Set(vocab.resolution_states),
    gaps: new Set(vocab.gap_reasons),
    roles: new Set(vocab.step_roles),
  };
}

function checkSteps(steps, ix, where, errors) {
  if (!Array.isArray(steps) || !steps.length) {
    errors.push(`${where}: no steps`);
    return;
  }
  if (!steps.some((s) => s.role === 'CLOSES')) errors.push(`${where}: no CLOSES step`);
  steps.forEach((s, i) => {
    const authority = ix.capability.get(s.capability);
    if (!authority) errors.push(`${where}.steps[${i}]: unknown capability ${s.capability}`);
    if (!ix.roles.has(s.role)) errors.push(`${where}.steps[${i}]: unknown role ${s.role}`);
    if (s.fields) {
      if (authority !== 'ENTITY_STATE') errors.push(`${where}.steps[${i}]: fields on a non-entity step`);
      for (const f of s.fields) {
        if (ix.field.get(f) !== s.capability) errors.push(`${where}.steps[${i}]: field ${f} is not ${s.capability}'s`);
      }
    } else if (authority === 'ENTITY_STATE') {
      errors.push(`${where}.steps[${i}]: an entity step names the fields it reads`);
    }
    if (!ix.scopes.has(s.scope)) errors.push(`${where}.steps[${i}]: unknown scope ${s.scope}`);
    else if (authority && !(ix.scope.get(s.capability) ?? []).includes(s.scope)) {
      errors.push(`${where}.steps[${i}]: ${s.capability} is never about ${s.scope}`);
    }
    if (!ix.effects.has(s.effect)) errors.push(`${where}.steps[${i}]: unknown effect ${s.effect}`);
    else if (authority === 'PROCEDURE' && s.effect === 'NONE') {
      // the product owner's invariant: reading entity state is never a procedure
      errors.push(`${where}.steps[${i}]: a procedure states the change it makes`);
    } else if (authority !== 'PROCEDURE' && s.effect !== 'NONE') {
      errors.push(`${where}.steps[${i}]: only a procedure has an effect`);
    }
    if (authority === 'PROCEDURE' && s.role === 'CLOSES'
        && !steps.some((p) => p.capability === 'ENTITY.ORDER' && p.role === 'PRECONDITION')) {
      errors.push(`${where}.steps[${i}]: a procedure reads the order it changes first`);
    }
    if (s.depends_on !== undefined && !(Number.isInteger(s.depends_on) && s.depends_on >= 0 && s.depends_on < i)) {
      errors.push(`${where}.steps[${i}]: depends_on must name an earlier step`);
    }
  });
}

function checkExpected(e, steps, ix, where, errors) {
  if (!e || !ix.states.has(e.state)) {
    errors.push(`${where}: expected_terminal.state invalid`);
    return;
  }
  if ((e.state === 'CAPABILITY_GAP') !== (e.gap !== undefined)) errors.push(`${where}: gap given exactly for CAPABILITY_GAP`);
  if (e.gap !== undefined && !ix.gaps.has(e.gap)) errors.push(`${where}: unknown gap ${e.gap}`);
  const closers = steps.filter((s) => s.role === 'CLOSES').map((s) => ix.capability.get(s.capability));
  if (closers.length && closers.every((a) => a === 'PROCEDURE') && ['RESOLVED', 'RESOLVED_CONDITIONAL'].includes(e.state)) {
    errors.push(`${where}: a procedure without an executor cannot be expected to resolve`);
  }
}

/** Every rule the gold must hold. Returns error strings; empty is valid. */
export function validatePlans(rows, vocab = loadVocabulary()) {
  const ix = index(vocab);
  const errors = [];
  const seen = new Set();
  for (const r of rows) {
    const where = key(r);
    if (seen.has(where)) errors.push(`${where}: duplicate`);
    seen.add(where);
    if (!vocab.v2_bridge[r.v2_type]) errors.push(`${where}: unknown v2_type ${r.v2_type}`);
    if (!['FROZEN', 'PENDING_ADJUDICATION'].includes(r.status)) errors.push(`${where}: status ${r.status}`);
    checkSteps(r.steps, ix, where, errors);
    for (const i of r.customer_inputs ?? []) {
      if (!ix.input.has(i)) errors.push(`${where}: unknown customer input ${i}`);
      else if (!vocab.askable[ix.input.get(i)]) errors.push(`${where}: ${i} is identity — never asked`);
      else if (ix.bridgeOnly.has(i)) errors.push(`${where}: ${i} is the v2 bridge's placeholder — a plan names the input`);
    }
    checkExpected(r.expected_terminal, r.steps ?? [], ix, where, errors);
    if (r.status === 'PENDING_ADJUDICATION') {
      if (!r.pending_reason) errors.push(`${where}: pending without a reason`);
      if (!Array.isArray(r.alternatives) || !r.alternatives.length) errors.push(`${where}: pending without alternatives`);
      for (const [j, a] of (r.alternatives ?? []).entries()) {
        checkSteps(a.steps, ix, `${where}.alt[${j}]`, errors);
        checkExpected(a.expected_terminal, a.steps ?? [], ix, `${where}.alt[${j}]`, errors);
      }
    } else if (r.alternatives || r.pending_reason) {
      errors.push(`${where}: a frozen row carries no alternatives`);
    }
  }
  return errors;
}

const closingAuthorities = (steps, ix) => new Set(steps.filter((s) => s.role === 'CLOSES').map((s) => ix.capability.get(s.capability)));
const allCapabilities = (steps) => new Set(steps.map((s) => s.capability));

/**
 * The v2 bridge (NeedType → capability, AuthorityFence.planned) against the frozen gold: where would the fence hold a
 * need to an authority the gold does not? Pending rows are reported apart and never counted.
 */
export function scoreBridge(rows, vocab = loadVocabulary()) {
  const ix = index(vocab);
  const frozen = rows.filter((r) => r.status === 'FROZEN');
  const disagree = [];
  for (const r of frozen) {
    const bridged = vocab.v2_bridge[r.v2_type];
    const authority = ix.capability.get(bridged);
    if (!closingAuthorities(r.steps, ix).has(authority)) {
      disagree.push({ need: key(r), v2_type: r.v2_type, bridge: bridged, gold: [...allCapabilities(r.steps)] });
    }
  }
  return {
    frozen: frozen.length,
    pending: rows.length - frozen.length,
    authority_agreement: frozen.length ? (frozen.length - disagree.length) / frozen.length : null,
    disagreements: disagree,
  };
}

/**
 * A predicted plan (same row shape, `steps` + `customer_inputs`) against the frozen gold — the A-layer of Eval v2.
 * An ORDER miss is a hard failure: a plan that forgets the order is the plan that lets a company rule answer for it.
 */
export function scorePlans(pred, gold, vocab = loadVocabulary()) {
  const ix = index(vocab);
  const p = new Map(pred.map((r) => [key(r), r]));
  const out = {
    needs: 0, missing_prediction: 0, authority_recall: 0, missing_required_authority: [], unnecessary_authority: 0,
    entity_scope_accuracy: 0, entity_scope_compared: 0, customer_input_correct: 0, sequence_correct: 0,
    sequence_compared: 0, invalid_capability_selection: 0, procedure_for_read: [], order_misses: [],
  };
  for (const g of gold.filter((r) => r.status === 'FROZEN')) {
    out.needs++;
    const r = p.get(key(g));
    if (!r) {
      out.missing_prediction++;
      continue;
    }
    const steps = r.steps ?? [];
    if (steps.some((s) => !ix.capability.has(s.capability))) out.invalid_capability_selection++;
    const need = closingAuthorities(g.steps, ix);
    const got = new Set(steps.map((s) => ix.capability.get(s.capability)));
    if ([...need].every((a) => got.has(a))) out.authority_recall++;
    else out.missing_required_authority.push({ need: key(g), expected: [...need], got: [...got] });
    const goldAny = new Set(g.steps.map((s) => ix.capability.get(s.capability)));
    if ([...got].some((a) => a && !goldAny.has(a))) out.unnecessary_authority++;
    if (!goldAny.has('PROCEDURE') && got.has('PROCEDURE')) out.procedure_for_read.push(key(g));
    if (g.steps.some((s) => s.capability === 'ENTITY.ORDER') && !steps.some((s) => s.capability === 'ENTITY.ORDER')) {
      out.order_misses.push(key(g));
    }
    // entity/scope: for every gold step the prediction also names, is it about the same instance?
    for (const gs of g.steps) {
      const ps = steps.find((s) => s.capability === gs.capability);
      if (!ps) continue;
      out.entity_scope_compared++;
      const sameFields = (gs.fields ?? []).slice().sort().join(',') === (ps.fields ?? []).slice().sort().join(',');
      if (ps.scope === gs.scope && sameFields) out.entity_scope_accuracy++;
    }
    const a = [...(g.customer_inputs ?? [])].sort().join(',');
    const b = [...(r.customer_inputs ?? [])].sort().join(',');
    if (a === b) out.customer_input_correct++;
    // sequence: only where the gold has more than one acting step
    const acting = (xs) => xs.filter((s) => s.role !== 'CONTEXT');
    if (acting(g.steps).length > 1) {
      out.sequence_compared++;
      const seq = (xs) => acting(xs).map((s) => `${s.capability}/${s.role}`).join('>');
      const deps = (xs) => acting(xs).map((s) => (s.depends_on ?? null)).join(',');
      if (seq(g.steps) === seq(steps) && deps(g.steps) === deps(steps)) out.sequence_correct++;
    }
  }
  const n = out.needs - out.missing_prediction;
  const rate = (x, d) => (d ? x / d : null);
  return {
    ...out,
    authority_recall: rate(out.authority_recall, n),
    entity_scope_accuracy: rate(out.entity_scope_accuracy, out.entity_scope_compared),
    customer_input_correct: rate(out.customer_input_correct, n),
    sequence_correct: rate(out.sequence_correct, out.sequence_compared),
  };
}

/**
 * Plan rows as the harness records them (`plan` is the parsed wire shape) → one row per NEED, aligned to the gold by
 * position within the case. Need decomposition itself is reported apart: a plan that splits a message differently is not
 * scored as if its second need were the gold's second need.
 */
export function plansFromObservation(rows, gold) {
  const goldNeeds = new Map();
  for (const g of gold) goldNeeds.set(g.q, [...(goldNeeds.get(g.q) ?? []), g]);
  const out = [];
  const counts = { cases: 0, need_count_match: 0, unusable: 0 };
  for (const row of rows) {
    const want = goldNeeds.get(row.q);
    if (!want) continue;
    counts.cases++;
    const needs = row.plan?.needs ?? [];
    if (!needs.length) { counts.unusable++; continue; }
    if (needs.length === want.length) counts.need_count_match++;
    want.forEach((g, i) => {
      const n = needs[i];
      if (n) out.push({ q: g.q, need: g.need, steps: n.steps, customer_inputs: n.customer_inputs });
    });
  }
  return { rows: out, counts };
}

/**
 * What the deterministic authority layer said (one row per need: q, need, resolution, gap) against the gold terminal.
 * A POSSIBLE gap (ACQUIRABLE: read the detail first; UNREADABLE_SOURCE: a source nothing here reads) that does not match
 * the gold is counted apart as `possible_gap` — the deterministic layer cannot know whether the answer is in that source,
 * and it must not claim either way. Never agreement, never disagreement.
 */
export function compareResolutions(observed, gold, vocab = loadVocabulary()) {
  const want = new Map(gold.filter((r) => r.status === 'FROZEN').map((r) => [key(r), r.expected_terminal]));
  const possible = new Set(vocab.possible_gaps ?? []);
  const out = { compared: 0, agree: 0, possible_gap: 0, differ: [] };
  for (const o of observed) {
    const e = want.get(key(o));
    if (!e) continue;
    out.compared++;
    const got = o.resolution + (o.gap ? `:${o.gap}` : '');
    const exp = e.state + (e.gap ? `:${e.gap}` : '');
    if (got === exp) out.agree++;
    else if (o.resolution === 'CAPABILITY_GAP' && possible.has(o.gap)) out.possible_gap++;
    else out.differ.push({ need: key(o), expected: exp, got });
  }
  return out;
}

/** Distribution of the gold: plan shapes and expected terminals (frozen rows only). */
export function distribution(rows, vocab = loadVocabulary()) {
  const ix = index(vocab);
  const shape = {};
  const terminal = {};
  for (const r of rows.filter((x) => x.status === 'FROZEN')) {
    const s = [...new Set(r.steps.map((x) => ix.capability.get(x.capability)))].join('+') + (r.customer_inputs.length ? '+CUSTOMER_INPUT' : '');
    shape[s] = (shape[s] ?? 0) + 1;
    const t = r.expected_terminal.state + (r.expected_terminal.gap ? `:${r.expected_terminal.gap}` : '');
    terminal[t] = (terminal[t] ?? 0) + 1;
  }
  return { shape, terminal };
}

function main(argv) {
  const arg = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
  const plans = readJsonl(arg('--plans'));
  const vocab = loadVocabulary();
  const errors = validatePlans(plans, vocab);
  const report = { errors, bridge: scoreBridge(plans, vocab), distribution: distribution(plans, vocab) };
  if (arg('--pred')) report.predicted = scorePlans(readJsonl(arg('--pred')), plans, vocab);
  const text = JSON.stringify(report, null, 1);
  if (arg('--json')) writeFileSync(arg('--json'), text + '\n');
  console.log(text);
  return errors.length ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
