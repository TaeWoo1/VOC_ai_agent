import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DATASET_FILES = ['questions.jsonl', 'needs.jsonl', 'precedents.jsonl'];

export function readJsonl(path) {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => {
    try {
      return JSON.parse(l);
    } catch (e) {
      throw new Error(`${path}:${i + 1}: ${e.message}`);
    }
  });
}

export function writeJsonl(path, rows) {
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** One dataset = three files. Its hash is the hash of `name:sha256` lines, so any byte in any file moves it. */
export function loadDataset(dir) {
  const files = {};
  for (const f of DATASET_FILES) {
    const p = join(dir, f);
    if (!existsSync(p)) throw new Error(`dataset file missing: ${p}`);
    files[f] = sha256(readFileSync(p));
  }
  const hash = sha256(DATASET_FILES.map((f) => `${f}:${files[f]}\n`).join(''));
  return {
    dir,
    hash,
    files,
    questions: readJsonl(join(dir, 'questions.jsonl')),
    needs: readJsonl(join(dir, 'needs.jsonl')),
    precedents: readJsonl(join(dir, 'precedents.jsonl')),
  };
}

export function parseRef(ref) {
  const m = /^([A-Z0-9]+):(.+)$/.exec(ref);
  if (!m) return null;
  const [, kind, rest] = m;
  const [id, pattern] = rest.split('#');
  return { kind, id, pattern: pattern ?? null, ref };
}

/** SQL LIKE → RegExp, for matching a runtime observation against the same pattern the census ran in SQL. */
export function likeToRegExp(pattern) {
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${esc}$`, 's');
}
