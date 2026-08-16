#!/usr/bin/env node
/**
 * Draw the calibration sample and build the owner's sheet.
 *
 * Reads real review text out of a LOCAL database and writes it to a LOCAL, gitignored directory.
 * Nothing it produces is committable and nothing leaves the machine here: the annotator's portable
 * copy is a separate, explicit step (`build-annotator-package.mjs`) so that the moment text travels
 * is a command someone types, not a side effect of drawing a sample.
 *
 * Three draws, all pure functions of the review ids (RUBRIC v2 §4.3, §7.2, §7.3), so every one of
 * them comes back identical on a re-run and no list of drawn rows is stored anywhere:
 *
 *   · the 220-row evaluation sample
 *   · 24 calibration rows from OUTSIDE it, which become the annotator's worked examples
 *   · 30 overlap rows INSIDE it, which both people label independently
 *
 *   REVIEW_CAL_DB_URL=postgresql://... node tools/review-triage-calibration/draw-sample.mjs
 *
 * Prints counts only. No body, no id, no fingerprint ever reaches stdout.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertParity, reviewIdFingerprint, sampleOrderKey, splitOf } from "./fingerprint.mjs";
import { labelingPage } from "./page.mjs";
import { ALLOCATION, CALIBRATION_ALLOCATION, OVERLAP_ALLOCATION, stratumOf } from "./vocabulary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "worksheet");

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const DB_URL = process.env.REVIEW_CAL_DB_URL;
if (!DB_URL) {
  die("Set REVIEW_CAL_DB_URL to the local Postgres URL. There is deliberately no default — this\n  tool reads real review text, so the database it opens has to be named on purpose.");
}

console.log(`review-id-fingerprint parity: ${assertParity()} golden vectors reproduce`);

const SQL = `
  select row_to_json(t) from (
    select r.external_id as id, r.rating as rating, r.body as body
    from reviews r join channels c on c.id = r.channel_id
    where c.code = 'NAVER' and r.external_id is not null
  ) t`;

let raw;
try {
  raw = execFileSync("psql", [DB_URL, "-At", "-c", SQL], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  die(`psql failed. Is the local database running and REVIEW_CAL_DB_URL correct?\n  ${e.message}`);
}

const frame = [];
let malformed = 0;
for (const line of raw.split("\n")) {
  if (line.trim().length === 0) {
    continue;
  }
  const row = JSON.parse(line);
  const fingerprint = reviewIdFingerprint(row.id);
  const body = row.body ?? "";
  const stratum = stratumOf(row.rating, [...body].length);
  // A row that will not fingerprint is dropped LOUDLY. Labeling one the harness can never match
  // would waste a human's time and look like a labeling error months later.
  if (fingerprint == null || stratum == null) {
    malformed++;
    continue;
  }
  frame.push({ fingerprint, stratum, rating: row.rating, body, order: sampleOrderKey(fingerprint) });
}
if (frame.length === 0) {
  die("The frame is empty. Expected NAVER export rows (external_id not null) in this database.");
}

const pools = new Map();
for (const item of frame) {
  if (!pools.has(item.stratum)) pools.set(item.stratum, []);
  pools.get(item.stratum).push(item);
}
for (const pool of pools.values()) {
  pool.sort((a, b) => (a.order < b.order ? -1 : 1));
}

/** Take the first `n` of a stratum, starting at `from` — the calibration draw begins where the sample ends. */
function take(stratum, n, from = 0) {
  const pool = pools.get(stratum) ?? [];
  return pool.slice(from, from + Math.max(0, Math.min(n, pool.length - from)));
}

const report = [];
const sample = [];
for (const stratum of Object.keys(ALLOCATION)) {
  const drawn = take(stratum, ALLOCATION[stratum]);
  sample.push(...drawn);
  report.push({ stratum, inFrame: (pools.get(stratum) ?? []).length, drawn: drawn.length });
}
sample.sort((a, b) => (a.order < b.order ? -1 : 1));

// Calibration continues past the sample in the same order, so it can never collide with it.
const calibration = [];
for (const [stratum, n] of Object.entries(CALIBRATION_ALLOCATION)) {
  if (!Number.isFinite(ALLOCATION[stratum])) {
    // A censused stratum has nothing outside the sample, so asking for calibration rows there would
    // silently return none — which reads as "the draw worked" while the worked examples went missing.
    die(`${stratum} is censused by the sample; there are no rows outside it to calibrate on.`);
  }
  calibration.push(...take(stratum, n, ALLOCATION[stratum]));
}
calibration.sort((a, b) => (a.order < b.order ? -1 : 1));

// Opaque keys, assigned in the sample's own presentation order. Off this machine "137" maps to
// nothing: the map back to a fingerprint is written below and never leaves.
const keyOf = new Map();
sample.forEach((item, index) => keyOf.set(item.fingerprint, String(index + 1)));
calibration.forEach((item, index) => keyOf.set(item.fingerprint, `C${index + 1}`));

const overlapSet = new Set();
for (const [stratum, n] of Object.entries(OVERLAP_ALLOCATION)) {
  sample.filter((item) => item.stratum === stratum).slice(0, n)
      .forEach((item) => overlapSet.add(item.fingerprint));
}
const overlap = sample.filter((item) => overlapSet.has(item.fingerprint));

mkdirSync(OUT, { recursive: true });

// Everything the later steps need, so the database is touched exactly once.
const rows = {};
for (const item of [...sample, ...calibration]) {
  const key = keyOf.get(item.fingerprint);
  rows[key] = {
    fingerprint: item.fingerprint,
    stratum: item.stratum,
    rating: item.rating,
    body: item.body,
    inSample: !key.startsWith("C"),
    overlap: overlapSet.has(item.fingerprint),
    split: splitOf(item.fingerprint),
  };
}
writeFileSync(resolve(OUT, "rows.json"), `${JSON.stringify(rows, null, 1)}\n`, "utf8");

writeFileSync(resolve(OUT, "owner.html"), labelingPage({
  title: "상품평 라벨링 · 제품 책임자 · review-eval/naver/v2",
  role: "OWNER",
  download: "owner-labels.json",
  storageKey: "review-eval-naver-v2:owner",
  intro: "<b>두 부분입니다.</b> 앞의 24건(C1–C24)은 <b>평가 표본 밖</b>에서 뽑았습니다 — 기준을 스스로 "
      + "정리하고, 그대로 annotator에게 줄 예시가 됩니다. 뒤의 30건은 <b>평가 표본 안</b>이며 annotator도 "
      + "같은 건을 따로 라벨링합니다. 두 사람의 답을 비교해 일치도를 재는 것이 목적이므로, 정답을 맞히려 "
      + "하지 말고 rubric대로만 판단하세요.",
  items: [
    ...calibration.map((item, index) => ({
      key: keyOf.get(item.fingerprint), rating: item.rating, body: item.body,
      section: index === 0 ? "1부 · 기준 잡기 (평가 표본 밖 24건)" : undefined,
    })),
    ...overlap.map((item, index) => ({
      key: keyOf.get(item.fingerprint), rating: item.rating, body: item.body,
      section: index === 0 ? "2부 · 교차 라벨링 (평가 표본 안 30건)" : undefined,
    })),
  ],
}), "utf8");

console.log("\nframe and draw (counts only)\n");
console.log("  stratum   in frame   drawn   overlap        π");
for (const r of report) {
  const overlapHere = overlap.filter((item) => item.stratum === r.stratum).length;
  console.log(`  ${r.stratum.padEnd(9)} ${String(r.inFrame).padStart(8)} ${String(r.drawn).padStart(7)}`
      + ` ${String(overlapHere).padStart(9)}   ${(r.drawn / r.inFrame).toFixed(4)}`);
}
console.log(`  ${"TOTAL".padEnd(9)} ${String(frame.length).padStart(8)} ${String(sample.length).padStart(7)}`
    + ` ${String(overlap.length).padStart(9)}`);
const dev = sample.filter((item) => splitOf(item.fingerprint) === "DEV").length;
console.log(`\n  split: DEV ${dev} / HOLDOUT ${sample.length - dev}`);
console.log(`  calibration drawn from outside the sample: ${calibration.length}`);
if (malformed > 0) console.log(`  dropped (id would not fingerprint / no rating): ${malformed}`);
console.log(`\n  owner sheet: ${resolve(OUT, "owner.html")}`);
console.log("  worksheet/ is gitignored — never commit anything in it\n");
