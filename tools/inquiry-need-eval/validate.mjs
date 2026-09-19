#!/usr/bin/env node
// Validate an Inquiry Need Eval dataset (L1). Pure: reads three files, touches nothing.
//   node tools/inquiry-need-eval/validate.mjs <dataset-dir>
import { loadDataset, parseRef } from './io.mjs';
import { NEED_TYPES, SCOPES, REF_KINDS, SUFFICIENCY, PRECEDENT_SCOPES } from './vocabulary.mjs';

const HEX8 = /^[0-9a-f]{8}$/;
/** A label file holds judgments, not customer data. These keys never belong in L1. */
const FORBIDDEN_KEYS = ['body', 'title', 'customer', 'answer_body', 'email', 'phone', 'address', 'name'];
/** Order numbers, tracking numbers, phone numbers — the shapes that must not appear in a need's words. */
const PII_SHAPES = [/\d{8,}/, /\d{2,3}-\d{3,4}-\d{4}/, /@[a-z0-9-]+\./i];

export function validate(ds) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const qids = new Set();
  const clusters = new Map();
  for (const q of ds.questions) {
    const w = `question ${q.q}`;
    if (!q.q || qids.has(q.q)) err(w, 'missing or duplicate q');
    qids.add(q.q);
    if (!['R', 'S'].includes(q.set)) err(w, 'set must be R (real) or S (synthetic)');
    if (typeof q.cluster !== 'string') err(w, 'cluster required');
    if (typeof q.canonical !== 'boolean') err(w, 'canonical must be boolean');
    if (q.product !== null && !HEX8.test(q.product ?? '')) err(w, 'product must be 8 hex chars or null');
    if (q.set === 'R' && ('text' in q)) err(w, 'a real inquiry carries no text in L1 — it is read by id at run time');
    if (q.set === 'R' && !HEX8.test(q.inquiry ?? '')) err(w, 'real question needs inquiry id');
    if (q.set === 'S' && typeof q.text !== 'string') err(w, 'synthetic question needs text');
    const c = clusters.get(q.cluster) ?? [];
    c.push(q);
    clusters.set(q.cluster, c);
  }
  for (const [c, qs] of clusters) {
    if (qs.filter((q) => q.canonical).length !== 1) err(`cluster ${c}`, 'exactly one canonical question per cluster');
  }
  const memories = new Map();
  for (const p of ds.precedents) {
    if (!HEX8.test(p.memory ?? '') || memories.has(p.memory)) err(`precedent ${p.memory}`, 'bad or duplicate memory id');
    if (!PRECEDENT_SCOPES.includes(p.precedent_scope)) err(`precedent ${p.memory}`, `precedent_scope ∉ ${PRECEDENT_SCOPES}`);
    memories.set(p.memory, p);
  }
  const seen = new Set();
  const perQuestion = new Map();
  for (const n of ds.needs) {
    const w = `need ${n.q}.${n.need}`;
    if (!qids.has(n.q)) err(w, 'unknown question');
    if (seen.has(`${n.q}.${n.need}`)) err(w, 'duplicate need id');
    seen.add(`${n.q}.${n.need}`);
    perQuestion.set(n.q, (perQuestion.get(n.q) ?? 0) + 1);
    if (typeof n.ask !== 'string' || !n.ask.trim() || n.ask.length > 120) err(w, 'ask must be 1..120 chars');
    if (!NEED_TYPES.includes(n.type)) err(w, `type ∉ ${NEED_TYPES}`);
    if (!SCOPES.includes(n.scope)) err(w, `scope ∉ ${SCOPES} (PRODUCT_FAMILY belongs in family_sets)`);
    for (const k of FORBIDDEN_KEYS) if (k in n) err(w, `forbidden key ${k}`);
    for (const text of [n.ask, n.note].filter(Boolean)) {
      for (const shape of PII_SHAPES) if (shape.test(text)) err(w, `text matches a PII shape ${shape}`);
    }
    for (const field of ['sets', 'family_sets']) {
      if (!Array.isArray(n[field])) {
        err(w, `${field} must be an array`);
        continue;
      }
      n[field].forEach((s, i) => {
        const sw = `${w} ${field}[${i}]`;
        if (!Array.isArray(s.refs) || !s.refs.length) err(sw, 'refs must be a non-empty array (AND)');
        if (!SUFFICIENCY.includes(s.suff)) err(sw, `suff ∉ ${SUFFICIENCY}`);
        const kinds = (s.refs ?? []).map((r) => parseRef(r)?.kind);
        for (const r of s.refs ?? []) {
          const p = parseRef(r);
          if (!p || !(p.kind in REF_KINDS)) err(sw, `unparseable ref ${r}`);
          else if (p.kind !== 'C24' && !HEX8.test(p.id)) err(sw, `ref id must be 8 hex: ${r}`);
          else if (['OPT', 'ADDON', 'FACT'].includes(p.kind) && !p.pattern) err(sw, `${p.kind} needs #pattern: ${r}`);
        }
        const unreadable = kinds.some((k) => k === 'IMG' || k === 'C24');
        if (unreadable !== (s.suff === 'UNKNOWN')) err(sw, 'UNKNOWN ⇔ the set contains an unreadable ref (IMG/C24)');
      });
    }
    for (const field of ['precedents', 'family_precedents']) {
      if (!Array.isArray(n[field])) err(w, `${field} must be an array`);
      for (const m of n[field] ?? []) if (!memories.has(m)) err(w, `${field} names unknown memory ${m}`);
    }
  }
  for (const q of qids) if (!perQuestion.get(q)) err(`question ${q}`, 'has no need');
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: validate.mjs <dataset-dir>');
    process.exit(2);
  }
  const ds = loadDataset(dir);
  const errors = validate(ds);
  const canonical = ds.questions.filter((q) => q.canonical).map((q) => q.q);
  console.log(JSON.stringify({
    dataset_hash: ds.hash, files: ds.files, raw_questions: ds.questions.length,
    canonical_cases: canonical.length, needs: ds.needs.length,
    canonical_needs: ds.needs.filter((n) => canonical.includes(n.q)).length, errors: errors.length,
  }, null, 1));
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(errors.length ? 1 : 0);
}
