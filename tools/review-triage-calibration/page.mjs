/**
 * The labeling page, in one place because three people use variants of it and a divergence between
 * them would be a divergence in the measurement.
 *
 * **Blind by construction (RUBRIC v2 §7.6).** Nothing it renders comes from `ReviewTriageRules` or
 * any other model: an item carries a body, a star rating and an opaque key, and there is no field a
 * predicted tier could arrive in. `LabelingPageTest` asserts that on the generated file rather than
 * trusting this comment.
 *
 * **Self-contained.** No network, no fonts, no scripts from anywhere. The annotator's copy is opened
 * from disk on a machine that has never seen this repository.
 */
import { MAX_TAGS, REASON_CODES, TAGS, TIERS } from "./vocabulary.mjs";

const TIER_KEYS = ["1", "2", "3", "4"];
const REASON_KEYS = "asdfghjklzxcv".split("");
const TAG_KEYS = "qwertyuio".split("");

/** `v1` §2's tie-breakers, the copy every labeler reads. Synthetic examples, from the rubric itself. */
const RUBRIC_CARD = `
 <b>판단 기준 (RUBRIC v1 §1–§2)</b> — “<b>판매자가 이 상품평에 대해 무언가 해야 하는가?</b>”<br>
 부정적인가 / 고객이 불만인가가 아니라, <b>판매자가 할 일이 있는가</b>입니다.<br>
 · 칭찬하면서 하나를 짚음(“예쁜데 배송이 너무 늦었어요”) → <b>확인 필요</b>. 별점이 높아도 상관없습니다.<br>
 · 택배 기사 불만(“기사님이 던지고 갔어요”) → <b>확인 필요</b>. 판매자가 고객 경험을 책임집니다.<br>
 · 별점만 있고 본문이 없음 / 이모지뿐 → <b>참고</b>. 탐지할 것이 없습니다.<br>
 · 요구 없는 제품 비평(“생각보다 두꺼워요”) → <b>참고</b>. 무언가를 요구하거나 암시할 때만 확인 필요.<br>
 · 여러 주제 중 하나라도 할 일이 있으면 → <b>확인 필요</b>.<br>
 · <b>3점</b>인데 본문에 조치할 내용이 없음 → <b>지켜보기</b>. 3점은 신호이므로 참고까지 내리지 않지만,
   지금 확인하거나 고칠 근거가 본문에 없으면 확인 필요는 아닙니다.`;

/**
 * @param items    `[{ key, rating, body, section }]` — `key` is opaque; off this machine it maps to
 *                 nothing. `section` is an optional heading shown when it changes.
 * @param examples `[{ rating, body, tier, reasonCode }]` — the owner's worked examples, or none.
 */
export function labelingPage({ title, role, items, examples = [], download, storageKey, intro = "" }) {
  const data = json(items);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
 :root{--bg:#0f1115;--fg:#e8eaed;--dim:#9aa0a6;--card:#181b21;--line:#2a2f38;--warn:#e5a54b;--ok:#5cb85c}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}
 .wrap{max-width:880px;margin:0 auto;padding:24px 20px 96px}
 header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border-bottom:1px solid var(--line);padding-bottom:12px}
 h1{font-size:15px;font-weight:600;margin:0;color:var(--dim)}
 .prog{font-variant-numeric:tabular-nums;color:var(--dim);font-size:14px}
 .bar{height:3px;background:var(--line);margin:10px 0 18px}.bar>i{display:block;height:3px;background:var(--ok)}
 .sect{color:var(--warn);font-size:13px;letter-spacing:.04em;margin:0 0 10px}
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
 .rules,.intro{margin:24px 0 0;padding:14px 18px;border:1px dashed var(--line);border-radius:10px;color:var(--dim);font-size:13.5px}
 .rules b,.intro b{color:var(--fg);font-weight:600}
 details{margin-top:16px}summary{cursor:pointer;color:var(--dim);font-size:13.5px}
 .ex{border-left:2px solid var(--line);padding:8px 0 8px 14px;margin:12px 0}
 .ex .verdict{color:var(--warn);font-size:13px}
 .done{text-align:center;padding:60px 0}
</style></head><body><div class="wrap">
<header><h1>${escapeHtml(title)}</h1><div class="prog" id="prog"></div></header>
<div class="bar"><i id="barfill" style="width:0"></i></div>
${intro ? `<div class="intro">${intro}</div>` : ""}
<div id="app"></div>
<div class="rules">${RUBRIC_CARD}</div>
${examplesBlock(examples)}
</div>
<footer>
 <button id="back">← 이전</button>
 <span class="hint" id="status"></span>
 <button id="save">라벨 파일 저장</button>
</footer>
<script>
const ITEMS=${data}, TIERS=${json(TIERS)}, REASONS=${json(REASON_CODES)}, TAGS=${json(TAGS)};
const MAX_TAGS=${MAX_TAGS}, ROLE=${json(role)}, DOWNLOAD=${json(download)};
const KEY=${json(storageKey)}+":"+ITEMS.length;
// Three disjoint key sets. They must not overlap: a tag key that also set a tier would make four of
// the nine tags unreachable, and the labeler would never see why.
const TIER_KEYS=${json(TIER_KEYS)}, REASON_KEYS=${json(REASON_KEYS)}, TAG_KEYS=${json(TAG_KEYS)};
let answers=JSON.parse(localStorage.getItem(KEY)||"{}");
let i=ITEMS.findIndex(it=>!(answers[it.key]&&answers[it.key].tier));
if(i<0)i=ITEMS.length;
const app=document.getElementById("app");

function save(){localStorage.setItem(KEY,JSON.stringify(answers));}
function cur(){return ITEMS[i];}
function ans(){const c=cur();return answers[c.key]||(answers[c.key]={tier:null,reasonCode:null,tags:[]});}
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
 const out={contract:"review-eval/naver/v2",rubricVersion:"v2",role:ROLE,
  labels:ITEMS.filter(it=>answers[it.key]&&answers[it.key].tier)
   .map(it=>({key:it.key,...answers[it.key]}))};
 const blob=new Blob([JSON.stringify(out,null,2)],{type:"application/json"});
 const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=DOWNLOAD;a.click();
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
 const total=ITEMS.length, done=ITEMS.filter(it=>answers[it.key]&&answers[it.key].tier).length;
 document.getElementById("prog").textContent=done+" / "+total+" 라벨 완료";
 document.getElementById("barfill").style.width=(100*done/total)+"%";
 document.getElementById("status").textContent=done===total?"전부 끝났습니다. 저장하세요.":"숫자·문자 키로 선택, Enter로 다음, Backspace로 이전";
 if(i>=ITEMS.length){
  app.innerHTML='<div class="done"><h2>끝났습니다</h2><p>'+done+' / '+total+' 라벨.<br>아래 <b>라벨 파일 저장</b>을 누르세요.</p></div>';
  return;
 }
 const it=cur(), a=ans();
 const stars="★".repeat(it.rating||0)+"☆".repeat(5-(it.rating||0));
 const bodyHtml=it.body&&it.body.trim()?esc(it.body):'<span class="empty">(본문 없음)</span>';
 let h=it.section?'<p class="sect">'+esc(it.section)+'</p>':'';
 h+='<div class="card"><div class="stars">'+stars+' <span class="hint">'+(it.rating==null?"별점 없음":it.rating+"점")+' · '+esc(it.key)+'</span></div><div class="body">'+bodyHtml+'</div></div>';
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
function esc(s){return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
render();
</script></body></html>`;
}

function examplesBlock(examples) {
  if (examples.length === 0) {
    return "";
  }
  const rows = examples
    .map((e) => {
      const stars = "★".repeat(e.rating ?? 0) + "☆".repeat(5 - (e.rating ?? 0));
      const label = TIERS.find((t) => t.code === e.tier)?.ko ?? e.tier;
      const reason = REASON_CODES.find((r) => r.code === e.reasonCode)?.ko ?? e.reasonCode ?? "";
      return `<div class="ex"><div class="stars">${stars}</div><div>${escapeHtml(e.body ?? "")}</div>`
        + `<div class="verdict">→ ${escapeHtml(label)}${reason ? ` · ${escapeHtml(reason)}` : ""}</div></div>`;
    })
    .join("");
  return `<details><summary>기준 예시 ${examples.length}건 펼쳐 보기 — 같은 rubric으로 먼저 라벨링한 결과입니다</summary>${rows}</details>`;
}

/** `<` escaped so a body containing markup can never break out of the embedded JSON. */
function json(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}
