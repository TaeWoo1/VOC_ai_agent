#!/usr/bin/env python3
"""Build and CHECK the CustomerGoal remapping of the frozen 72 (Inquiry v3.5 §4). No model call, no network.

This does two things, and the second is the point:

  1. emits goals.jsonl (eval-store) — one CustomerGoal row per frozen resolution goal
  2. asserts the new four-value vocabulary is CONSISTENT with the frozen closing_authority under the deterministic
     ResolutionPolicy. That is a falsifiable check, not a restatement: if a row labelled INFORMATION closes on
     PROCEDURE in the gold, either the label is wrong or the policy is, and the build fails rather than reporting a
     distribution nobody checked.

The expected correspondence is the policy's own dispatch table, read backwards:

    INFORMATION -> KNOWLEDGE          (knowledge resolver closes it)
    STATE_READ  -> ENTITY_STATE
    ACTION      -> PROCEDURE
    DECISION    -> KNOWLEDGE or SELLER  (knowledge first; seller only on an OBSERVED absence)

Rows whose requested_outcome is None are ambiguous and excluded from the check by construction — they are reported,
never guessed.
"""
import json, hashlib, os, sys
from collections import Counter, defaultdict
# The labels are real eval data (designer judgments over real inquiries) and live in the store, never here.
#   node tools/eval-store/store.mjs restore inquiry-customer-goal v1
LABELS = os.environ.get('CUSTOMER_GOAL_LABELS',
                        os.path.expanduser('~/.cache/sellerops-eval/inquiry-customer-goal/v1'))
if not os.path.exists(os.path.join(LABELS, 'labels.py')):
    sys.exit(f'no labels at {LABELS}: run `node tools/eval-store/store.mjs restore inquiry-customer-goal v1`')
sys.path.insert(0, LABELS)
from labels import L, ADJUDICATION

CACHE = os.path.expanduser('~/.cache/sellerops-eval')
GOLD = os.path.join(CACHE, 'inquiry-resolution-plan/v3.3/plans.jsonl')
CAP = os.path.join(CACHE, 'inquiry-planner-capture/v1/capture-S0.jsonl')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/customer-goals-v1.jsonl'

EXPECT = {'INFORMATION': {'KNOWLEDGE'}, 'STATE_READ': {'ENTITY_STATE'},
          'ACTION': {'PROCEDURE'}, 'DECISION': {'KNOWLEDGE', 'SELLER'}}
OUTCOMES = ['INFORMATION', 'STATE_READ', 'DECISION', 'ACTION']
REFERENTS = ['CURRENT_LISTING', 'SELLER_CATALOGUE', 'CURRENT_ORDER', 'ORGANIZATION', 'UNRESOLVED']

gold = [json.loads(l) for l in open(GOLD) if l.strip()]
cap = {json.loads(l)['q']: json.loads(l) for l in open(CAP) if l.strip()}

# --- every frozen goal is labelled exactly once, and nothing is labelled that is not a frozen goal ---
keys = {(g['q'], g['goal']) for g in gold}
assert keys == set(L), ('label/gold mismatch', sorted(keys - set(L)), sorted(set(L) - keys))
assert len(gold) == 72, len(gold)

adjudicated = {r for c in ADJUDICATION.values() for r in c['rows']}
unlabelled = {k for k, v in L.items() if v[0] is None}
assert adjudicated == unlabelled, ('every unlabelled row is adjudicated and vice versa',
                                   sorted(unlabelled - adjudicated), sorted(adjudicated - unlabelled))

rows, violations = [], []
for g in gold:
    k = (g['q'], g['goal'])
    outcome, referent, basis, nconstraints = L[k]
    assert referent in REFERENTS, referent
    assert outcome is None or outcome in OUTCOMES, outcome
    assert basis in (None, 'STATED', 'DIRECTLY_IMPLIED'), basis
    if outcome is not None:
        assert basis is not None, ('a labelled goal records its basis', k)
        if g['closing_authority'] not in EXPECT[outcome]:
            violations.append((k, outcome, g['closing_authority']))
    rows.append({'q': g['q'], 'goal': g['goal'], 'requested_outcome': outcome, 'referent': referent,
                 'basis': basis, 'explicit_constraints': nconstraints,
                 'gold_closing_authority': g['closing_authority'], 'gold_v2_type': g['v2_type'],
                 'gold_terminal': g['expected_terminal'],
                 'adjudication': next((c for c, v in ADJUDICATION.items() if k in v['rows']), None)})

assert not violations, ('outcome does not match the frozen closing authority', violations)

labelled = [r for r in rows if r['requested_outcome']]
per_case = defaultdict(list)
for r in rows:
    per_case[r['q']].append(r)

report = {
    'goals': len(rows), 'cases': len(per_case),
    'settled': len(labelled), 'pending_adjudication': len(rows) - len(labelled),
    'requested_outcome': {o: sum(1 for r in labelled if r['requested_outcome'] == o) for o in OUTCOMES},
    'referent': {x: sum(1 for r in rows if r['referent'] == x) for x in REFERENTS},
    'basis': dict(Counter(r['basis'] for r in labelled)),
    'goals_per_case': dict(sorted(Counter(len(v) for v in per_case.values()).items())),
    'multi_goal_cases': sorted(q for q, v in per_case.items() if len(v) > 1),
    'with_explicit_constraints': sum(1 for r in labelled if r['explicit_constraints'] > 0),
    'constraint_count': dict(sorted(Counter(r['explicit_constraints'] for r in labelled).items())),
    'unmappable': 0,
    'new_enum_values_required': 0,
    'adjudication': {c: {'rows': len(v['rows']), 'candidates': v['candidates']} for c, v in ADJUDICATION.items()},
    'outcome_x_closing_authority': {o: dict(Counter(r['gold_closing_authority']
                                                   for r in labelled if r['requested_outcome'] == o))
                                    for o in OUTCOMES},
}

with open(OUT, 'w') as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + '\n')

print(json.dumps(report, ensure_ascii=False, indent=1))
print('\nsha256', hashlib.sha256(open(OUT, 'rb').read()).hexdigest())
print('wrote', OUT)
