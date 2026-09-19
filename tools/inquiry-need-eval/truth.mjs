// L1 + L2 → the truth for one snapshot: per need, what the snapshot can answer, what should happen next, and how it
// ends once everything acquirable is acquired. Pure: no I/O. Definitions: docs/inquiry_need_eval_v1.md §4.
import { parseRef } from './io.mjs';
import { RANK, bestOf } from './vocabulary.mjs';

const refKey = (ref, product) => `${ref}|${product ?? null}`;

export function stateIndex(snapshot) {
  const idx = new Map(snapshot.refs.map((r) => [refKey(r.ref, r.product), r.state]));
  return (ref, product) => {
    const s = idx.get(refKey(ref, product));
    if (!s) throw new Error(`snapshot ${snapshot.snapshot} has no state for ${ref} on ${product}`);
    return s;
  };
}

/** One evidence_set's status: all of its refs must be there (AND). */
export function setStatus(states) {
  if (states.every((s) => s === 'PRESENT')) return 'AVAILABLE';
  if (states.includes('UNREADABLE')) return 'UNREADABLE';
  if (states.every((s) => s === 'PRESENT' || s === 'ABSENT_ACQUIRABLE')) return 'ACQUIRABLE';
  if (states.includes('PRESENT_OTHER_SCOPE')) return 'OUT_OF_SCOPE';
  return 'NO_SOURCE';
}

export function reusablePrecedents(need, question, precedents, memories) {
  const scope = new Map(precedents.map((p) => [p.memory, p.precedent_scope]));
  const mem = new Map(memories.map((m) => [m.memory, m]));
  return need.precedents.filter((m) => {
    const row = mem.get(m);
    return scope.get(m) === 'REUSABLE' && row
      && (row.product === null || row.product === question.product)
      && !(question.inquiry && row.origin_inquiry === question.inquiry);
  });
}

export function needTruth(need, question, snapshot, ds, state = stateIndex(snapshot)) {
  const sets = need.sets.map((s) => ({
    ...s,
    status: setStatus(s.refs.map((r) => state(r, question.product))),
  }));
  const avail = sets.filter((s) => s.status === 'AVAILABLE' && s.suff in RANK).map((s) => s.suff);
  const acq = sets.filter((s) => s.status === 'ACQUIRABLE' && s.suff in RANK).map((s) => s.suff);
  const unreadable = sets.some((s) => s.status === 'UNREADABLE');
  const outOfScope = need.family_sets.length > 0 || need.family_precedents.length > 0
    || sets.some((s) => s.status === 'OUT_OF_SCOPE');
  const now = bestOf(avail);
  const after = bestOf([...avail, ...acq]);
  const answerability = now ?? (unreadable ? 'UNKNOWN' : 'NONE');
  const acquireHelps = acq.length > 0 && RANK[bestOf(acq)] > (RANK[now] ?? 0);
  const nextStep = now === 'FULL' ? 'ANSWER' : acquireHelps ? 'SYSTEM_ACQUIRE' : now === 'CONDITIONAL' ? 'ASK_CUSTOMER' : 'ASK_SELLER';
  const terminal = after === 'FULL' ? 'ANSWER' : after === 'CONDITIONAL' ? 'ASK_CUSTOMER' : 'ASK_SELLER';
  const sourceState = avail.length ? 'AVAILABLE' : acq.length ? 'ACQUIRABLE' : unreadable ? 'UNREADABLE' : outOfScope ? 'OUT_OF_SCOPE' : 'ABSENT';
  // The knowledge-layer reason a need cannot be closed in THIS snapshot (null when the snapshot can close it).
  const knowledgeGap = answerability === 'FULL' || answerability === 'CONDITIONAL' ? null
    : acquireHelps ? 'NOT_ACQUIRED'
    : now === 'PARTIAL' ? 'PARTIAL_EVIDENCE'
    : unreadable ? 'SOURCE_UNREADABLE'
    : outOfScope ? 'OUT_OF_SCOPE'
    : 'SOURCE_ABSENT';
  // Why it ends with the seller even after acquisition.
  const terminalReason = terminal !== 'ASK_SELLER' ? null
    : after === 'PARTIAL' ? 'PARTIAL_EVIDENCE' : unreadable ? 'SOURCE_UNREADABLE' : outOfScope ? 'OUT_OF_SCOPE' : 'SOURCE_ABSENT';
  return {
    q: need.q, need: need.need, type: need.type, scope: need.scope, sets, answerability, sourceState,
    reachable: avail.length > 0, nextStep, terminal, knowledgeGap, terminalReason,
    precedents: reusablePrecedents(need, question, ds.precedents, snapshot.memories),
    episodic: need.precedents.filter((m) => ds.precedents.find((p) => p.memory === m)?.precedent_scope !== 'REUSABLE'),
  };
}

export function caseTruth(needTruths) {
  const a = needTruths.map((n) => n.answerability);
  const answerability = a.every((x) => x === 'FULL') ? 'FULL'
    : a.every((x) => x === 'FULL' || x === 'CONDITIONAL') ? 'CONDITIONAL'
    : a.every((x) => x === 'NONE') ? 'NONE'
    : a.every((x) => x === 'NONE' || x === 'UNKNOWN') ? 'UNKNOWN'
    : 'PARTIAL';
  const steps = needTruths.map((n) => n.nextStep);
  const nextStep = steps.every((s) => s === 'ANSWER') ? 'ANSWER' : steps.includes('SYSTEM_ACQUIRE') ? 'SYSTEM_ACQUIRE'
    : steps.includes('ASK_SELLER') ? 'ASK_SELLER' : 'ASK_CUSTOMER';
  const terms = needTruths.map((n) => n.terminal);
  const terminal = terms.every((s) => s === 'ANSWER') ? 'ANSWER' : terms.includes('ASK_SELLER') ? 'ASK_SELLER' : 'ASK_CUSTOMER';
  return { answerability, nextStep, terminal };
}

export function deriveTruth(ds, snapshot) {
  const state = stateIndex(snapshot);
  const questions = new Map(ds.questions.map((q) => [q.q, q]));
  const needs = ds.needs.map((n) => needTruth(n, questions.get(n.q), snapshot, ds, state));
  const cases = ds.questions.map((q) => {
    const ns = needs.filter((n) => n.q === q.q);
    return { q: q.q, cluster: q.cluster, canonical: q.canonical, set: q.set, needs: ns.length, ...caseTruth(ns) };
  });
  return { needs, cases };
}

export { parseRef };
