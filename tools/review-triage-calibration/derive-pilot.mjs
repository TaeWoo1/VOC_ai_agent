#!/usr/bin/env node
/**
 * The pilot label set of RUBRIC v2 §10 — the owner's labels on the 37 rows a candidate may be
 * measured against before the annotator's pass is commissioned.
 *
 * Deliberately runnable the moment the owner finishes, with no annotator and no gold set: deciding
 * whether that pass is worth doing is the pilot's entire purpose, so it cannot be downstream of it.
 *
 * **It refuses to emit a HOLDOUT row.** Not filters — refuses, loudly, if one is present in the
 * input, because a holdout row reaching a pilot report is §6.2's "read once" being spent on a
 * question it was not saved for, and the failure would be invisible in the output.
 *
 *   node tools/review-triage-calibration/derive-pilot.mjs ~/Downloads/owner-labels.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readLabelFile } from "./label-file.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "worksheet");
const TARGET = resolve(HERE, "../../contracts/review-eval/naver/v2/pilot-labels.json");

function die(message, detail = []) {
  console.error(`\n  ${message}\n`);
  for (const d of detail.slice(0, 40)) console.error(`   · ${d}`);
  console.error("");
  process.exit(1);
}

const source = process.argv[2];
if (!source) {
  die("usage: node tools/review-triage-calibration/derive-pilot.mjs <owner-labels.json>");
}

let rows;
try {
  rows = JSON.parse(readFileSync(resolve(OUT, "rows.json"), "utf8"));
} catch {
  die("worksheet/rows.json is missing. Run draw-sample.mjs first.");
}

const problems = [];
const owner = readLabelFile(source, "owner", rows, problems);
if (problems.length > 0) {
  die(`REFUSED — ${problems.length} problem(s), nothing written:`, problems);
}

const labels = [];
const skippedHoldout = [];
const counts = { calibration: 0, devOverlap: 0 };
for (const [key, value] of owner) {
  const row = rows[key];
  if (!row.inSample) {
    counts.calibration++;
  } else if (row.split === "DEV" && row.overlap) {
    counts.devOverlap++;
  } else {
    // The 17 HOLDOUT overlap rows. Present in the owner's file by design — they labeled all 54 —
    // and dropped here, named, so the drop is a line of output rather than a silence.
    skippedHoldout.push(key);
    continue;
  }
  labels.push({ reviewIdFingerprint: row.fingerprint, ...value, source: "OWNER" });
}

labels.sort((a, b) => (a.reviewIdFingerprint < b.reviewIdFingerprint ? -1 : 1));

writeFileSync(TARGET, `${JSON.stringify({
  contract: "review-eval/naver/v2",
  rubricVersion: "v2",
  set: "pilot",
  _comment: [
    "RUBRIC.md section 10. The owner's labels on the 24 calibration rows (outside the 220-row",
    "sample) and the 13 DEV overlap rows inside it. The 17 HOLDOUT overlap rows are NOT here and",
    "must never be: section 6.2 reads the holdout once, and a pilot is not what it was saved for.",
    "",
    "This is NOT gold. It is a screen (section 10.4): 37 rows can rule a candidate out and cannot",
    "rule one in, and no Wilson lower bound computed on it can reach section 5's 0.80 precision",
    "gate even on a perfect run. Quoting a pilot number as if it cleared that gate misreads both",
    "files. Same closed vocabularies and same absence of everything else as labels.json.",
  ],
  labels,
}, null, 2)}\n`, "utf8");

const byTier = {};
for (const l of labels) byTier[l.tier] = (byTier[l.tier] ?? 0) + 1;
console.log(`\n  wrote ${labels.length} pilot labels`);
console.log(`    ${counts.calibration} calibration (outside the sample) + ${counts.devOverlap} DEV overlap`);
console.log(`    by tier  ${Object.entries(byTier).map(([t, n]) => `${t} ${n}`).join("  ")}`);
console.log(`  withheld ${skippedHoldout.length} HOLDOUT row(s) — not in the pilot, by contract`);
const positives = byTier.NEEDS_ATTENTION ?? 0;
if (positives < 8) {
  console.log(`\n  ⚠ only ${positives} row(s) labeled 확인 필요. Recall measured on this few moves by more`);
  console.log("    than ten points on a single flip — §10.4's fallback is an out-of-sample extension,");
  console.log("    not a louder claim about the number.");
}
console.log("");
