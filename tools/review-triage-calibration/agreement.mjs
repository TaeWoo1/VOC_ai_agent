#!/usr/bin/env node
/**
 * How much the two labelers agreed, and on what they did not (RUBRIC v2 §7.4).
 *
 * Run BEFORE adjudication, always. Computing agreement after the owner has resolved the
 * disagreements would score the overlap against a label the owner wrote while looking at it, which
 * is a measurement of nothing.
 *
 *   node tools/review-triage-calibration/agreement.mjs <owner-labels.json> <annotator-labels.json>
 *
 * Prints counts and rates. Writes the local agreement record and, when there are disagreements, the
 * owner's adjudication sheet — the one page where a human is shown another human's answer.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cohenKappa, MIN_BINARY_KAPPA } from "./kappa.mjs";
import { labelingPage } from "./page.mjs";
import { TIERS } from "./vocabulary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "worksheet");

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const [ownerPath, annotatorPath] = process.argv.slice(2);
if (!ownerPath || !annotatorPath) {
  die("usage: node tools/review-triage-calibration/agreement.mjs <owner-labels.json> <annotator-labels.json>");
}

let rows;
try {
  rows = JSON.parse(readFileSync(resolve(OUT, "rows.json"), "utf8"));
} catch {
  die("worksheet/rows.json is missing. Run draw-sample.mjs first.");
}

const byKey = (path) => {
  const map = new Map();
  for (const entry of JSON.parse(readFileSync(resolve(path), "utf8")).labels ?? []) {
    map.set(entry.key, entry);
  }
  return map;
};
const owner = byKey(ownerPath);
const annotator = byKey(annotatorPath);

const overlapKeys = Object.keys(rows).filter((key) => rows[key].overlap).sort((a, b) => Number(a) - Number(b));
const missing = overlapKeys.filter((key) => !owner.has(key) || !annotator.has(key));

const record = [];
const scored = [];
let uncertainEither = 0;
for (const key of overlapKeys) {
  const a = owner.get(key);
  const b = annotator.get(key);
  if (!a || !b) {
    continue;
  }
  const pair = { key, owner: a.tier, annotator: b.tier, agree: a.tier === b.tier };
  record.push(pair);
  if (a.tier === "UNCERTAIN" || b.tier === "UNCERTAIN") {
    uncertainEither++;
    continue;
  }
  scored.push(pair);
}

const three = cohenKappa(scored.map((p) => [p.owner, p.annotator]));
const binary = cohenKappa(scored.map((p) => [
  p.owner === "NEEDS_ATTENTION" ? "A" : "N",
  p.annotator === "NEEDS_ATTENTION" ? "A" : "N",
]));

writeFileSync(resolve(OUT, "agreement-local.json"),
    `${JSON.stringify({ overlap: overlapKeys.length, scored: scored.length, uncertainEither, record }, null, 1)}\n`,
    "utf8");

const pct = (v) => (v == null ? "  n/a" : v.toFixed(3));
console.log("\n  overlap agreement — RUBRIC v2 §7.4\n");
if (missing.length > 0) {
  console.log(`  ⚠ ${missing.length} overlap row(s) missing a label from one side: ${missing.join(", ")}`);
}
console.log(`  overlap rows                 ${overlapKeys.length}`);
console.log(`  scored (both decided)        ${scored.length}`);
console.log(`  UNCERTAIN on either side     ${uncertainEither}   (excluded, per v1 §4)`);
console.log(`  raw agreement                ${pct(three?.po)}`);
console.log(`  three-class κ                ${pct(three?.kappa)}${three?.reason ? `  — ${three.reason}` : ""}   (descriptive)`);
console.log(`  binary κ (확인 필요 / 아님)   ${pct(binary?.kappa)}${binary?.reason ? `  — ${binary.reason}` : ""}`
    + `${binary?.se != null ? `  ± ${(1.96 * binary.se).toFixed(3)}` : ""}   (DECISIVE, bar ${MIN_BINARY_KAPPA})`);

const positives = scored.filter((p) => p.owner === "NEEDS_ATTENTION" || p.annotator === "NEEDS_ATTENTION").length;
console.log(`  rows either called 확인 필요  ${positives}`
    + (positives < 5 ? "   ⚠ too few for the binary κ to mean much — say so wherever it is quoted" : ""));

if (binary?.kappa == null || binary.kappa < MIN_BINARY_KAPPA) {
  console.log(`\n  ⛔ BELOW THE BAR. Per §7.4 the annotator's solo rows are NOT adequate as gold.`);
  console.log("     The pre-committed fallback is to report on the owner-labeled rows only, state that");
  console.log("     they are far below v1 §4's floor, and treat closing the gap as its own work.");
  console.log("     Relabeling until the number improves is not one of the options.");
} else {
  console.log(`\n  ✓ at or above the bar — the annotator's solo rows may stand as gold, with κ quoted beside`);
  console.log("     every number that rests on them.");
}

const disagreements = record.filter((p) => !p.agree);
console.log(`\n  disagreements to adjudicate: ${disagreements.length}`);
if (disagreements.length > 0) {
  const ko = (code) => TIERS.find((t) => t.code === code)?.ko ?? code;
  writeFileSync(resolve(OUT, "adjudication.html"), labelingPage({
    title: "상품평 라벨링 · 불일치 조정 · review-eval/naver/v2",
    role: "ADJUDICATION",
    download: "adjudication-labels.json",
    storageKey: "review-eval-naver-v2:adjudication",
    intro: "두 사람의 판단이 갈린 건들입니다. <b>두 답을 모두 보고</b> 최종 판단을 하세요 — 둘 중 하나여도 "
        + "되고, 제3의 답이어도 됩니다. 일치도 수치는 이미 계산되었으므로 여기서 무엇을 고르든 그 수치는 "
        + "바뀌지 않습니다.",
    items: disagreements.map((p) => ({
      key: p.key,
      rating: rows[p.key].rating,
      body: rows[p.key].body,
      section: `제품 책임자: ${ko(p.owner)}   ·   annotator: ${ko(p.annotator)}`,
    })),
  }), "utf8");
  console.log(`  adjudication sheet: ${resolve(OUT, "adjudication.html")}`);
}
console.log("");
