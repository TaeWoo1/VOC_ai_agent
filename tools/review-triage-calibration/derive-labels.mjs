#!/usr/bin/env node
/**
 * Assemble gold from the three labeling passes, and write the two committable artifacts.
 *
 * This is the boundary the review text stops at. Every field that survives is a fingerprint or a
 * closed-vocabulary human judgment; an unknown field is a refusal, not a silent drop, because a
 * schema that quietly widened is how customer content ends up in a repository.
 *
 * Assembly follows RUBRIC v2 §7.5 exactly:
 *   1. rows only the annotator labeled  → ANNOTATOR
 *   2. overlap rows where both agreed   → OWNER
 *   3. overlap rows where they differed → ADJUDICATED, and it is an ERROR to be missing one
 *
 *   node tools/review-triage-calibration/derive-labels.mjs \
 *     --annotator ~/Downloads/annotator-labels.json \
 *     --owner ~/Downloads/owner-labels.json \
 *     [--adjudication ~/Downloads/adjudication-labels.json] \
 *     [--withheld ~/Downloads/withheld-labels.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cohenKappa, MIN_BINARY_KAPPA } from "./kappa.mjs";
import { readLabelFile } from "./label-file.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "worksheet");
const LABELS = resolve(HERE, "../../contracts/review-eval/naver/v2/labels.json");
const AGREEMENT = resolve(HERE, "../../contracts/review-eval/naver/v2/agreement.json");
function die(message, detail = []) {
  console.error(`\n  ${message}\n`);
  for (const d of detail.slice(0, 40)) console.error(`   · ${d}`);
  if (detail.length > 40) console.error(`   … and ${detail.length - 40} more`);
  console.error("");
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
}
if (!args.annotator || !args.owner) {
  die("usage: derive-labels.mjs --annotator <f> --owner <f> [--adjudication <f>] [--withheld <f>]");
}

let rows;
try {
  rows = JSON.parse(readFileSync(resolve(OUT, "rows.json"), "utf8"));
} catch {
  die("worksheet/rows.json is missing. Run draw-sample.mjs first.");
}

const problems = [];

const read = (path, label) => readLabelFile(path, label, rows, problems);
const annotator = read(args.annotator, "annotator");
const owner = read(args.owner, "owner");
const adjudication = read(args.adjudication, "adjudication");
const withheld = read(args.withheld, "withheld");
for (const [key, value] of withheld) {
  if (owner.has(key)) problems.push(`withheld entry ${key}: already labeled on the owner sheet`);
  owner.set(key, value);
}

const sampleKeys = Object.keys(rows).filter((key) => rows[key].inSample).sort((a, b) => Number(a) - Number(b));
const labels = [];
const bySource = { OWNER: 0, ANNOTATOR: 0, ADJUDICATED: 0 };
const unlabelled = [];

for (const key of sampleKeys) {
  const row = rows[key];
  let chosen = null;
  let source = null;
  if (adjudication.has(key)) {
    chosen = adjudication.get(key);
    source = "ADJUDICATED";
  } else if (row.overlap && owner.has(key) && annotator.has(key)) {
    const a = owner.get(key);
    const b = annotator.get(key);
    if (a.tier !== b.tier) {
      // §7.5 step 3. Taking one side silently would turn an unresolved disagreement into a gold
      // label nobody decided.
      problems.push(`row ${key}: the two labelers differ (${a.tier} vs ${b.tier}) and it was not adjudicated`);
      continue;
    }
    chosen = a;
    source = "OWNER";
  } else if (owner.has(key) && !annotator.has(key)) {
    chosen = owner.get(key);
    source = "OWNER";
  } else if (annotator.has(key)) {
    chosen = annotator.get(key);
    source = "ANNOTATOR";
  }
  if (!chosen) {
    unlabelled.push(key);
    continue;
  }
  bySource[source]++;
  labels.push({ reviewIdFingerprint: row.fingerprint, ...chosen, source });
}

if (problems.length > 0) {
  die(`REFUSED — ${problems.length} problem(s), nothing written:`, problems);
}

// Sorted by fingerprint so the committed file is stable across re-derivations and a diff shows what
// changed rather than how a worksheet happened to be ordered.
labels.sort((a, b) => (a.reviewIdFingerprint < b.reviewIdFingerprint ? -1 : 1));

const existing = JSON.parse(readFileSync(LABELS, "utf8"));
writeFileSync(LABELS, `${JSON.stringify({ ...existing, labels }, null, 2)}\n`, "utf8");

// The agreement record, from the pre-adjudication answers only.
const overlapKeys = sampleKeys.filter((key) => rows[key].overlap && owner.has(key) && annotator.has(key));
const scored = overlapKeys
    .map((key) => ({ key, o: owner.get(key).tier, a: annotator.get(key).tier }))
    .filter((p) => p.o !== "UNCERTAIN" && p.a !== "UNCERTAIN");
const binary = cohenKappa(scored.map((p) => [
  p.o === "NEEDS_ATTENTION" ? "A" : "N", p.a === "NEEDS_ATTENTION" ? "A" : "N"]));
const three = cohenKappa(scored.map((p) => [p.o, p.a]));

writeFileSync(AGREEMENT, `${JSON.stringify({
  contract: "review-eval/naver/v2",
  rubricVersion: "v2",
  _comment: [
    "The overlap rows of RUBRIC.md section 7.3, as they stood BEFORE adjudication. Two human",
    "judgments per review and whether they matched — no body, no id, no rating, nothing else.",
    "",
    "Measured on a positive-enriched subset, NOT in the corpus's own proportions, so it is not",
    "the corpus-wide agreement and must never be quoted as one. binaryKappa is the decisive",
    "number (section 7.4, bar " + MIN_BINARY_KAPPA + "); threeClassKappa is descriptive.",
  ],
  overlapRows: overlapKeys.length,
  scored: scored.length,
  uncertainEither: overlapKeys.length - scored.length,
  rawAgreement: three?.po ?? null,
  threeClassKappa: three?.kappa ?? null,
  binaryKappa: binary?.kappa ?? null,
  binaryKappaHalfWidth: binary?.se == null ? null : 1.96 * binary.se,
  minBinaryKappa: MIN_BINARY_KAPPA,
  pairs: overlapKeys.map((key) => ({
    reviewIdFingerprint: rows[key].fingerprint,
    owner: owner.get(key).tier,
    annotator: annotator.get(key).tier,
    agree: owner.get(key).tier === annotator.get(key).tier,
  })).sort((a, b) => (a.reviewIdFingerprint < b.reviewIdFingerprint ? -1 : 1)),
}, null, 2)}\n`, "utf8");

const byTier = {};
for (const l of labels) byTier[l.tier] = (byTier[l.tier] ?? 0) + 1;
console.log(`\n  wrote ${labels.length} labels of ${sampleKeys.length} drawn rows`);
console.log(`  by tier    ${Object.entries(byTier).map(([t, n]) => `${t} ${n}`).join("  ")}`);
console.log(`  by source  ${Object.entries(bySource).map(([s, n]) => `${s} ${n}`).join("  ")}`);
if (unlabelled.length > 0) {
  console.log(`  ⚠ ${unlabelled.length} drawn row(s) carry no label at all: ${unlabelled.slice(0, 20).join(", ")}`);
}
console.log(`  binary κ ${binary?.kappa == null ? "n/a" : binary.kappa.toFixed(3)} over ${scored.length}`
    + ` scored overlap rows (bar ${MIN_BINARY_KAPPA})\n`);
