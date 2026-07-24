#!/usr/bin/env node
/**
 * Reply-State Live Validation — reusable C2/C4 verification harness.
 *
 * DATA-DRIVEN and source-agnostic: it reads whatever reviews already exist for one single-NAVER-account
 * organization and proves the reply-state guarantees on them. The reviews may come from a SYNTHETIC seed
 * (the committed golden export, ingested via the same upload path) or from a real LIVE export ingest —
 * the verification logic here does not change, so the synthetic seed can be swapped for the live-export
 * ingest result without touching this file.
 *
 *   C2  answered reviews are EXCLUDED from the actionable low-rating queue, yet remain visible as
 *       NEW_REVIEW arrivals; PENDING low-rating reviews STAY actionable (so it cannot pass by excluding
 *       everything).
 *   C4  starting a guided reply for an already-answered review is REFUSED server-side (409, on the
 *       answered gate). Proven answer-SPECIFIC: a pending review taken through the same step is refused
 *       LATER (on the approval gate), not on the answered gate.
 *
 * Inputs (env): SELLEROPS_BASE_URL, SELLEROPS_EMAIL, SELLEROPS_PASSWORD, RSV_ACCOUNT_ID, RSV_FROM, RSV_TO.
 * Output: sanitized, clearly-separated C2 and C4 evidence (counts + booleans only — no review bodies,
 * reviewer/order identity, or raw messages). Exit 0 iff every check passes.
 */
const BASE = required("SELLEROPS_BASE_URL");
const EMAIL = required("SELLEROPS_EMAIL");
const PASSWORD = required("SELLEROPS_PASSWORD");
const ACCOUNT = required("RSV_ACCOUNT_ID");
const FROM = required("RSV_FROM");
const TO = required("RSV_TO");

const LOW_RATING_MAX = 2; // a review at/below this rating is "low-rating" for the exclusion check
const ANSWERED_GATE = "이미 답변이 등록된"; // the 409 marker for the answered-review refusal
const APPROVAL_GATE = "승인된 답변이 없습니다"; // the 409 marker a PENDING review hits instead (past the answered gate)

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`missing required env: ${name}`);
    process.exit(2);
  }
  return v;
}

let TOKEN = "";
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const items = (r) => (r.json && (r.json.items || r.json.content)) || [];
const uuid = () =>
  "10000000-0000-4000-8000-" + String(Date.now()).padStart(12, "0").slice(-12); // deterministic-ish, unique per call window
let seq = 0;
const commandId = () => `rsv-${Date.now()}-${seq++}`;

const checks = [];
function check(label, pass, detail) {
  checks.push({ label, pass, detail });
}

async function main() {
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  TOKEN = login.json?.token || login.json?.accessToken || "";
  if (!TOKEN) {
    console.error("login failed");
    process.exit(2);
  }

  const win = `from=${FROM}&to=${TO}&size=200`;
  const arrivals = items(await api("GET", `/api/seller-accounts/${ACCOUNT}/attention/items?type=NEW_REVIEW&${win}`));
  const lowActionable = items(
    await api("GET", `/api/seller-accounts/${ACCOUNT}/attention/items?type=LOW_RATING_REVIEW&${win}`),
  );

  // --- C2 ---------------------------------------------------------------------------------------
  const answeredArrivals = arrivals.filter((i) => i.replyStatus === "ANSWERED");
  const answeredLowRating = answeredArrivals.filter((i) => typeof i.rating === "number" && i.rating <= LOW_RATING_MAX);
  const answeredRefs = new Set(answeredArrivals.map((i) => i.actionRef));
  const answeredInActionable = lowActionable.filter((i) => answeredRefs.has(i.actionRef) || i.replyStatus === "ANSWERED");
  const pendingLowActionable = lowActionable.filter((i) => i.replyStatus === "PENDING");

  check("C2 preserved: ≥1 answered review present in NEW_REVIEW arrivals", answeredArrivals.length >= 1, {
    answeredArrivals: answeredArrivals.length,
    totalArrivals: arrivals.length,
  });
  check("C2 meaningful: ≥1 answered LOW-RATING review exists to test exclusion", answeredLowRating.length >= 1, {
    answeredLowRating: answeredLowRating.length,
  });
  check("C2 exclusion: NO answered review appears in the actionable low-rating queue", answeredInActionable.length === 0, {
    answeredInActionable: answeredInActionable.length,
    actionableTotal: lowActionable.length,
  });
  check("C2 non-vacuous: ≥1 PENDING review remains actionable in the low-rating queue", pendingLowActionable.length >= 1, {
    pendingActionable: pendingLowActionable.length,
  });

  // --- C4 ---------------------------------------------------------------------------------------
  const answered = answeredLowRating[0] || answeredArrivals[0];
  const pending = pendingLowActionable[0];

  if (answered) {
    const view = await api("GET", `/api/seller-accounts/${ACCOUNT}/attention/items/${answered.actionRef}/reply`);
    const cap = view.json?.capabilities || {};
    check("C4 read-only: answered review reports channelReplyState ANSWERED and canStartSubmissionRun=false",
      view.json?.channelReplyState === "ANSWERED" && cap.canStartSubmissionRun === false,
      { channelReplyState: view.json?.channelReplyState, canStartSubmissionRun: cap.canStartSubmissionRun });

    // Triage to RESPONSE_NEEDED so the run reaches the answered gate (which sits AFTER the
    // response-needed gate and BEFORE the approval gate), then attempt the guided run.
    await api("POST", `/api/seller-accounts/${ACCOUNT}/attention/items/${answered.actionRef}/triage`, {
      disposition: "RESPONSE_NEEDED",
      commandId: commandId(),
    });
    const run = await api("POST", `/api/seller-accounts/${ACCOUNT}/attention/items/${answered.actionRef}/reply/submission-run`, {});
    const msg = run.json?.message || run.text || "";
    check("C4 refusal: answered review's guided run is refused 409 on the ANSWERED gate",
      run.status === 409 && msg.includes(ANSWERED_GATE), { status: run.status, gate: "answered" });
  } else {
    check("C4 refusal: an answered review exists to refuse", false, {});
  }

  if (pending) {
    await api("POST", `/api/seller-accounts/${ACCOUNT}/attention/items/${pending.actionRef}/triage`, {
      disposition: "RESPONSE_NEEDED",
      commandId: commandId(),
    });
    const run = await api("POST", `/api/seller-accounts/${ACCOUNT}/attention/items/${pending.actionRef}/reply/submission-run`, {});
    const msg = run.json?.message || run.text || "";
    // The answer-specificity proof: a PENDING review passes the answered gate and is refused LATER on
    // the approval gate — NOT on the answered gate. If it hit the answered gate, the refusal would be
    // vacuous (refusing everything).
    check("C4 answer-specific: a PENDING review is NOT refused on the answered gate (hits the approval gate)",
      run.status === 409 && !msg.includes(ANSWERED_GATE) && msg.includes(APPROVAL_GATE), { status: run.status, gate: "approval" });
  } else {
    check("C4 answer-specific: a pending review exists for the contrast", false, {});
  }

  // --- evidence (sanitized) ---------------------------------------------------------------------
  const c2 = checks.filter((c) => c.label.startsWith("C2"));
  const c4 = checks.filter((c) => c.label.startsWith("C4"));
  const line = (c) => `  [${c.pass ? "PASS" : "FAIL"}] ${c.label}  ${JSON.stringify(c.detail)}`;
  console.log("=== C2 — answered reviews leave the actionable queue (arrivals whole) ===");
  c2.forEach((c) => console.log(line(c)));
  console.log("=== C4 — reply preparation for an answered review is refused (answer-specific) ===");
  c4.forEach((c) => console.log(line(c)));

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${failed.length === 0 ? "ALL PASS" : failed.length + " FAILED"} — ${checks.length} checks`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("harness error:", e.message);
  process.exit(2);
});
