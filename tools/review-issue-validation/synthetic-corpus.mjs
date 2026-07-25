// Generates the synthetic review corpus the issue-memory proof needs, as CSV on stdout.
//
// WHY SYNTHETIC AND WHY 5★. Every row here is rated 5. That is the whole point: the shipped analyzer
// derives sentiment and urgency from `rating`, so a 5★ review complaining about delivery is invisible
// to the needs-a-look queue. A corpus of 5★ complaints therefore proves two things at once —
//   1. issues and change judgements appear from reviews the queue cannot see, and
//   2. the queue's own LOW_RATING_REVIEW count does not move (the regression gate in
//      contracts/review-eval/naver/v1/RUBRIC.md §5).
//
// Dates are computed backwards from a reference date passed in, so each judgement lands in the window
// contracts/review-issue/v1/THRESHOLDS.md defines for it. Nothing here reads a clock.
//
//   node synthetic-corpus.mjs 2026-07-25 > corpus.csv

const reference = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(reference || "")) {
  console.error("usage: node synthetic-corpus.mjs <YYYY-MM-DD>");
  process.exit(2);
}

/** Reference minus N days, as YYYY-MM-DD. UTC arithmetic, matching how received_at is stored. */
function minus(days) {
  const d = new Date(`${reference}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const BODY = {
  // Each body carries exactly one aspect keyword and one problem keyword, so the expected signature
  // is unambiguous and a change in the vocabulary shows up as a failed assertion rather than as a
  // quietly different issue.
  crack: "검증용 합성 리뷰 - 표면이 갈라졌습니다",
  late: "검증용 합성 리뷰 - 배송이 늦었습니다",
  hard: "검증용 합성 리뷰 - 설치가 어려웠습니다",
  colour: "검증용 합성 리뷰 - 색상이 사진과 다릅니다",
};

const rows = [];
let nextId = 9000000;
function row(body, daysAgo, product) {
  rows.push({
    product,
    rating: 5, // never 1-2: see the header note
    body,
    date: minus(daysAgo),
    id: `SYN-${nextId++}`,
  });
}

// 새로 나타남 — three inside the 14-day NEW window, nothing before it anywhere in the corpus.
[1, 5, 10].forEach((d) => row(BODY.crack, d, "이슈검증 몰딩 A"));

// 증가 중 — a 4-piece baseline across the preceding 8 weeks, then 4 in the current 7 days.
// Products are spread so the top share stays under 0.60 and this issue tests SURGING alone.
[54, 40, 26, 15].forEach((d, i) => row(BODY.late, d, `이슈검증 몰딩 ${"ABC"[i % 3]}`));
[6, 4, 2, 0].forEach((d, i) => row(BODY.late, d, `이슈검증 몰딩 ${"ABC"[i % 3]}`));

// 계속 발생 + 특정 상품 집중 — active in 4 of the last 6 weeks (never 4+ in one week, so not a
// surge), and 5 pieces inside the 28-day concentration window all on one product.
[5, 11, 17, 24, 25].forEach((d) => row(BODY.hard, d, "이슈검증 몰딩 A"));

// 개선됨 — 8 pieces across the baseline 4 weeks (2.0/week) down to 1 in the current 4 weeks.
[53, 50, 46, 43, 39, 36, 32, 29].forEach((d) => row(BODY.colour, d, "이슈검증 몰딩 B"));
[23].forEach((d) => row(BODY.colour, d, "이슈검증 몰딩 B"));

const csv = ["상품명,평점,내용,작성일,리뷰id"];
for (const r of rows) {
  csv.push(`${r.product},${r.rating},${r.body},${r.date},${r.id}`);
}
process.stdout.write(csv.join("\n") + "\n");
