#!/usr/bin/env python3
"""Build and CHECK the CustomerGoal gold v3 — every class adjudicated (Inquiry v3.5). No model call, no network.

v1 froze 60 rows and left 12 open. v2 closed A, B and C. v3 closes D, E and F, so **no row is under adjudication**
and the acceptance target for this package — unresolved semantic annotation = 0 — is a measured number rather than
a claim. v1 and v2 are NOT withdrawn: they are what the contract was designed and then re-adjudicated against, and
both stay readable.

The unit changed for one row and one reason. A message can carry more than one goal, and one of the 72 ranks its
two requests ("send just the nozzle; if that is impossible, refund me"), so a row's label is now a LIST of goals and
the ranking lives in RELATIONS. Held as two equal goals that message is a refund waiting to be issued by accident.

Five checks:

  1. every frozen resolution goal is labelled exactly once, and nothing is labelled that is not one
  2. nothing is open — ADJUDICATION is empty, and a row emits goals or is declared NO_GOAL, never neither and never
     both
  3. UNDECLARED CONFLICTS = 0. Where an adjudicated goal no longer follows from the frozen row, the row must appear
     in LEGACY_CONFLICTS with a reason. Two ways to no longer follow are checked:
       a. the CLOSER — the frozen closing_authority is not the one this outcome requires
       b. the INSTANCE — a frozen step reads something the adjudicated referent is not about
     The ruling was explicit that the old gold must not be silently forced to remain valid, so the check does not
     assert agreement; it asserts that every disagreement is written down. A new one nobody declared fails the build.
  4. RELATIONS are customer-stated rankings and nothing else: both goals exist in the same row, a goal has at most
     one fallback and is at most one goal's fallback, and no chain returns to its primary.
  5. the DECISION PREREQUISITE AUDIT: for every DECISION goal, which non-KNOWLEDGE, non-SELLER capabilities does the
     frozen gold say its resolution requires? Answered from the recorded steps, not from an opinion about decisions.
"""
import json, hashlib, os, sys
from collections import Counter

CACHE = os.path.expanduser('~/.cache/sellerops-eval')
GOLD = os.path.join(CACHE, 'inquiry-resolution-plan/v3.3/plans.jsonl')
LABELS = os.environ.get('CUSTOMER_GOAL_LABELS', os.path.join(CACHE, 'inquiry-customer-goal/v3'))
if not os.path.exists(os.path.join(LABELS, 'labels.py')):
    sys.exit(f'no labels at {LABELS}: run `node tools/eval-store/store.mjs restore inquiry-customer-goal v3`')
sys.path.insert(0, LABELS)
from labels import L, RELATIONS, ADJUDICATION, NO_GOAL, LEGACY_CONFLICTS

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/customer-goals-v3.jsonl'
EXPECT = {'INFORMATION': {'KNOWLEDGE'}, 'STATE_READ': {'ENTITY_STATE'},
          'ACTION': {'PROCEDURE'}, 'DECISION': {'KNOWLEDGE', 'SELLER'}}
OUTCOMES = ['INFORMATION', 'STATE_READ', 'DECISION', 'ACTION']
REFERENTS = ['CURRENT_LISTING', 'SELLER_CATALOGUE', 'CURRENT_ORDER', 'ORGANIZATION', 'UNRESOLVED']
# Mirrors ReferentRegistry: what a resolver can be about. Written here so the build can ask question 3b offline.
ABOUT = {'CURRENT_LISTING': {'KNOWLEDGE.PRODUCT', 'KNOWLEDGE.CATALOGUE', 'ENTITY.LISTING', 'SELLER'},
         'SELLER_CATALOGUE': {'KNOWLEDGE.CATALOGUE', 'SELLER'},
         'CURRENT_ORDER': {'ENTITY.ORDER', 'PROCEDURE.ORDER_ACTION', 'KNOWLEDGE.ORG', 'SELLER'},
         'ORGANIZATION': {'KNOWLEDGE.ORG', 'SELLER'},
         'UNRESOLVED': set()}
AUTH = {'KNOWLEDGE.PRODUCT': 'KNOWLEDGE', 'KNOWLEDGE.CATALOGUE': 'KNOWLEDGE', 'KNOWLEDGE.ORG': 'KNOWLEDGE',
        'ENTITY.ORDER': 'ENTITY_STATE', 'ENTITY.LISTING': 'ENTITY_STATE',
        'PROCEDURE.ORDER_ACTION': 'PROCEDURE', 'SELLER': 'SELLER'}

gold = [json.loads(l) for l in open(GOLD) if l.strip()]
keys = {(g['q'], g['goal']) for g in gold}
assert keys == set(L), ('label/gold mismatch', sorted(keys ^ set(L)))
assert len(gold) == 72

# 2. nothing is open.
assert not ADJUDICATION, ('v3 closes every class; an open one means the target was claimed, not met', ADJUDICATION)
empty = {k for k, v in L.items() if not v}
assert empty == set(NO_GOAL), ('a row emits goals or is declared NO_GOAL', sorted(empty ^ set(NO_GOAL)))

rows, undeclared = [], []
for g in gold:
    k = (g['q'], g['goal'])
    conflict = LEGACY_CONFLICTS.get(k)
    goals = L[k]
    seen_gids = set()
    rels = RELATIONS.get(k, [])
    common = {'q': g['q'], 'goal': g['goal'],
              'legacy_conflict': conflict[0] if conflict else None,
              'legacy_conflict_why': conflict[1] if conflict else None,
              'gold_closing_authority': g['closing_authority'], 'gold_v2_type': g['v2_type'],
              'gold_steps': [s['capability'] for s in g['steps']], 'gold_terminal': g['expected_terminal']}
    if not goals:
        # The row stays in the corpus and says what it is. A NO_GOAL row is not assignable, so every goal a model
        # emits on it is invented by definition — which is only measurable if the row is present.
        rows.append({**common, 'gid': g['goal'], 'emits_goal': False, 'requested_outcome': None, 'referent': None,
                     'basis': None, 'explicit_constraints': 0, 'no_goal_reason': NO_GOAL[k],
                     'fallback_of': None, 'has_fallback': None})
    for gid, outcome, referent, basis, n in goals:
        assert gid not in seen_gids, ('two goals of one row share a gid', k, gid)
        seen_gids.add(gid)
        assert outcome in OUTCOMES and referent in REFERENTS, (k, outcome, referent)
        assert basis in ('STATED', 'DIRECTLY_IMPLIED'), ('a goal records its basis', k)
        assert isinstance(n, int) and n >= 0
        rows.append({**common, 'gid': gid, 'emits_goal': True, 'requested_outcome': outcome, 'referent': referent,
                     'basis': basis, 'explicit_constraints': n, 'no_goal_reason': None,
                     'fallback_of': next((p for _, p, f in rels if f == gid), None),
                     'has_fallback': next((f for _, p, f in rels if p == gid), None)})

    # 3. does the frozen row still follow?
    closer_ok = any(g['closing_authority'] in EXPECT[o] for _, o, _, _, _ in goals) if goals else False
    steps = {s['capability'] for s in g.get('steps', [])}
    instance_ok = any(steps <= ABOUT[r] for _, _, r, _, _ in goals) if goals else False
    one_goal = len(goals) == 1
    follows = bool(goals) and closer_ok and instance_ok and one_goal
    if not follows and not conflict:
        undeclared.append((k, g['closing_authority'], sorted(steps), [o for _, o, _, _, _ in goals]))
    if follows and conflict:
        undeclared.append((k, 'DECLARED BUT AGREES', conflict[0], None))

assert not undeclared, ('every disagreement with the frozen gold is declared, and every declaration is real',
                        undeclared)

# 4. relations.
relation_count = 0
for k, rels in RELATIONS.items():
    assert k in L, ('a relation on a row that does not exist', k)
    gids = {gid for gid, *_ in L[k]}
    primaries, fallbacks, edges = set(), set(), {}
    for kind, primary, fallback in rels:
        relation_count += 1
        assert kind == 'FALLBACK', ('the only relationship a customer states', kind)
        assert primary in gids and fallback in gids, ('a relation names goals this message does not carry', k)
        assert primary != fallback, ('a goal is not its own fallback', k)
        assert primary not in primaries, ('one goal cannot have two fallbacks', k, primary)
        assert fallback not in fallbacks, ("one goal cannot be two goals' fallback", k, fallback)
        primaries.add(primary); fallbacks.add(fallback); edges[primary] = fallback
    for start in list(edges):
        at, hops = edges[start], 0
        while at in edges and hops <= len(edges):
            at = edges[at]; hops += 1
            assert at != start, ('a fallback chain cannot return to its primary', k)

# 5. DECISION prerequisite audit — measured from the frozen steps.
audit = {}
for r in rows:
    if r['requested_outcome'] != 'DECISION':
        continue
    other = sorted({c for c in r['gold_steps'] if AUTH[c] not in ('KNOWLEDGE', 'SELLER')})
    audit[f"{r['q']} {r['goal']}"] = other

with open(OUT, 'w') as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + '\n')

emitted = [r for r in rows if r['emits_goal']]
outcomes = Counter(r['requested_outcome'] for r in emitted)
referents = Counter(r['referent'] for r in emitted)
basis = Counter(r['basis'] for r in emitted)
multi = sum(1 for v in L.values() if len(v) > 1)
print(json.dumps({
    'gold_rows': len(gold),
    'cases': len({g['q'] for g in gold}),
    'goals_emitted': len(emitted),
    'no_goal_rows': len(NO_GOAL),
    'still_open': sum(len(c['rows']) for c in ADJUDICATION.values()),
    'multi_goal_rows': multi,
    'explicit_fallback_relations': relation_count,
    'outcomes': dict(outcomes),
    'referents': dict(referents),
    'basis': dict(basis),
    'legacy_conflicts': len(LEGACY_CONFLICTS),
    'undeclared_conflicts': len(undeclared),
    'decision_goals': len(audit),
    'decision_goals_needing_observed_state': sum(1 for v in audit.values() if v),
    'decision_prerequisite_audit': audit,
    'sha256': hashlib.sha256(open(OUT, 'rb').read()).hexdigest(),
    'out': OUT,
}, ensure_ascii=False, indent=1))
