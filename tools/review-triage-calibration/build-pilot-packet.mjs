#!/usr/bin/env node
/**
 * The paste-able packet for the §10 pilot's model arms, under the narrow permission of RUBRIC v2 §8.1.
 *
 * A separate, explicit command for the same reason `build-annotator-package.mjs` is: this is the
 * moment real customer prose reaches a third party, and it should be something someone typed.
 *
 * What goes in: **body, star rating, and an opaque `P##` key minted here**. What does not: the
 * review id, its fingerprint, the author, the seller, the channel, the product, the date, the
 * stratum, the DEV/HOLDOUT half, the human labels, and any candidate's prediction. The `P##` keys
 * are freshly minted rather than reused from the worksheet so a model's answer cannot be lined up
 * against anything else that exists; the map back lives only in the gitignored worksheet.
 *
 *   node tools/review-triage-calibration/build-pilot-packet.mjs
 *
 * Reads the committed pilot label set only to know WHICH 37 rows are in it — never their labels.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseReason } from "./pii.mjs";
import { REASON_CODES, TAGS, TIERS } from "./vocabulary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "worksheet");
const PILOT = resolve(HERE, "../../contracts/review-eval/naver/v2/pilot-labels.json");

function die(message, detail = []) {
  console.error(`\n  ${message}\n`);
  for (const d of detail.slice(0, 20)) console.error(`   · ${d}`);
  console.error("");
  process.exit(1);
}

let rows;
try {
  rows = JSON.parse(readFileSync(resolve(OUT, "rows.json"), "utf8"));
} catch {
  die("worksheet/rows.json is missing. Run draw-sample.mjs first.");
}

const pilot = JSON.parse(readFileSync(PILOT, "utf8"));
if ((pilot.labels ?? []).length === 0) {
  die("contracts/review-eval/naver/v2/pilot-labels.json is empty. Run derive-pilot.mjs first.");
}
// Membership only. The tiers in that file are the answer this packet must not contain.
const inPilot = new Set(pilot.labels.map((l) => l.reviewIdFingerprint));

const candidates = Object.entries(rows).filter(([, row]) => inPilot.has(row.fingerprint));
if (candidates.length !== inPilot.size) {
  die(`worksheet/rows.json holds ${candidates.length} of the ${inPilot.size} pilot rows — redraw first.`);
}
// §8.1 forbids sending a HOLDOUT row; §10.1 already excluded them, and this is the second lock.
const holdout = candidates.filter(([, row]) => row.inSample && row.split === "HOLDOUT");
if (holdout.length > 0) {
  die(`REFUSED — ${holdout.length} HOLDOUT row(s) reached the pilot set. Nothing written.`);
}

// Deterministic order, independent of the worksheet's, so P01 is not row 1 of anything.
const ordered = candidates
    .map(([key, row]) => ({ key, row, order: createHash("sha256")
        .update(`review-eval-pilot-packet/v2\n${row.fingerprint}`, "utf8").digest("hex") }))
    .sort((a, b) => (a.order < b.order ? -1 : 1))
    .map((entry, index) => ({ ...entry, pkey: `P${String(index + 1).padStart(2, "0")}` }));

const withheld = ordered.filter((e) => refuseReason(e.row.body));
if (withheld.length > 0) {
  die(`REFUSED — ${withheld.length} row(s) look like they carry a direct identifier: `
      + `${withheld.map((e) => `${e.pkey}:${refuseReason(e.row.body)}`).join(", ")}.\n`
      + "  Nothing written. A pilot row cannot be quietly dropped — it would change the denominator\n"
      + "  of every rate below without anything saying so, so this is a stop rather than a filter.");
}

writeFileSync(resolve(OUT, "pilot-key-map.json"), `${JSON.stringify(
    Object.fromEntries(ordered.map((e) => [e.pkey, { worksheetKey: e.key, fingerprint: e.row.fingerprint }])),
    null, 1)}\n`, "utf8");

const tierList = TIERS.filter((t) => t.code !== "UNCERTAIN")
    .map((t) => `- \`${t.code}\` (${t.ko}) — ${t.hint}`).join("\n");
const reasonList = REASON_CODES.map((r) => `- \`${r.code}\` — ${r.ko}`).join("\n");

const packet = `# 상품평 분류 작업

한국 온라인 마켓(스마트스토어) 상품평 ${ordered.length}건을 아래 기준으로 분류해 주세요.
각 건에 대해 **본문과 별점만** 보고 판단합니다. 그 외 정보는 제공되지 않으며, 추측하지 마세요.

## 판단해야 하는 질문

> **판매자가 이 상품평에 대해 무언가 해야 하는가?**

"부정적인가" / "고객이 불만인가"가 아니라 **판매자가 할 일이 있는가**입니다.

## 등급

${tierList}
- \`UNCERTAIN\` (모르겠음) — 정말 애매한 경우에만. 억지로 고르지 마세요.

## 반드시 이렇게 판단하는 경우 (tie-breaker)

- 칭찬하면서 하나를 문제로 짚음(예: "예쁜데 배송이 너무 늦었어요") → **NEEDS_ATTENTION**. 별점이 높아도 상관없습니다.
- 택배 기사에 대한 불만(예: "기사님이 던지고 갔어요") → **NEEDS_ATTENTION**. 판매자가 고객 경험을 책임집니다.
- 별점만 있고 본문이 없거나 이모지뿐 → **FYI**. 판단할 내용이 없습니다.
- 요구가 없는 단순 제품 비평(예: "생각보다 두꺼워요") → **FYI**. 무언가를 요구하거나 암시할 때만 NEEDS_ATTENTION.
- 여러 주제가 섞였고 그중 하나라도 판매자가 할 일이 있으면 → **NEEDS_ATTENTION**.

## 이유 코드 (각 건마다 정확히 하나)

${reasonList}

## 이슈 태그 (0~2개, 없으면 빈 배열)

${TAGS.map((t) => `\`${t}\``).join(" · ")}

## 출력 형식

설명이나 근거 문장 없이, 아래 형식의 JSON 하나만 출력하세요.
\`UNCERTAIN\`인 건은 \`reasonCode\`를 \`null\`, \`tags\`를 \`[]\`로 두세요.

\`\`\`json
{"labels":[{"key":"P01","tier":"FYI","reasonCode":"PRAISE_ONLY","tags":[]}]}
\`\`\`

---

## 상품평 ${ordered.length}건

${ordered.map((e) => `### ${e.pkey}\n별점: ${e.row.rating == null ? "없음" : `${e.row.rating}점`}\n본문: ${(e.row.body ?? "").trim() || "(본문 없음)"}`).join("\n\n")}
`;

writeFileSync(resolve(OUT, "pilot-prompt.md"), packet, "utf8");

// Last check on the artifact itself, not on the intention that built it.
const written = readFileSync(resolve(OUT, "pilot-prompt.md"), "utf8");
const leaks = [];
for (const entry of ordered) {
  if (written.includes(entry.row.fingerprint)) leaks.push(`fingerprint of ${entry.pkey}`);
  if (written.includes(entry.row.stratum)) leaks.push(`stratum of ${entry.pkey}`);
}
if (written.includes("HOLDOUT") || written.includes("DEV")) leaks.push("a DEV/HOLDOUT marker");
for (const label of pilot.labels) {
  if (written.includes(label.reviewIdFingerprint)) leaks.push("a gold fingerprint");
}
if (leaks.length > 0) {
  die(`REFUSED — the packet contains ${leaks.length} thing(s) §8.1 forbids: ${[...new Set(leaks)].join(", ")}`);
}

console.log(`\n  pilot packet: ${resolve(OUT, "pilot-prompt.md")}`);
console.log(`    ${ordered.length} rows · body + 별점 + P## key only · no id, no fingerprint, no gold, no prediction`);
console.log(`  key map:      ${resolve(OUT, "pilot-key-map.json")}   (stays here — never paste this)`);
console.log(`
  Before pasting (RUBRIC v2 §8.1):
    · ChatGPT — Temporary Chat ON, model improvement OFF
    · Claude  — Incognito ON,      model improvement OFF
  Save each model's JSON reply as worksheet/arm-claude.json and worksheet/arm-gpt.json.

  This is cloud transmission of real customer prose. Those settings reduce retention and
  training use; they do not make it local.
`);
