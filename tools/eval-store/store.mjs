#!/usr/bin/env node
// Private eval store (Inquiry v3 WP-1 Stage 0).
//
// Why this exists: Eval v1's canonical files lived in an OS temporary directory and were deleted by the system on
// 2026-09-20. They were recovered only because the build scripts happened to be in a session log. A canonical eval
// asset now has exactly one home — a DURABLE store outside every repository and every temp directory — and any number of
// disposable caches restored from it and verified against the hashes the repository holds.
//
//   canonical store  $SELLEROPS_EVAL_STORE  (default ~/.sellerops/eval-store)   read-only files, never in a repo, never in tmp
//   local cache      $SELLEROPS_EVAL_CACHE  (default ~/.cache/sellerops-eval)    delete it any time; `restore` rebuilds it
//   repository       contracts/<dataset>/<version>/dataset.meta.json            names, hashes, counts, provenance — no text
//
// usage:
//   node tools/eval-store/store.mjs put     <dataset> <version> --from <dir>
//   node tools/eval-store/store.mjs verify  <dataset> <version>
//   node tools/eval-store/store.mjs restore <dataset> <version>        # prints the cache directory
//   node tools/eval-store/store.mjs where
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './redaction.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The manifest the repository holds for one dataset version. */
export function manifestPath(dataset, version, repo = REPO) {
  return join(repo, 'contracts', dataset, version, 'dataset.meta.json');
}

export function loadManifest(dataset, version, repo = REPO) {
  const p = manifestPath(dataset, version, repo);
  if (!existsSync(p)) throw new Error(`no manifest for ${dataset}/${version}: ${p}`);
  const m = JSON.parse(readFileSync(p, 'utf8'));
  if (!m.files || typeof m.files !== 'object' || !Object.keys(m.files).length) {
    throw new Error(`${p}: manifest has no "files" map`);
  }
  return m;
}

/** `name:sha256\n` lines in the manifest's file order — the Eval v1 dataset-hash rule. */
export function datasetHash(files) {
  return sha256(Object.entries(files).map(([f, h]) => `${f}:${h}\n`).join(''));
}

const canonical = (p) => {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    // not created yet: resolve the nearest existing parent so /tmp → /private/tmp is still seen
    const parent = dirname(abs);
    return parent === abs ? abs : join(canonical(parent), abs.slice(parent.length + 1));
  }
};

const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** Why a directory may not hold the CANONICAL store, or null when it may. */
export function refusalFor(root, { repo = REPO } = {}) {
  const r = canonical(root);
  const temps = [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].map(canonical);
  if (temps.some((t) => within(r, t))) return `refused: ${r} is inside a temporary directory the OS may delete`;
  if (within(r, canonical(repo)) || within(canonical(repo), r)) return `refused: ${r} overlaps the repository ${repo}`;
  if (existsSync(join(r, '.git'))) return `refused: ${r} is a git working tree`;
  return null;
}

export function defaultRoots(env = process.env) {
  return {
    store: env.SELLEROPS_EVAL_STORE || join(homedir(), '.sellerops', 'eval-store'),
    cache: env.SELLEROPS_EVAL_CACHE || join(homedir(), '.cache', 'sellerops-eval'),
  };
}

/**
 * @param {object} o
 * @param {string} o.store  canonical root
 * @param {string} o.cache  cache root
 * @param {string} [o.repo] repository holding the manifests
 * @param {boolean} [o.allowEphemeral] tests only: permit a temp-dir store. The CLI never sets it.
 */
export function openStore({ store, cache, repo = REPO, allowEphemeral = false }) {
  if (!allowEphemeral) {
    const why = refusalFor(store, { repo });
    if (why) throw new Error(why);
  }
  const dirOf = (root, dataset, version) => join(root, dataset, version);

  function checkFiles(dir, manifest) {
    const problems = [];
    for (const [f, want] of Object.entries(manifest.files)) {
      const p = join(dir, f);
      if (!existsSync(p)) {
        problems.push(`${f}: missing`);
        continue;
      }
      const got = sha256(readFileSync(p));
      if (got !== want) problems.push(`${f}: sha256 ${got} != manifest ${want}`);
    }
    if (manifest.dataset_hash && datasetHash(manifest.files) !== manifest.dataset_hash) {
      problems.push(`dataset_hash in manifest does not match its own files map`);
    }
    return problems;
  }

  return {
    store,
    cache,
    /** Copy a verified, redaction-clean dataset into the canonical store. Idempotent for identical bytes. */
    put(dataset, version, fromDir) {
      const manifest = loadManifest(dataset, version, repo);
      const problems = checkFiles(fromDir, manifest);
      if (problems.length) throw new Error(`put refused — source does not match the manifest:\n  ${problems.join('\n  ')}`);
      const pii = [];
      for (const f of Object.keys(manifest.files)) {
        for (const x of scan(readFileSync(join(fromDir, f), 'utf8'))) pii.push(`${f}:${x.line} ${x.path ?? ''} ${x.rule}`);
      }
      if (pii.length) throw new Error(`put refused — redaction gate:\n  ${pii.join('\n  ')}`);
      mkdirSync(store, { recursive: true, mode: 0o700 });
      chmodSync(store, 0o700); // real customer-derived data: the owner only
      const dest = dirOf(store, dataset, version);
      mkdirSync(dest, { recursive: true, mode: 0o700 });
      for (const f of Object.keys(manifest.files)) {
        const target = join(dest, f);
        if (existsSync(target)) {
          if (sha256(readFileSync(target)) === manifest.files[f]) continue;
          throw new Error(`put refused — ${target} exists with different bytes; a changed dataset is a new version`);
        }
        copyFileSync(join(fromDir, f), target);
        chmodSync(target, 0o444);
      }
      const receipt = join(dest, 'STORED.json');
      if (!existsSync(receipt)) {
        writeFileSync(receipt, JSON.stringify({ dataset, version, files: manifest.files, stored_at: new Date().toISOString() }, null, 1) + '\n');
        chmodSync(receipt, 0o444);
      }
      return dest;
    },
    /** The canonical copy against the manifest. */
    verify(dataset, version) {
      return checkFiles(dirOf(store, dataset, version), loadManifest(dataset, version, repo));
    },
    /** Rebuild the cache from the canonical store and verify every byte. Returns the cache directory. */
    restore(dataset, version) {
      const manifest = loadManifest(dataset, version, repo);
      const src = dirOf(store, dataset, version);
      const problems = checkFiles(src, manifest);
      if (problems.length) throw new Error(`restore refused — canonical store fails verification:\n  ${problems.join('\n  ')}`);
      const dest = dirOf(cache, dataset, version);
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(dest, { recursive: true });
      for (const f of Object.keys(manifest.files)) copyFileSync(join(src, f), join(dest, f));
      const after = checkFiles(dest, manifest);
      if (after.length) throw new Error(`restore failed verification:\n  ${after.join('\n  ')}`);
      return dest;
    },
    list() {
      if (!existsSync(store)) return [];
      return readdirSync(store).flatMap((d) => readdirSync(join(store, d)).map((v) => `${d}/${v}`));
    },
  };
}

function main(argv) {
  const [cmd, dataset, version, ...rest] = argv;
  const roots = defaultRoots();
  if (cmd === 'where') {
    console.log(JSON.stringify({ ...roots, refusal: refusalFor(roots.store) }, null, 1));
    return 0;
  }
  const s = openStore(roots);
  if (!dataset || !version) throw new Error('usage: store.mjs <put|verify|restore> <dataset> <version> [--from <dir>]');
  if (cmd === 'put') {
    const i = rest.indexOf('--from');
    if (i < 0 || !rest[i + 1]) throw new Error('put needs --from <dir>');
    console.log(s.put(dataset, version, rest[i + 1]));
  } else if (cmd === 'verify') {
    const problems = s.verify(dataset, version);
    console.log(problems.length ? problems.join('\n') : `ok ${dataset}/${version}`);
    return problems.length ? 1 : 0;
  } else if (cmd === 'restore') {
    console.log(s.restore(dataset, version));
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
