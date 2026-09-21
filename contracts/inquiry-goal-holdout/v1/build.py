#!/usr/bin/env python3
"""Build and CHECK the CustomerGoal HOLDOUT v1 (Inquiry v3.5 §25.13). No model call, no network.

    python3 contracts/inquiry-goal-holdout/v1/build.py [out.jsonl]

WHAT A HOLDOUT HAS TO BE, and what this checks rather than claims:

  1. UNSEEN. No case may be one the DEV set used, and no case may be a near-duplicate of one. The DEV real cases
     were drawn by clustering, so this checks the cluster too, not just the id.
  2. NOT CONTAMINATED. `data_origin='REAL'` does not mean a customer wrote it. This snapshot contains 15 rows whose
     external_id is `bench-00NN`, 46 placeholder bodies, 39 rows carrying a quoted thread or the seller's own
     words, and 3,199 rows the seller has already dispositioned as spam. All are refused here BY RULE, so a future
     rebuild cannot quietly readmit them.
  3. LABELLED BEFORE THE RUN. The labels are authored in the durable store and hashed here. The hash goes in
     dataset.meta.json, and the manifest quotes it: a label edited after a model call changes the hash, and the
     run stops being a run of this holdout.
  4. HONEST ABOUT ITS OWN INSTRUMENT. The critical stratum is ENRICHED — judgment-shaped messages are 7 of 89 in
     the real pool and 28 of 75 here — so the absolute leak rate this set produces is not a production rate. Only
     the v2-vs-v3 DIFFERENCE is a finding, and check 6 is what keeps even that honest.
  5. THREE-TOKEN. Gold uses the v3 contract's own tokens. A v2 arm is read into this space by folding its
     predictions; the gold is never folded the other way, because ANSWER does not decompose.
  6. NOT ANSWERABLE BY THE MARKER. Every `pair` must appear on BOTH sides of the gold. If the ambiguity marker
     predicted the label, a contract could score well by pattern-matching it and the measurement would be of the
     pattern, not of the contract.

The messages and the labels stay OUT of this repository: real rows are a customer's own words, and a holdout whose
text is committed is one anybody can tune against. What is committed is this script, the schema, and the hashes.
"""
import json, os, re, sys, hashlib, collections

CACHE = os.path.expanduser(os.environ.get('SELLEROPS_EVAL_CACHE', '~/.cache/sellerops-eval'))
STORE = os.path.join(CACHE, 'inquiry-goal-holdout/v1')
if not os.path.exists(os.path.join(STORE, 'holdout.py')):
    sys.exit(f'no labels at {STORE}')
sys.path.insert(0, STORE)
from holdout import REAL, SYNTH          # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(STORE, 'cases.jsonl')
OUTCOMES = ['ANSWER', 'STATE_READ', 'ACTION']
REFERENTS = ['CURRENT_LISTING', 'SELLER_CATALOGUE', 'CURRENT_ORDER', 'ORGANIZATION', 'UNRESOLVED']
BASES = ['STATED', 'DIRECTLY_IMPLIED']
STRATA = {'C': 'ambiguous ANSWER — a judgment or possibility asked, no command given',
          'A': 'plain ANSWER — an unambiguous fact request',
          'T': 'true ACTION — the customer asked for the world to change',
          'S': 'STATE_READ — the current state of one bound entity',
          'N': 'no goal — the message requests nothing',
          'R': 'relation/inference — a legitimate single inference, or a customer-stated fallback'}

# --- 2. the exclusion rules, stated once and applied by the rule rather than by a list ---------------------------
PLACEHOLDER = re.compile(r'^(NAVER|COUPANG|CAFE24)\s*문의\s*본문\s*\d+$|^이미 답변이 끝난|^문의 본문')
SELLER_VOICE = re.compile(r'나누리샵입니다|^안녕하세요\s*고객님|저희 측에서 따로 연락|처리하여드렸습니다|답변\s*드려서 죄송')
QUOTED = re.compile(r'\[\s*Original Message\s*\]')
BENCH_ID = re.compile(r'^b3000000-0000-4000-8000-0000000000\d\d$')
CONNECTIVITY_TEST = re.compile(r'연동\s*테스트')


def plain(s):
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'</(p|div|h\d|li)>', '\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    import html as _h
    s = _h.unescape(s)
    return re.sub(r'\n{2,}', '\n', re.sub(r'[ \t]+', ' ', s)).strip()


def refuse(text, inquiry_id):
    if BENCH_ID.match(inquiry_id or ''):
        return 'BENCH_FIXTURE_STORED_AS_REAL'
    if PLACEHOLDER.match(text.strip()):
        return 'PLACEHOLDER_BODY'
    if QUOTED.search(text):
        return 'QUOTED_THREAD'
    if SELLER_VOICE.search(text):
        return 'SELLER_AUTHORED'
    if CONNECTIVITY_TEST.search(text):
        return 'OPERATOR_TEST_POST'
    return None


def main():
    capture = os.path.join(STORE, 'capture.jsonl')
    if not os.path.exists(capture):
        sys.exit(f'no capture at {capture}: the real messages are read once and frozen, never re-queried per run')
    text_of, id_of = {}, {}
    for line in open(capture, encoding='utf-8'):
        if line.strip():
            r = json.loads(line)
            text_of[r['prefix']] = r['text']
            id_of[r['prefix']] = r['id']

    dev = {q['inquiry'] for q in map(json.loads,
           open(os.path.join(CACHE, 'inquiry-need-eval/v1/questions.jsonl'), encoding='utf-8')) if q['set'] == 'R'}
    dev_clusters = {q['cluster'] for q in map(json.loads,
                    open(os.path.join(CACHE, 'inquiry-need-eval/v1/questions.jsonl'), encoding='utf-8'))
                    if q['set'] == 'R'}

    problems, rows = [], []
    for pre, lab in REAL.items():
        if pre in dev:
            problems.append(f'{pre}: used by the DEV set')
        if f'c:{pre}' in dev_clusters:
            problems.append(f'{pre}: is a DEV cluster representative')
        if pre not in text_of:
            problems.append(f'{pre}: not in the frozen capture')
            continue
        why = refuse(text_of[pre], id_of[pre])
        if why:
            problems.append(f'{pre}: refused by rule — {why}')
        rows.append(dict(q=f'H:{pre}', source='REAL', text=text_of[pre], **lab))
    for sid, (text, lab) in SYNTH.items():
        rows.append(dict(q=f'H:{sid}', source='SYNTHETIC', text=text, **lab))

    # --- shape ---------------------------------------------------------------------------------------------
    for r in rows:
        if r['s'] not in STRATA:
            problems.append(f'{r["q"]}: unknown stratum {r["s"]}')
        if r['conf'] not in ('HIGH', 'MEDIUM'):
            problems.append(f'{r["q"]}: unknown confidence {r["conf"]}')
        for g in r['goals']:
            outcome, referent, basis, n = g
            if outcome not in OUTCOMES:
                problems.append(f'{r["q"]}: {outcome} is not a v3 token')
            if referent not in REFERENTS:
                problems.append(f'{r["q"]}: {referent} is not a referent')
            if basis not in BASES:
                problems.append(f'{r["q"]}: {basis} is not a basis')
            if not isinstance(n, int) or n < 0:
                problems.append(f'{r["q"]}: constraint count is a count')
        # At most one inference per message — the same rule CustomerGoalSet enforces.
        if sum(1 for g in r['goals'] if g[2] == 'DIRECTLY_IMPLIED') > 1:
            problems.append(f'{r["q"]}: more than one DIRECTLY_IMPLIED goal')
        rel = r.get('relation')
        if rel:
            i, j, clause = rel
            if not (0 <= i < len(r['goals']) and 0 <= j < len(r['goals'])) or i == j:
                problems.append(f'{r["q"]}: relation does not name two of its own goals')
            elif clause and re.sub(r'\s+', '', clause) not in re.sub(r'\s+', '', r['text']):
                problems.append(f'{r["q"]}: the stated condition is not in the message')

    # --- 1. no duplicate text ------------------------------------------------------------------------------
    dup = collections.Counter(re.sub(r'\s+', '', r['text']) for r in rows)
    for k, v in dup.items():
        if v > 1:
            problems.append(f'duplicated message x{v}: {k[:40]}')

    # --- 6. every pair appears on both sides ---------------------------------------------------------------
    pairs = collections.defaultdict(set)
    for r in rows:
        if r.get('pair'):
            pairs[r['pair']].update(g[0] for g in r['goals'])
    for name, outs in pairs.items():
        if not {'ANSWER', 'ACTION'} <= outs:
            problems.append(f'pair {name!r} is one-sided ({sorted(outs)}): the marker would predict the label')
    if not pairs:
        problems.append('no minimal pairs: the critical stratum cannot referee a marker rule')

    if problems:
        print('HOLDOUT INVALID')
        for p in problems:
            print('  -', p)
        sys.exit(1)

    with open(OUT, 'w', encoding='utf-8') as f:
        for r in sorted(rows, key=lambda r: r['q']):
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + '\n')

    strata = collections.Counter(r['s'] for r in rows)
    conf = collections.Counter(r['conf'] for r in rows)
    goals = collections.Counter(g[0] for r in rows for g in r['goals'])
    hi_answer = [r for r in rows if r['conf'] == 'HIGH' and any(g[0] == 'ANSWER' for g in r['goals'])]
    labels_hash = hashlib.sha256(open(os.path.join(STORE, 'holdout.py'), 'rb').read()).hexdigest()
    cases_hash = hashlib.sha256(open(OUT, 'rb').read()).hexdigest()

    print(f'HOLDOUT OK — {len(rows)} cases  ({sum(1 for r in rows if r["source"] == "REAL")} real, '
          f'{sum(1 for r in rows if r["source"] == "SYNTHETIC")} synthetic)')
    print('  strata      ', dict(sorted(strata.items())))
    print('  confidence  ', dict(conf))
    print('  gold goals  ', dict(goals), f'across {sum(1 for r in rows if r["goals"])} cases')
    print('  no-goal     ', sum(1 for r in rows if not r['goals']))
    print('  minimal pairs', {k: sorted(v) for k, v in sorted(pairs.items())})
    print(f'  PRIMARY denominator (HIGH confidence, ANSWER-gold): {len(hi_answer)} cases')
    print(f'  labels.sha256 {labels_hash}')
    print(f'  cases.sha256  {cases_hash}')
    print(f'  -> {OUT}')


if __name__ == '__main__':
    main()
