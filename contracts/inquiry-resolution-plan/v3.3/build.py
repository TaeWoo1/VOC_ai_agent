#!/usr/bin/env python3
"""Build resolution-plan gold v3.3 from the frozen v3.2 — a SHAPE change only (Inquiry v3 WP-3.1, Candidate C).

v3.2 said WHICH authority closes a goal by putting role=CLOSES on the steps that do. v3.3 says it in one place: the
goal declares `closing_authority`, and a step is a required capability with no role at all.

Nothing is re-labelled and nothing is guessed. Every transformation is a function of the v3.2 row, and the script
asserts that the transformation is LOSSLESS in both directions:

  forward   closing_authority := the single authority among the row's CLOSES steps. v3.2's own build already asserted
            that there is exactly one, and this script asserts it again rather than trusting it.
  backward  every step whose capability belongs to closing_authority is a closer, and nothing else is. Recomputed for
            every row and compared with v3.2's CLOSES set — 72 of 72 must match, or the representation loses a fact.

  role      : dropped. With the ending declared, PRECONDITION and CONTEXT both mean "a capability this resolution
              requires and which does not end it", and step order already carries execution order. No rule in the
              contract reads the distinction once the closer is named: PROCEDURE_WITHOUT_ORDER_READ asks whether the
              ENTITY.ORDER read is PRESENT, not where it stands.

  Capability, scope, fields, customer inputs, v2_type, status and expected_terminal are carried through untouched, and
  asserted equal.
"""
import json, hashlib, os, sys

AUTH = {'KNOWLEDGE.PRODUCT': 'KNOWLEDGE', 'KNOWLEDGE.CATALOGUE': 'KNOWLEDGE', 'KNOWLEDGE.ORG': 'KNOWLEDGE',
        'ENTITY.ORDER': 'ENTITY_STATE', 'ENTITY.LISTING': 'ENTITY_STATE',
        'PROCEDURE.ORDER_ACTION': 'PROCEDURE', 'SELLER': 'SELLER'}

SRC = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser(
    '~/.sellerops/eval-store/inquiry-resolution-plan/v3.2/plans.jsonl')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/plans-v33.jsonl'

rows = [json.loads(l) for l in open(SRC) if l.strip()]
out = []
for r in rows:
    closing = sorted({AUTH[s['capability']] for s in r['steps'] if s['role'] == 'CLOSES'})
    assert len(closing) == 1, (r['q'], r['goal'], closing)
    ca = closing[0]

    steps = []
    for s in r['steps']:
        t = {'capability': s['capability']}
        if 'scope' in s:
            t['scope'] = s['scope']
        if 'fields' in s:
            t['fields'] = s['fields']
        steps.append(t)

    # LOSSLESS both ways: the CLOSES set must be exactly recoverable from the declared authority
    was = [i for i, s in enumerate(r['steps']) if s['role'] == 'CLOSES']
    now = [i for i, s in enumerate(steps) if AUTH[s['capability']] == ca]
    assert was == now, (r['q'], r['goal'], was, now)

    g = {'q': r['q'], 'goal': r['goal'], 'v2_type': r['v2_type'], 'status': r['status'],
         'closing_authority': ca, 'steps': steps, 'customer_inputs': r['customer_inputs'],
         'expected_terminal': r['expected_terminal']}
    for k in ('q', 'goal', 'v2_type', 'status', 'customer_inputs', 'expected_terminal'):
        assert g[k] == r[k], (r['q'], k)
    assert [s['capability'] for s in steps] == [s['capability'] for s in r['steps']]
    assert [s.get('scope') for s in steps] == [s.get('scope') for s in r['steps']]
    assert [s.get('fields') for s in steps] == [s.get('fields') for s in r['steps']]
    out.append(g)

# the new validator rule must already hold on every frozen row
for g in out:
    assert any(AUTH[s['capability']] == g['closing_authority'] for s in g['steps']), g['q']
    if g['closing_authority'] == 'PROCEDURE':
        assert any(s['capability'] == 'ENTITY.ORDER' for s in g['steps']), g['q']

with open(OUT, 'w') as f:
    for g in out:
        f.write(json.dumps(g, ensure_ascii=False, sort_keys=False) + '\n')
by = {}
for g in out:
    by[g['closing_authority']] = by.get(g['closing_authority'], 0) + 1
print('rows', len(out), 'by closing authority', by,
      'sha256', hashlib.sha256(open(OUT, 'rb').read()).hexdigest())
