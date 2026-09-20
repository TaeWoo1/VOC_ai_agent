// node --test tools/eval-store/test/store.test.mjs
// The recovery drill (Inquiry v3 WP-1 Stage 0): put → delete the cache → restore from the canonical store → every
// hash verified. Runs on the committed SYNTHETIC fixture only; a throwaway store and "repository" are built per test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetHash, defaultRoots, openStore, refusalFor, sha256 } from '../store.mjs';
import { redact, scan } from '../redaction.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '../../..');
const FIX = join(REPO, 'contracts/inquiry-need-eval/v1/synthetic');
const FILES = ['questions.jsonl', 'needs.jsonl', 'precedents.jsonl'];

/** A throwaway world: a fake repository with one manifest, a store, a cache and a source directory. */
function world() {
  const base = mkdtempSync(join(tmpdir(), 'eval-store-test-'));
  const repo = join(base, 'repo');
  const src = join(base, 'src');
  mkdirSync(src, { recursive: true });
  for (const f of FILES) cpSync(join(FIX, f), join(src, f));
  const files = Object.fromEntries(FILES.map((f) => [f, sha256(readFileSync(join(src, f)))]));
  const mdir = join(repo, 'contracts', 'syn-eval', 'v1');
  mkdirSync(mdir, { recursive: true });
  writeFileSync(join(mdir, 'dataset.meta.json'), JSON.stringify({ files, dataset_hash: datasetHash(files) }));
  const s = openStore({ store: join(base, 'store'), cache: join(base, 'cache'), repo, allowEphemeral: true });
  return { base, repo, src, files, s, done: () => rmSync(base, { recursive: true, force: true }) };
}

test('recovery drill: put, delete the cache, restore, every byte verified', () => {
  const w = world();
  try {
    const dest = w.s.put('syn-eval', 'v1', w.src);
    for (const f of FILES) assert.equal(sha256(readFileSync(join(dest, f))), w.files[f]);
    assert.deepEqual(w.s.verify('syn-eval', 'v1'), []);
    assert.equal(statSync(join(w.base, 'store')).mode & 0o777, 0o700, 'the store is private to its owner');
    const cache = w.s.restore('syn-eval', 'v1');
    rmSync(join(w.base, 'cache'), { recursive: true, force: true }); // the disposable copy is gone
    assert.equal(existsSync(cache), false);
    const again = w.s.restore('syn-eval', 'v1');
    for (const f of FILES) assert.equal(sha256(readFileSync(join(again, f))), w.files[f]);
    rmSync(w.src, { recursive: true, force: true }); // and so is the source: the store alone restores it
    assert.deepEqual(w.s.verify('syn-eval', 'v1'), []);
  } finally {
    w.done();
  }
});

test('put is idempotent for identical bytes and refuses different bytes under the same version', () => {
  const w = world();
  try {
    w.s.put('syn-eval', 'v1', w.src);
    w.s.put('syn-eval', 'v1', w.src);
    const other = join(w.base, 'other');
    cpSync(w.src, other, { recursive: true });
    writeFileSync(join(other, 'needs.jsonl'), readFileSync(join(other, 'needs.jsonl'), 'utf8') + '\n');
    assert.throws(() => w.s.put('syn-eval', 'v1', other), /does not match the manifest/);
  } finally {
    w.done();
  }
});

test('a tampered canonical file fails verify and restore refuses to hand it out', () => {
  const w = world();
  try {
    const dest = w.s.put('syn-eval', 'v1', w.src);
    const p = join(dest, 'precedents.jsonl');
    chmodSync(p, 0o644);
    writeFileSync(p, '{"memory":"x"}\n');
    assert.match(w.s.verify('syn-eval', 'v1').join('\n'), /precedents\.jsonl: sha256/);
    assert.throws(() => w.s.restore('syn-eval', 'v1'), /canonical store fails verification/);
  } finally {
    w.done();
  }
});

test('the redaction gate refuses identity and never prints the value it caught', () => {
  const w = world();
  try {
    const leaky = join(w.src, 'questions.jsonl');
    writeFileSync(leaky, readFileSync(leaky, 'utf8')
      + JSON.stringify({ q: 'S:x', text: '연락처 010-1234-5678 로 주세요' }) + '\n');
    // re-pin the manifest so only the gate can refuse
    const files = Object.fromEntries(FILES.map((f) => [f, sha256(readFileSync(join(w.src, f)))]));
    writeFileSync(join(w.repo, 'contracts/syn-eval/v1/dataset.meta.json'), JSON.stringify({ files }));
    let err;
    try {
      w.s.put('syn-eval', 'v1', w.src);
    } catch (e) {
      err = e;
    }
    assert.match(err.message, /redaction gate/);
    assert.match(err.message, /KR_PHONE/);
    assert.doesNotMatch(err.message, /1234-5678/);
  } finally {
    w.done();
  }
});

test('redaction rules: identity is found, product vocabulary is not', () => {
  const found = (s) => scan(JSON.stringify({ t: s })).map((x) => x.rule);
  assert.deepEqual(found('메일 a.b@example.com'), ['EMAIL']);
  assert.deepEqual(found('주문번호 2026081512345678'), ['LONG_NUMBER']);
  assert.deepEqual(found('서울시 강남구 테헤란로 123'), ['KR_ADDRESS']);
  assert.deepEqual(found('안녕하세요 홍길동 고객님'), ['NAME_HONORIFIC']);
  assert.deepEqual(found('031-123-4567'), ['KR_PHONE']);
  assert.deepEqual(found('안녕하세요 고객님, 문의 감사합니다'), [], 'a greeting is not a name');
  for (const clean of ['1.5sq 전선 두 가닥에 맞는 호수', '누락된 생수컵 4000매 처리', 'OPT:442306ae#%커플 %', '10oz(300ml) 컵', 'R:c491451a']) {
    assert.deepEqual(found(clean), [], clean);
  }
  assert.equal(redact('연락 010-2222-3333'), '연락 [KR_PHONE]');
  // a sha256 is not a phone number, an order number or an address
  assert.deepEqual(found('7feefed8f12ee68f1690e99d7447c214e7f291d7de8e9a146b9e704ae9b7db11'), []);
  assert.deepEqual(found('registry_fp 1c9cbfc305c18c944e9d3d8e3d20a8e2c361e33baafb14911c94d0aa02133021'), []);
});

test('the canonical store may not live in a temp directory or overlap a repository', () => {
  assert.match(refusalFor(join(tmpdir(), 'x')), /temporary directory/);
  assert.match(refusalFor('/tmp/eval'), /temporary directory/);
  assert.match(refusalFor(join(REPO, 'eval')), /overlaps the repository/);
  assert.equal(refusalFor(join(homedir(), '.sellerops', 'eval-store'), { repo: REPO }), null);
  assert.throws(() => openStore({ store: join(tmpdir(), 's'), cache: join(tmpdir(), 'c') }), /temporary directory/);
  const env = defaultRoots({});
  assert.equal(refusalFor(env.store), null, 'the default canonical root is durable');
});

test('run artifacts are append-only: added once, never replaced, and verified', () => {
  const w = world();
  try {
    const run = join(w.base, 'run');
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'observations.jsonl'), '{"q":"S:p1","raw":"..."}\n');
    const first = w.s.runPut('wp2-smoke', run, { irreproducible: true, meta: { note: 'model answers' } });
    assert.deepEqual(first.added, ['observations.jsonl']);
    assert.deepEqual(w.s.runVerify('wp2-smoke'), []);
    // the same bytes again add nothing
    assert.deepEqual(w.s.runPut('wp2-smoke', run).added, []);
    // a second artifact may join the same run
    writeFileSync(join(run, 'score.json'), '{"ok":true}\n');
    assert.deepEqual(w.s.runPut('wp2-smoke', run).added, ['score.json']);
    // a changed artifact is refused — a raw model answer cannot be re-derived, so it is never replaced
    writeFileSync(join(run, 'observations.jsonl'), '{"q":"S:p1","raw":"edited"}\n');
    assert.throws(() => w.s.runPut('wp2-smoke', run), /append-only/);
    const manifest = JSON.parse(readFileSync(join(w.base, 'store', 'runs', 'wp2-smoke', 'RUN.json'), 'utf8'));
    assert.equal(manifest.files['observations.jsonl'].irreproducible, true);
    assert.equal(manifest.meta.note, 'model answers');
    assert.deepEqual(w.s.runs(), ['wp2-smoke']);
    // and a stored artifact that changes on disk fails verification
    chmodSync(join(w.base, 'store', 'runs', 'wp2-smoke', 'score.json'), 0o644);
    writeFileSync(join(w.base, 'store', 'runs', 'wp2-smoke', 'score.json'), '{"ok":false}\n');
    assert.match(w.s.runVerify('wp2-smoke').join('\n'), /score\.json: sha256 moved/);
  } finally {
    w.done();
  }
});

test('a run id is a plain name', () => {
  const w = world();
  try {
    assert.throws(() => w.s.runPut('../escape', w.src), /bad run id/);
    assert.throws(() => w.s.runPut('a', w.src), /bad run id/);
  } finally {
    w.done();
  }
});

test('the committed Eval v1 manifest agrees with its own dataset hash rule', () => {
  const m = JSON.parse(readFileSync(join(REPO, 'contracts/inquiry-need-eval/v1/dataset.meta.json'), 'utf8'));
  assert.equal(datasetHash(m.files), m.dataset_hash);
  assert.equal(m.storage.canonical, 'eval-store:inquiry-need-eval/v1');
  for (const f of Object.keys(m.files)) assert.equal(m.storage.files[f].status, 'RECOVERED_BYTE_IDENTICAL', f);
});
