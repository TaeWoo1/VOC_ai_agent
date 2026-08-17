#!/usr/bin/env node
/**
 * Build the one file that leaves this machine (RUBRIC v2 §7.7).
 *
 * A separate, explicit command rather than a step of the draw, because this is the moment real
 * customer prose travels to a second person and that should be something someone typed.
 *
 * What goes in: body, star rating, an opaque row number, the rubric, and the owner's worked
 * examples. What does not: the product, the date, the review id, the fingerprint, the seller, the
 * channel, the stratum, the DEV/HOLDOUT split, and anything any model concluded. The row number is
 * meaningless off this machine — `worksheet/rows.json` is the only map back and it stays here.
 *
 *   node tools/review-triage-calibration/build-annotator-package.mjs <owner-labels.json>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { labelingPage } from "./page.mjs";
import { refuseReason } from "./pii.mjs";
import { REASON_CODE_SET, TIER_CODES } from "./vocabulary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "worksheet");

function die(message, detail = []) {
  console.error(`\n  ${message}\n`);
  for (const d of detail.slice(0, 20)) console.error(`   · ${d}`);
  console.error("");
  process.exit(1);
}

const source = process.argv[2];
if (!source) {
  die("usage: node tools/review-triage-calibration/build-annotator-package.mjs <owner-labels.json>");
}

let rows;
try {
  rows = JSON.parse(readFileSync(resolve(OUT, "rows.json"), "utf8"));
} catch {
  die("worksheet/rows.json is missing. Run draw-sample.mjs first.");
}

const owner = JSON.parse(readFileSync(resolve(source), "utf8"));
const ownerByKey = new Map();
for (const entry of owner.labels ?? []) {
  if (!TIER_CODES.has(entry.tier)) {
    die(`owner label for ${entry.key} carries an unknown tier "${entry.tier}"`);
  }
  ownerByKey.set(entry.key, entry);
}

// Worked examples are the calibration rows only. An example drawn from the sample would be a row the
// annotator has been told the answer for, and it would still be scored as independent agreement.
const examples = Object.entries(rows)
    .filter(([key]) => key.startsWith("C"))
    .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
    .map(([key, row]) => ({ key, row, label: ownerByKey.get(key) }))
    .filter((e) => e.label && e.label.tier !== "UNCERTAIN")
    .map((e) => ({ rating: e.row.rating, body: e.row.body, tier: e.label.tier, reasonCode: e.label.reasonCode }));

if (examples.length === 0) {
  die("No usable worked examples. Label the C1–C24 rows on the owner sheet first — without them the\n  annotator is reading the rubric cold, which is the fidelity this protocol exists to avoid.");
}
for (const e of examples) {
  if (e.reasonCode && !REASON_CODE_SET.has(e.reasonCode)) {
    die(`worked example carries an unknown reason code "${e.reasonCode}"`);
  }
}

const sampleKeys = Object.keys(rows).filter((key) => rows[key].inSample)
    .sort((a, b) => Number(a) - Number(b));

const items = [];
const withheld = [];
for (const key of sampleKeys) {
  const reason = refuseReason(rows[key].body);
  if (reason) {
    withheld.push({ key, reason });
    continue;
  }
  items.push({ key, rating: rows[key].rating, body: rows[key].body });
}

mkdirSync(resolve(OUT, "package"), { recursive: true });
writeFileSync(resolve(OUT, "package", "annotator.html"), labelingPage({
  title: "상품평 라벨링 · review-eval/naver/v2",
  role: "ANNOTATOR",
  download: "annotator-labels.json",
  storageKey: "review-eval-naver-v2:annotator",
  intro: "<b>이 페이지 하나만 있으면 됩니다.</b> 인터넷 연결도, 로그인도 필요 없습니다. 판단 기준은 아래에 "
      + "있고, 같은 기준으로 먼저 라벨링한 예시 24건도 접혀 있습니다. 진행 상황은 브라우저에 저장되니 "
      + "나눠서 하셔도 됩니다. 끝나면 <b>라벨 파일 저장</b>을 눌러 나온 파일을 전달해 주세요.<br>"
      + "판단이 정말 애매하면 <b>모르겠음</b>을 쓰세요 — 억지로 고르는 것보다 낫습니다.",
  items,
  examples,
}), "utf8");

// Checked on the artifact, not on the intention that built it. The annotator must see the rubric
// and the worked examples and NOTHING else — not a fingerprint, not a stratum, not a split, not the
// owner's answer on a scored row, and not a word about how any candidate did.
const written = readFileSync(resolve(OUT, "package", "annotator.html"), "utf8");
const leaks = [];
for (const [key, row] of Object.entries(rows)) {
  if (written.includes(row.fingerprint)) leaks.push(`fingerprint of ${key}`);
}
for (const marker of ["HOLDOUT", "HIGH_L", "MID_S", "LOW_S", "rules-v1", "precision", "recall",
  "PRIMARY", "SENSITIVITY", "confusion"]) {
  if (written.includes(marker)) leaks.push(`the marker "${marker}"`);
}
// An example is allowed to carry a tier — that is what a worked example IS. A SAMPLE row carrying
// one would be the owner's answer to a scored question, which is the leak that matters.
const shown = JSON.parse(written.match(/const ITEMS=(\[.*?\]), TIERS=/s)[1].replace(/\\u003c/g, "<"));
for (const item of shown) {
  if (Object.keys(item).some((f) => !["key", "rating", "body", "section"].includes(f))) {
    leaks.push(`extra field on item ${item.key}`);
  }
}
if (leaks.length > 0) {
  die(`REFUSED — the package leaks ${leaks.length} thing(s):`, [...new Set(leaks)]);
}

if (withheld.length > 0) {
  // Refused rows stay on this machine and fall to the owner, so the 220 keeps its size. A withheld
  // row silently dropped would shrink the evaluation set without anything saying so.
  writeFileSync(resolve(OUT, "withheld.html"), labelingPage({
    title: "상품평 라벨링 · 외부 전달 보류분 · review-eval/naver/v2",
    role: "OWNER_WITHHELD",
    download: "withheld-labels.json",
    storageKey: "review-eval-naver-v2:withheld",
    intro: "본문에 연락처·이메일·긴 숫자열처럼 <b>직접 식별자로 보이는 형태</b>가 있어 외부 전달에서 "
        + "제외한 건들입니다. 이 기기 밖으로 나가지 않았으므로 여기서 직접 라벨링합니다.",
    items: withheld.map(({ key }) => ({ key, rating: rows[key].rating, body: rows[key].body })),
    examples,
  }), "utf8");
}

console.log(`\n  annotator package: ${resolve(OUT, "package", "annotator.html")}`);
console.log(`    ${items.length} rows to label, ${examples.length} worked examples embedded`);
console.log(`    withheld from the package: ${withheld.length}`
    + (withheld.length ? ` (${withheld.map((w) => `${w.key}:${w.reason}`).join(", ")})` : ""));
if (withheld.length > 0) {
  console.log(`    owner sheet for those: ${resolve(OUT, "withheld.html")}`);
}
console.log("\n  This file contains real customer review text. It is the only artifact meant to travel,");
console.log("  and it still must not be committed, mailed to a list, or left in shared storage.\n");
