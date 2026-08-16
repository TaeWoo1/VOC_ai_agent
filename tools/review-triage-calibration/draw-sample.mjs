#!/usr/bin/env node
/**
 * Draw the calibration sample and build the worksheet the operator labels.
 *
 * Reads real review text out of a LOCAL database and writes it to a LOCAL, gitignored file. Nothing
 * it produces is committable and nothing leaves the machine: the only artifact that ever reaches the
 * repository is `contracts/review-eval/naver/v2/labels.json`, and `derive-labels.mjs` is the only
 * thing that writes it.
 *
 * The draw is a pure function of the review ids (RUBRIC v2 section 4.3), so the same sample comes
 * back on every run and no list of drawn rows has to be stored anywhere.
 *
 *   REVIEW_CAL_DB_URL=postgresql://... node tools/review-triage-calibration/draw-sample.mjs
 *
 * Prints counts only. No body, no id, no fingerprint ever reaches stdout — a report is the easiest
 * way for this data to leak, and the whole tool exists off to one side because of that.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertParity, reviewIdFingerprint, sampleOrderKey, splitOf } from "./fingerprint.mjs";
import { ALLOCATION, MAX_TAGS, REASON_CODES, TAGS, TIERS, stratumOf } from "./vocabulary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "worksheet");

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const DB_URL = process.env.REVIEW_CAL_DB_URL;
if (!DB_URL) {
  die("Set REVIEW_CAL_DB_URL to the local Postgres URL. There is deliberately no default — this\n  tool reads real review text, so the database it opens has to be named on purpose.");
}

console.log(`review-id-fingerprint parity: ${assertParity()} golden vectors reproduce`);

// One SELECT, read-only in intent. `length(body)` is Postgres' code-point count; the JS side counts
// code points too, so the two never disagree on a body containing an emoji.
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

const rows = raw
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));

if (rows.length === 0) {
  die("The frame is empty. Expected NAVER export rows (external_id not null) in this database.");
}

// Frame: fingerprint + stratum per row. A row whose id will not fingerprint is dropped LOUDLY —
// silently labeling a row the harness can never match would waste a human's time and look like a
// labeling error later.
const frame = [];
let malformed = 0;
for (const row of rows) {
  const fingerprint = reviewIdFingerprint(row.id);
  if (fingerprint == null) {
    malformed++;
    continue;
  }
  const body = row.body ?? "";
  const codePoints = [...body].length;
  const stratum = stratumOf(row.rating, codePoints);
  if (stratum == null) {
    malformed++;
    continue;
  }
  frame.push({ fingerprint, stratum, rating: row.rating, body, order: sampleOrderKey(fingerprint) });
}

const byStratum = new Map();
for (const item of frame) {
  if (!byStratum.has(item.stratum)) byStratum.set(item.stratum, []);
  byStratum.get(item.stratum).push(item);
}

const drawn = [];
const report = [];
for (const stratum of Object.keys(ALLOCATION)) {
  const pool = (byStratum.get(stratum) ?? []).slice().sort((a, b) => (a.order < b.order ? -1 : 1));
  const take = Math.min(pool.length, ALLOCATION[stratum]);
  drawn.push(...pool.slice(0, take).map((item) => ({ ...item, stratum })));
  report.push({ stratum, inFrame: pool.length, drawn: take, pi: pool.length === 0 ? 0 : take / pool.length });
}

// Present the worksheet in the drawn order, not stratum-by-stratum: a labeler who works through all
// the 1★ rows first and then 200 5★ rows in a block calibrates to the block rather than to the
// rubric. The order is still deterministic.
drawn.sort((a, b) => (a.order < b.order ? -1 : 1));

const items = drawn.map((item, index) => ({
  n: index + 1,
  fingerprint: item.fingerprint,
  rating: item.rating,
  body: item.body,
}));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "worksheet.html"), worksheetHtml(items), "utf8");

console.log("\nframe and draw (counts only)\n");
console.log("  stratum   in frame   drawn        π");
for (const r of report) {
  console.log(
    `  ${r.stratum.padEnd(9)} ${String(r.inFrame).padStart(8)} ${String(r.drawn).padStart(7)}   ${r.pi.toFixed(4)}`,
  );
}
const dev = drawn.filter((d) => splitOf(d.fingerprint) === "DEV").length;
console.log(`  ${"TOTAL".padEnd(9)} ${String(frame.length).padStart(8)} ${String(drawn.length).padStart(7)}`);
console.log(`\n  split: DEV ${dev} / HOLDOUT ${drawn.length - dev}`);
if (malformed > 0) console.log(`  dropped (id would not fingerprint / no rating): ${malformed}`);
console.log(`\n  worksheet: ${resolve(OUT_DIR, "worksheet.html")}  (gitignored — never commit it)\n`);

/**
 * A single self-contained page, opened from disk. Deliberately NOT part of the product UI: this is
 * an evaluation instrument, and putting a labeling screen inside SellerOps would make an internal
 * measurement look like a feature.
 *
 * It shows the body and the star rating — what RUBRIC v1 section 1 says the question is answered
 * from — and NOT what `ReviewTriageRules` concludes. A labeler who has seen the rule's answer is
 * agreeing or disagreeing with it, which is a different measurement from the one this contract
 * needs.
 */
function worksheetHtml(labelItems) {
  const data = JSON.stringify(labelItems).replace(/</g, "\\u003c");
  const tiers = JSON.stringify(TIERS);
  const reasons = JSON.stringify(REASON_CODES);
  const tags = JSON.stringify(TAGS);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>상품평 라벨링 — review-eval/naver/v2</title>
<style>
 :root{--bg:#0f1115;--fg:#e8eaed;--dim:#9aa0a6;--card:#181b21;--line:#2a2f38;--warn:#e5a54b;--ok:#5cb85c}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}
 .wrap{max-width:860px;margin:0 auto;padding:24px 20px 80px}
 header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border-bottom:1px solid var(--line);padding-bottom:12px}
 h1{font-size:15px;font-weight:600;margin:0;color:var(--dim)}
 .prog{font-variant-numeric:tabular-nums;color:var(--dim);font-size:14px}
 .bar{height:3px;background:var(--line);margin:10px 0 20px}.bar>i{display:block;height:3px;background:var(--ok)}
 .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px 22px;margin-bottom:18px}
 .stars{color:var(--warn);font-size:20px;letter-spacing:2px}
 .body{margin-top:12px;font-size:19px;line-height:1.75;white-space:pre-wrap;word-break:break-word}
 .empty{color:var(--dim);font-style:italic}
 h2{font-size:13px;font-weight:600;color:var(--dim);margin:22px 0 8px;letter-spacing:.04em}
 .row{display:flex;flex-wrap:wrap;gap:8px}
 button{background:#20242c;color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:9px 13px;font-size:15px;cursor:pointer;font-family:inherit}
 button:hover{border-color:#4a5262}
 button.on{background:#2f4a2f;border-color:var(--ok)}
 button.on.att{background:#4a3320;border-color:var(--warn)}
 kbd{display:inline-block;min-width:16px;text-align:center;color:var(--dim);font-size:12px;margin-right:6px;font-family:ui-monospace,monospace}
 .hint{color:var(--dim);font-size:13px}
 .side{font-size:11px;color:var(--dim);margin-left:6px}
 footer{position:fixed;left:0;right:0;bottom:0;background:#12151b;border-top:1px solid var(--line);padding:10px 20px;display:flex;gap:10px;align-items:center;justify-content:center}
 .rules{margin:26px 0 0;padding:14px 18px;border:1px dashed var(--line);border-radius:10px;color:var(--dim);font-size:13.5px}
 .rules b{color:var(--fg);font-weight:600}
 .done{text-align:center;padding:60px 0}
</style></head><body><div class="wrap">
<header><h1>상품평 라벨링 · review-eval/naver/v2</h1><div class="prog" id="prog"></div></header>
<div class="bar"><i id="barfill" style="width:0"></i></div>
<div id="app"></div>
<div class="rules">
 <b>판단 기준 (RUBRIC v1 §1–§2)</b> — “<b>판매자가 이 상품평에 대해 무언가 해야 하는가?</b>”<br>
 부정적인가 / 고객이 불만인가가 아니라, <b>판매자가 할 일이 있는가</b>입니다.<br>
 · 칭찬하면서 하나를 짚음(“예쁜데 배송이 너무 늦었어요”) → <b>확인 필요</b>. 별점이 높아도 상관없습니다.<br>
 · 택배 기사 불만 → <b>확인 필요</b>. 판매자가 고객 경험을 책임집니다.<br>
 · 별점만 있고 본문이 없음 / 이모지뿐 → <b>참고</b>. 탐지할 것이 없습니다.<br>
 · 요구 없는 제품 비평(“생각보다 두꺼워요”) → <b>참고</b>. 무언가를 요구하거나 암시할 때만 확인 필요.<br>
 · 여러 주제 중 하나라도 할 일이 있으면 → <b>확인 필요</b>.
</div>
</div>
<footer>
 <button id="back">← 이전</button>
 <span class="hint" id="status"></span>
 <button id="save">라벨 파일 저장</button>
</footer>
<script>
const ITEMS=${data}, TIERS=${tiers}, REASONS=${reasons}, TAGS=${tags}, MAX_TAGS=${MAX_TAGS};
const KEY="review-eval-naver-v2:"+ITEMS.length+":"+(ITEMS[0]?ITEMS[0].fingerprint.slice(0,12):"");
// Three disjoint key sets. They must not overlap: a tag key that also set a tier would make four of
// the nine tags unreachable, and the labeler would never see why.
const TIER_KEYS=["1","2","3","4"], REASON_KEYS="asdfghjklzxcv".split(""), TAG_KEYS="qwertyuio".split("");
let answers=JSON.parse(localStorage.getItem(KEY)||"{}");
let i=ITEMS.findIndex(it=>!(answers[it.fingerprint]&&answers[it.fingerprint].tier));
if(i<0)i=ITEMS.length;
const app=document.getElementById("app");

function save(){localStorage.setItem(KEY,JSON.stringify(answers));}
function cur(){return ITEMS[i];}
function ans(){const c=cur();return answers[c.fingerprint]||(answers[c.fingerprint]={tier:null,reasonCode:null,tags:[]});}

function setTier(t){const a=ans();a.tier=t;if(t==="UNCERTAIN"){a.reasonCode=null;a.tags=[];save();next();return;}save();render();}
function setReason(r){const a=ans();a.reasonCode=(a.reasonCode===r?null:r);save();render();}
function toggleTag(t){const a=ans();const k=a.tags.indexOf(t);
 if(k>=0)a.tags.splice(k,1); else if(a.tags.length<MAX_TAGS)a.tags.push(t);
 save();render();}
function ready(){const a=ans();return a.tier==="UNCERTAIN"||(a.tier&&a.reasonCode);}
function next(){if(i<ITEMS.length)i++;render();}
function back(){if(i>0)i--;render();}

document.getElementById("back").onclick=back;
document.getElementById("save").onclick=()=>{
 const out={contract:"review-eval/naver/v2",rubricVersion:"v2",
  labels:ITEMS.filter(it=>answers[it.fingerprint]&&answers[it.fingerprint].tier)
   .map(it=>({reviewIdFingerprint:it.fingerprint,...answers[it.fingerprint]}))};
 const blob=new Blob([JSON.stringify(out,null,2)],{type:"application/json"});
 const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="labels-local.json";a.click();
};

addEventListener("keydown",e=>{
 if(e.metaKey||e.ctrlKey||e.altKey)return;
 if(i>=ITEMS.length)return;
 const a=ans();
 if(e.key==="Enter"){if(ready())next();return;}
 if(e.key==="Backspace"){e.preventDefault();back();return;}
 const t=TIER_KEYS.indexOf(e.key); if(t>=0&&t<TIERS.length){setTier(TIERS[t].code);return;}
 if(a.tier&&a.tier!=="UNCERTAIN"){
  const r=REASON_KEYS.indexOf(e.key); if(r>=0&&r<REASONS.length){setReason(REASONS[r].code);return;}
  const g=TAG_KEYS.indexOf(e.key); if(g>=0&&g<TAGS.length){toggleTag(TAGS[g]);return;}
 }
});

function render(){
 const total=ITEMS.length, done=ITEMS.filter(it=>answers[it.fingerprint]&&answers[it.fingerprint].tier).length;
 document.getElementById("prog").textContent=done+" / "+total+" 라벨 완료";
 document.getElementById("barfill").style.width=(100*done/total)+"%";
 document.getElementById("status").textContent=done===total?"전부 끝났습니다. 저장하세요.":"숫자·문자 키로 선택, Enter로 다음, Backspace로 이전";
 if(i>=ITEMS.length){
  app.innerHTML='<div class="done"><h2>끝났습니다</h2><p>'+done+' / '+total+' 라벨.<br>아래 <b>라벨 파일 저장</b>을 누르고, 내려받은 labels-local.json 경로를 알려주세요.</p></div>';
  return;
 }
 const it=cur(), a=ans();
 const stars="★".repeat(it.rating||0)+"☆".repeat(5-(it.rating||0));
 const bodyHtml=it.body&&it.body.trim()?esc(it.body):'<span class="empty">(본문 없음)</span>';
 let h='<div class="card"><div class="stars">'+stars+' <span class="hint">'+(it.rating==null?"별점 없음":it.rating+"점")+' · '+it.n+'번</span></div><div class="body">'+bodyHtml+'</div></div>';
 h+='<h2>판매자가 할 일이 있는가</h2><div class="row">'+TIERS.map((t,k)=>
   '<button class="'+(a.tier===t.code?'on'+(t.code==="NEEDS_ATTENTION"?' att':''):'')+'" data-tier="'+t.code+'"><kbd>'+TIER_KEYS[k]+'</kbd>'+t.ko+'<span class="side">'+t.hint+'</span></button>').join("")+'</div>';
 if(a.tier&&a.tier!=="UNCERTAIN"){
  h+='<h2>이유 (하나)</h2><div class="row">'+REASONS.map((r,k)=>
    '<button class="'+(a.reasonCode===r.code?'on':'')+'" data-reason="'+r.code+'"><kbd>'+REASON_KEYS[k]+'</kbd>'+r.ko+'</button>').join("")+'</div>';
  h+='<h2>이슈 태그 (없어도 됨, 최대 '+MAX_TAGS+'개)</h2><div class="row">'+TAGS.map((t,k)=>
    '<button class="'+(a.tags.includes(t)?'on':'')+'" data-tag="'+t+'"><kbd>'+TAG_KEYS[k]+'</kbd>'+t+'</button>').join("")+'</div>';
 }
 app.innerHTML=h;
 app.querySelectorAll("[data-tier]").forEach(b=>b.onclick=()=>setTier(b.dataset.tier));
 app.querySelectorAll("[data-reason]").forEach(b=>b.onclick=()=>setReason(b.dataset.reason));
 app.querySelectorAll("[data-tag]").forEach(b=>b.onclick=()=>toggleTag(b.dataset.tag));
}
function esc(s){return s.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
render();
</script></body></html>`;
}
