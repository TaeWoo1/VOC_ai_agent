// Issue-memory proof assertions against a RUNNING backend (disposable, seeded by run-synthetic.sh).
//
// This is the only place V29 + the JPA mapping + the change judgements are exercised together against
// real Postgres. The JVM suite runs H2 with Flyway disabled, so a migration that disagreed with the
// entities is green there and fails only here.
//
// Env: SELLEROPS_BASE_URL, RIV_TOKEN, RIV_ACCOUNT_ID, RIV_REFERENCE_DATE, RIV_FROM, RIV_TO

const BASE = process.env.SELLEROPS_BASE_URL;
const TOKEN = process.env.RIV_TOKEN;
const ACCOUNT = process.env.RIV_ACCOUNT_ID;
const REF = process.env.RIV_REFERENCE_DATE;
const FROM = process.env.RIV_FROM;
const TO = process.env.RIV_TO;

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const issueByTitle = (list, title) => list.find((i) => i.title === title);
const kindsOf = (issue) => (issue ? issue.change.kinds : []);

// ---------------------------------------------------------------------------------------------

/**
 * Total LOW_RATING_REVIEW count in the attention summary. The field is `items`, not `signals` —
 * reading the wrong key silently yields 0, which would make the regression gate below pass by
 * comparing nothing to nothing. That is the same vacuous-check failure the concentration floor in
 * THRESHOLDS.md §2.4 exists to prevent, so the baseline is asserted non-zero rather than trusted.
 */
function lowRatingTotal(summary) {
  return (summary?.items || [])
    .filter((s) => s.type === "LOW_RATING_REVIEW")
    .reduce((sum, s) => sum + s.count, 0);
}

console.log("== the needs-a-look queue BEFORE extraction ==");
const attentionBefore = await api(
  `/api/seller-accounts/${ACCOUNT}/attention?from=${FROM}&to=${TO}`);
const lowRatingBefore = lowRatingTotal(attentionBefore.body);
check("attention endpoint answers", attentionBefore.status === 200, attentionBefore.status);
console.log(`  LOW_RATING_REVIEW total before: ${lowRatingBefore}`);
check(
  "the queue baseline is non-zero, so the regression gate below is not vacuous",
  lowRatingBefore > 0,
  `read ${lowRatingBefore} from items=${JSON.stringify(attentionBefore.body?.items)}`);
check(
  "the baseline matches the golden export's committed expectation (1 HIGH + 1 MEDIUM)",
  lowRatingBefore === 2, lowRatingBefore);

console.log("== extract ==");
const extract = await api("/api/review-issues/extract?limit=500", { method: "POST" });
check("extraction succeeds", extract.status === 200, extract.status);
console.log(`  ${JSON.stringify(extract.body)}`);
check("extraction attached evidence", (extract.body?.evidenceAdded || 0) > 0);
check("extraction created issues", (extract.body?.issuesCreated || 0) > 0);
check(
  "unattributable units were recorded rather than forced into an issue",
  (extract.body?.unknownAdded || 0) > 0);

console.log("== re-extract is a no-op (the import path is resumable) ==");
const again = await api("/api/review-issues/extract?limit=500", { method: "POST" });
check("re-extraction adds no evidence", again.body?.evidenceAdded === 0, JSON.stringify(again.body));
check("re-extraction creates no issue", again.body?.issuesCreated === 0);
check("re-extraction reopens nothing", again.body?.issuesReopened === 0);

console.log("== the regression gate: a detector may only ADD (RUBRIC.md §5) ==");
const attentionAfter = await api(
  `/api/seller-accounts/${ACCOUNT}/attention?from=${FROM}&to=${TO}`);
const lowRatingAfter = lowRatingTotal(attentionAfter.body);
check(
  "LOW_RATING_REVIEW count is unchanged by extraction",
  lowRatingBefore === lowRatingAfter,
  `${lowRatingBefore} → ${lowRatingAfter}`);

console.log("== issues from 5-star reviews the queue cannot see ==");
const listed = await api(`/api/review-issues?referenceDate=${REF}`);
check("issue list answers", listed.status === 200, listed.status);
const issues = Array.isArray(listed.body) ? listed.body : [];
for (const issue of issues) {
  console.log(
    `  ${issue.title.padEnd(12)} sev=${issue.severity.padEnd(6)} n=${String(issue.evidenceCount).padStart(3)}` +
    ` state=${issue.lifecycleState.padEnd(12)} change=[${issue.change.kinds.join(",")}]` +
    ` product=${issue.dominantProductName ?? "-"}`);
}
check("issues exist", issues.length > 0);
check(
  "every issue is provenance-labelled rule-based",
  issues.every((i) => i.extractorKind === "RULE_BASED"));

console.log("== each judgement fires in the window the contract defines ==");
check("표면 균열 is 새로 나타남", kindsOf(issueByTitle(issues, "표면 균열")).includes("NEW"),
  kindsOf(issueByTitle(issues, "표면 균열")).join(","));
check("배송 지연 is 증가 중", kindsOf(issueByTitle(issues, "배송 지연")).includes("SURGING"),
  kindsOf(issueByTitle(issues, "배송 지연")).join(","));
check("설치 난이도 is 계속 발생", kindsOf(issueByTitle(issues, "설치 난이도")).includes("PERSISTENT"),
  kindsOf(issueByTitle(issues, "설치 난이도")).join(","));
check("설치 난이도 is also 특정 상품 집중",
  kindsOf(issueByTitle(issues, "설치 난이도")).includes("CONCENTRATED"));
check("색상 불일치 is 개선됨", kindsOf(issueByTitle(issues, "색상 불일치")).includes("IMPROVED"),
  kindsOf(issueByTitle(issues, "색상 불일치")).join(","));

console.log("== the suppression and overlap rules hold on real data ==");
check(
  "a surging issue is not also labelled 계속 발생",
  !kindsOf(issueByTitle(issues, "배송 지연")).includes("PERSISTENT"));
check(
  "a spread-across-products issue is not 특정 상품 집중",
  !kindsOf(issueByTitle(issues, "배송 지연")).includes("CONCENTRATED"));
check(
  "the concentrated issue names its product",
  issueByTitle(issues, "설치 난이도")?.dominantProductName === "이슈검증 몰딩 A",
  issueByTitle(issues, "설치 난이도")?.dominantProductName);
check(
  "the quantified surge line carries its own numbers",
  issueByTitle(issues, "배송 지연")?.change.surgeWindowCount === 4
    && issueByTitle(issues, "배송 지연")?.change.surgeBaselineWeekly === 0.5,
  JSON.stringify(issueByTitle(issues, "배송 지연")?.change));
check(
  "a MEDIUM surge is not reported as a high one",
  issueByTitle(issues, "배송 지연")?.change.highSurge === false);

console.log("== 개선됨 never raises an issue for review ==");
const beforePass = issues.map((i) => `${i.title}:${i.lifecycleState}`);
const lifecyclePass = await api(`/api/review-issues/lifecycle-pass?referenceDate=${REF}`,
  { method: "POST" });
check("lifecycle pass succeeds", lifecyclePass.status === 200, lifecyclePass.status);
console.log(`  ${JSON.stringify(lifecyclePass.body)}`);
const afterPass = (await api(`/api/review-issues?referenceDate=${REF}`)).body;
check(
  "the improved-only issue stays 관찰 중",
  issueByTitle(afterPass, "색상 불일치")?.lifecycleState === "OBSERVING",
  issueByTitle(afterPass, "색상 불일치")?.lifecycleState);
check(
  "issues with a firing judgement moved to 확인 필요",
  ["표면 균열", "배송 지연", "설치 난이도"].every(
    (t) => issueByTitle(afterPass, t)?.lifecycleState === "NEEDS_REVIEW"),
  beforePass.join(" "));

console.log("== the lifecycle pass is idempotent for a reference date ==");
const secondPass = await api(`/api/review-issues/lifecycle-pass?referenceDate=${REF}`,
  { method: "POST" });
check("second pass raises nothing", secondPass.body?.raisedForReview === 0,
  JSON.stringify(secondPass.body));
check("second pass resolves nothing", secondPass.body?.resolved === 0);

console.log("== the operator path, and the fence around 해결됨 ==");
const target = issueByTitle(afterPass, "표면 균열");
const acting = await api(`/api/review-issues/${target.id}/acting`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ note: "검증용 조치 기록" }),
});
check("확인 필요 → 조치 중 succeeds", acting.status === 200 && acting.body?.lifecycleState === "ACTING",
  `${acting.status} ${acting.body?.lifecycleState}`);
const skipped = await api(`/api/review-issues/${target.id}/acting`, { method: "POST" });
check("조치 중 cannot be entered twice", skipped.status >= 400, skipped.status);

const remediated = await api(`/api/review-issues/${target.id}/remediated`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ note: "공급처 변경 완료" }),
});
check("조치 중 → 개선 확인 중 succeeds",
  remediated.body?.lifecycleState === "VERIFYING", remediated.body?.lifecycleState);

// 표면 균열's newest evidence is 1 day old, so 4 quiet weeks have NOT passed.
const resolveTooEarly = await api(`/api/review-issues/lifecycle-pass?referenceDate=${REF}`,
  { method: "POST" });
check("an issue with recent evidence is not resolved", resolveTooEarly.body?.resolved === 0,
  JSON.stringify(resolveTooEarly.body));

// Move the reference date far enough forward that the quiet window is genuinely empty.
const laterRef = (() => {
  const d = new Date(`${REF}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 40);
  return d.toISOString().slice(0, 10);
})();
const resolvedPass = await api(`/api/review-issues/lifecycle-pass?referenceDate=${laterRef}`,
  { method: "POST" });
check("개선 확인 중 → 해결됨 after quiet weeks", resolvedPass.body?.resolved >= 1,
  JSON.stringify(resolvedPass.body));

console.log("== evidence, quotes, and what must NOT be in a response ==");
const detail = await api(`/api/review-issues/${target.id}?referenceDate=${REF}`);
check("detail answers", detail.status === 200, detail.status);
check("detail carries its evidence", (detail.body?.evidence || []).length === 3,
  (detail.body?.evidence || []).length);
check("evidence carries the masked opinion unit, not the whole body",
  (detail.body?.evidence || []).every(
    (e) => e.quote === null || (typeof e.quote === "string" && e.quote.length <= 60)),
  JSON.stringify((detail.body?.evidence || []).map((e) => e.quote)));
check("history records who did what",
  (detail.body?.history || []).some((h) => h.actor === "SYSTEM")
    && (detail.body?.history || []).some((h) => h.actor === "OPERATOR"),
  JSON.stringify((detail.body?.history || []).map((h) => `${h.actor}:${h.reason}`)));
check("the operator's own note is preserved",
  (detail.body?.history || []).some((h) => h.note === "검증용 조치 기록"));

const detailText = JSON.stringify(detail.body);
check("no raw seller identity leaks into the detail response",
  !detailText.includes("orgId") && !detailText.includes("sellerAccountId"),
  detailText.slice(0, 200));

console.log("== dismissal must not become a recurring nag ==");
const dismissed = await api(`/api/review-issues/${target.id}/dismiss`, { method: "POST" });
check("dismiss succeeds", dismissed.body?.dismissed === true, JSON.stringify(dismissed.body));
const afterDismiss = (await api(`/api/review-issues?referenceDate=${REF}`)).body;
check("a dismissed issue leaves the list",
  !issueByTitle(afterDismiss, "표면 균열"), afterDismiss.map((i) => i.title).join(","));

// Without a readable archive, dismissal is a one-way door: the row survives on purpose (so the next
// extraction cannot recreate it and announce it as new), which means nothing else could reach it.
const archive = await api(`/api/review-issues?referenceDate=${REF}&dismissed=true`);
check("the dismissed archive is readable, so dismissal is undoable",
  archive.status === 200 && !!issueByTitle(archive.body, "표면 균열"),
  `${archive.status} ${(archive.body || []).map((i) => i.title).join(",")}`);
check("the archive holds only dismissed issues",
  (archive.body || []).every((i) => i.dismissed === true));
check("the working list and the archive do not overlap",
  !(archive.body || []).some((a) => afterDismiss.some((w) => w.id === a.id)));
const reextract = await api("/api/review-issues/extract?limit=500", { method: "POST" });
check("re-extraction does not recreate the dismissed issue",
  reextract.body?.issuesCreated === 0, JSON.stringify(reextract.body));
const restored = await api(`/api/review-issues/${target.id}/restore`, { method: "POST" });
check("restore returns it to where it was",
  restored.body?.dismissed === false && restored.body?.lifecycleState === "RESOLVED",
  `${restored.body?.dismissed} ${restored.body?.lifecycleState}`);

console.log("== cross-org isolation ==");
const foreign = await api("/api/review-issues/00000000-0000-0000-0000-000000000000");
check("an unknown issue id is refused, not answered", foreign.status >= 400, foreign.status);

console.log("");
console.log(`== ${pass} passed, ${fail} failed ==`);
// Printed on every run, including a clean one. A green result is easy to quote out of context, and
// what it does NOT establish is the thing someone would most want it to.
console.log("== scope of this result ==");
console.log("  Behaviour only. This does NOT measure whether the issues are the right issues:");
console.log("  the extractor is UNMEASURED (contracts/review-eval/naver/v1/labels.json is empty) and");
console.log("  the thresholds are a DRAFT awaiting product-owner confirmation.");
process.exit(fail === 0 ? 0 : 1);
