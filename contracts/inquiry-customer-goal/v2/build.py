#!/usr/bin/env python3
"""Build and CHECK the CustomerGoal gold v2 — classes A/B/C adjudicated (Inquiry v3.5). No model call, no network.

v1 froze 60 rows and left 12 under adjudication. The product owner decided A, B and C on 2026-09-20; D, E and F stay
open. v1 is NOT withdrawn — it is what the contract was designed against and it stays readable.

Three checks, and the second is the one the ruling added:

  1. every frozen resolution goal is labelled exactly once, and nothing is labelled that is not one
  2. UNDECLARED CONFLICTS = 0. Where an adjudicated outcome no longer implies the frozen closing_authority, the row
     must appear in LEGACY_CONFLICTS with a reason. The ruling was explicit that the old closing-authority gold must
     not be silently forced to remain valid, so the check no longer asserts agreement — it asserts that every
     disagreement is WRITTEN DOWN. A new disagreement nobody declared still fails the build.
  3. a row emits a goal, or is declared NO_GOAL, or is still open — never two of those, never none.

It also runs the DECISION PREREQUISITE AUDIT: for every DECISION goal, which non-KNOWLEDGE, non-SELLER capabilities
does the frozen gold say its resolution requires? That question is answered from the recorded steps, not from an
opinion about what a decision needs.
"""
import json, hashlib, os, sys
from collections import Counter, defaultdict

CACHE = os.path.expanduser('~/.cache/sellerops-eval')
GOLD = os.path.join(CACHE, 'inquiry-resolution-plan/v3.3/plans.jsonl')
LABELS = os.environ.get('CUSTOMER_GOAL_LABELS', os.path.join(CACHE, 'inquiry-customer-goal/v2'))
if not os.path.exists(os.path.join(LABELS, 'labels.py')):
    sys.exit(f'no labels at {LABELS}: run `node tools/eval-store/store.mjs restore inquiry-customer-goal v2`')
sys.path.insert(0, LABELS)
from labels import L, ADJUDICATION, DECIDED_NO_GOAL, LEGACY_CONFLICTS

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/customer-goals-v2.jsonl'
EXPECT = {'INFORMATION': {'KNOWLEDGE'}, 'STATE_READ': {'ENTITY_STATE'},
          'ACTION': {'PROCEDURE'}, 'DECISION': {'KNOWLEDGE', 'SELLER'}}
OUTCOMES = ['INFORMATION', 'STATE_READ', 'DECISION', 'ACTION']
REFERENTS = ['CURRENT_LISTING', 'SELLER_CATALOGUE', 'CURRENT_ORDER', 'ORGANIZATION', 'UNRESOLVED']
AUTH = {'KNOWLEDGE.PRODUCT': 'KNOWLEDGE', 'KNOWLEDGE.CATALOGUE': 'KNOWLEDGE', 'KNOWLEDGE.ORG': 'KNOWLEDGE',
        'ENTITY.ORDER': 'ENTITY_STATE', 'ENTITY.LISTING': 'ENTITY_STATE',
        'PROCEDURE.ORDER_ACTION': 'PROCEDURE', 'SELLER': 'SELLER'}

gold = [json.loads(l) for l in open(GOLD) if l.strip()]
keys = {(g['q'], g['goal']) for g in gold}
assert keys == set(L), ('label/gold mismatch', sorted(keys ^ set(L)))
assert len(gold) == 72

open_rows = {r for c in ADJUDICATION.values() for r in c['rows']}
unlabelled = {k for k, v in L.items() if v[0] is None}
assert open_rows | set(DECIDED_NO_GOAL) == unlabelled, ('every unlabelled row is either decided NO_GOAL or open',
                                                        sorted(unlabelled ^ (open_rows | set(DECIDED_NO_GOAL))))
assert not (open_rows & set(DECIDED_NO_GOAL)), 'a row cannot be both decided and open'

rows, undeclared = [], []
for g in gold:
    k = (g['q'], g['goal'])
    outcome, referent, basis, n = L[k]
    assert referent in REFERENTS and (outcome is None or outcome in OUTCOMES)
    assert basis in (None, 'STATED', 'DIRECTLY_IMPLIED')
    conflict = LEGACY_CONFLICTS.get(k)
    if outcome is not None:
        assert basis is not None, ('a labelled goal records its basis', k)
        agrees = g['closing_authority'] in EXPECT[outcome]
        if not agrees and not conflict:
            undeclared.append((k, outcome, g['closing_authority']))
        if agrees and conflict:
            undeclared.append((k, 'DECLARED A CONFLICT THAT IS NOT ONE', outcome))
    elif k in DECIDED_NO_GOAL and not conflict:
        undeclared.append((k, 'NO_GOAL', g['closing_authority']))
    rows.append({
        'q': g['q'], 'goal': g['goal'],
        'adjudicated': k not in open_rows,
        'emits_goal': outcome is not None,
        'requested_outcome': outcome, 'referent': referent, 'basis': basis, 'explicit_constraints': n,
        'no_goal_reason': DECIDED_NO_GOAL.get(k),
        'open_class': next((c for c, v in ADJUDICATION.items() if k in v['rows']), None),
        'legacy_conflict': conflict[0] if conflict else None,
        'legacy_conflict_why': conflict[1] if conflict else None,
        'gold_closing_authority': g['closing_authority'], 'gold_v2_type': g['v2_type'],
        'gold_steps': [s['capability'] for s in g['steps']], 'gold_terminal': g['expected_terminal'],
    })

assert not undeclared, ('a disagreement with the frozen gold that nobody declared', undeclared)

emitted = [r for r in rows if r['emits_goal']]
per_case = defaultdict(list)
for r in rows:
    per_case[r['q']].append(r)

# --- DECISION prerequisite audit -------------------------------------------------------------------------------
# For every DECISION goal: what does the FROZEN gold say its resolution requires, beyond knowledge and the seller?
decision_audit = []
for r in rows:
    if r['requested_outcome'] != 'DECISION':
        continue
    pre = [c for c in r['gold_steps'] if AUTH[c] not in ('KNOWLEDGE', 'SELLER')]
    decision_audit.append({'q': r['q'], 'goal': r['goal'], 'gold_steps': r['gold_steps'],
                           'non_knowledge_prerequisites': pre, 'needs_observed_state': bool(pre)})

report = {
    'gold_rows': len(rows), 'cases': len(per_case),
    'goals_emitted': len(emitted),
    'decided_no_goal': sum(1 for r in rows if r['no_goal_reason']),
    'still_open': sum(1 for r in rows if r['open_class']),
    'cases_with_zero_goals': sorted(q for q, v in per_case.items() if not any(x['emits_goal'] for x in v)),
    'requested_outcome': {o: sum(1 for r in emitted if r['requested_outcome'] == o) for o in OUTCOMES},
    'referent': {x: sum(1 for r in emitted if r['referent'] == x) for x in REFERENTS},
    'basis': dict(Counter(r['basis'] for r in emitted)),
    'legacy_conflicts': {r['q'] + ' ' + r['goal']: r['legacy_conflict'] for r in rows if r['legacy_conflict']},
    'legacy_conflict_kinds': dict(Counter(r['legacy_conflict'] for r in rows if r['legacy_conflict'])),
    'undeclared_conflicts': 0,
    'decision_prerequisite_audit': {
        'decision_goals': len(decision_audit),
        'needing_observed_state': sum(1 for d in decision_audit if d['needs_observed_state']),
        'rows': decision_audit,
    },
    'still_open_classes': {c: [f'{q} {g}' for q, g in v['rows']] for c, v in ADJUDICATION.items()},
}

with open(OUT, 'w') as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + '\n')

print(json.dumps(report, ensure_ascii=False, indent=1))
print('\nsha256', hashlib.sha256(open(OUT, 'rb').read()).hexdigest())
