#!/usr/bin/env node
/**
 * Turn the operator's local worksheet output into the one committable artifact.
 *
 * This is the ONLY thing that writes `contracts/review-eval/naver/v2/labels.json`, and it is the
 * boundary the review text stops at. It copies four fields — fingerprint, tier, reasonCode, tags —
 * validates every one against the closed vocabularies of RUBRIC v2 sections 2, 3 and 5, and drops
 * everything else the worksheet may have carried, including any private note. An unknown field is a
 * refusal, not a silent drop: a schema that quietly widened is how customer content ends up in a
 * repository.
 *
 *   node tools/review-triage-calibration/derive-labels.mjs ~/Downloads/labels-local.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REASON_CODE_SET, TAG_SET, TIER_CODES, MAX_TAGS } from "./vocabulary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(HERE, "../../contracts/review-eval/naver/v2/labels.json");
const ALLOWED = new Set(["reviewIdFingerprint", "tier", "reasonCode", "tags"]);
const FINGERPRINT = /^[0-9a-f]{64}$/;

const source = process.argv[2];
if (!source) {
  console.error("\n  usage: node tools/review-triage-calibration/derive-labels.mjs <labels-local.json>\n");
  process.exit(1);
}

const input = JSON.parse(readFileSync(resolve(source), "utf8"));
const problems = [];
const seen = new Set();
const labels = [];

for (const [index, entry] of (input.labels ?? []).entries()) {
  const at = `entry ${index + 1}`;
  for (const key of Object.keys(entry)) {
    if (!ALLOWED.has(key)) problems.push(`${at}: field "${key}" is not in the committed schema`);
  }
  const fingerprint = entry.reviewIdFingerprint;
  if (!FINGERPRINT.test(fingerprint ?? "")) {
    problems.push(`${at}: reviewIdFingerprint is not 64 lowercase hex characters`);
    continue;
  }
  if (seen.has(fingerprint)) problems.push(`${at}: duplicate review`);
  seen.add(fingerprint);

  if (!TIER_CODES.has(entry.tier)) {
    problems.push(`${at}: tier "${entry.tier}" is not one of the four`);
    continue;
  }
  const tags = entry.tags ?? [];
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || tags.some((t) => !TAG_SET.has(t))) {
    problems.push(`${at}: tags must be at most ${MAX_TAGS} values from the stored category vocabulary`);
  }
  if (new Set(tags).size !== tags.length) problems.push(`${at}: repeated tag`);

  if (entry.tier === "UNCERTAIN") {
    // UNCERTAIN is excluded from every metric (RUBRIC v1 section 4). Carrying a reason or a tag
    // beside it would invite someone to count it later.
    if (entry.reasonCode || tags.length > 0) problems.push(`${at}: UNCERTAIN carries no reason and no tag`);
    labels.push({ reviewIdFingerprint: fingerprint, tier: "UNCERTAIN" });
    continue;
  }
  if (!REASON_CODE_SET.has(entry.reasonCode)) {
    problems.push(`${at}: reasonCode "${entry.reasonCode}" is not one of the thirteen`);
    continue;
  }
  labels.push({ reviewIdFingerprint: fingerprint, tier: entry.tier, reasonCode: entry.reasonCode, tags });
}

if (problems.length > 0) {
  console.error(`\n  REFUSED — ${problems.length} problem(s), nothing written:\n`);
  for (const p of problems.slice(0, 40)) console.error(`   · ${p}`);
  if (problems.length > 40) console.error(`   … and ${problems.length - 40} more`);
  console.error("");
  process.exit(1);
}

// Sorted by fingerprint so the committed file is stable across re-derivations and a diff shows what
// changed rather than how the worksheet happened to be ordered.
labels.sort((a, b) => (a.reviewIdFingerprint < b.reviewIdFingerprint ? -1 : 1));

const existing = JSON.parse(readFileSync(TARGET, "utf8"));
writeFileSync(TARGET, `${JSON.stringify({ ...existing, labels }, null, 2)}\n`, "utf8");

const byTier = {};
for (const l of labels) byTier[l.tier] = (byTier[l.tier] ?? 0) + 1;
console.log(`\n  wrote ${labels.length} labels to contracts/review-eval/naver/v2/labels.json`);
console.log(`  ${Object.entries(byTier).map(([t, n]) => `${t} ${n}`).join("  ")}\n`);
