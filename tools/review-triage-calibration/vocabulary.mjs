/**
 * The closed vocabularies of `contracts/review-eval/naver/v2/RUBRIC.md`, in one place so the
 * labeling surface offers exactly what the committed file may hold. A value the worksheet can
 * produce but `labels.json` may not carry would be lost silently, after a human spent the time.
 *
 * `tags` is `ItemAnalysisCategories.ORDERED` — the vocabulary the product already stores and
 * filters on, so a measured tag is comparable to a shown tag. Kept in the same order.
 */

export const TIERS = [
  { code: "NEEDS_ATTENTION", ko: "확인 필요", hint: "판매자가 답하거나, 확인하거나, 고쳐야 함" },
  { code: "WATCH", ko: "지켜보기", hint: "이 한 건은 할 일이 없지만, 반복되면 문제인 종류" },
  { code: "FYI", ko: "참고", hint: "판매자가 할 일이 없음" },
  { code: "UNCERTAIN", ko: "모르겠음", hint: "정말 애매하면 이걸 고르세요. 모든 지표에서 제외됩니다" },
];

export const REASON_CODES = [
  { code: "DEFECT_OR_DAMAGE", ko: "하자·파손·고장", side: "actionable" },
  { code: "WRONG_OR_MISSING", ko: "오배송·누락·수량 부족", side: "actionable" },
  { code: "DELIVERY_PROBLEM", ko: "배송 지연·사고·기사 응대", side: "actionable" },
  { code: "PACKAGING_PROBLEM", ko: "포장 상태", side: "actionable" },
  { code: "NOT_AS_DESCRIBED", ko: "설명·사진과 다름", side: "actionable" },
  { code: "CANNOT_USE", ko: "설치·사용이 되지 않음", side: "actionable" },
  { code: "EXPLICIT_REQUEST", ko: "교환·환불·재발송·답변 요구", side: "actionable" },
  { code: "PRAISE_WITH_CONCESSION", ko: "만족하지만 하나를 문제로 짚음", side: "actionable" },
  { code: "PRAISE_ONLY", ko: "칭찬뿐", side: "not-actionable" },
  { code: "CRITIQUE_NO_REQUEST", ko: "아쉬움만, 요구는 없음", side: "not-actionable" },
  { code: "NEUTRAL_DESCRIPTION", ko: "사실 서술", side: "not-actionable" },
  { code: "TEXTLESS_OR_NOISE", ko: "본문이 없거나 의미 없음", side: "not-actionable" },
  { code: "OFF_TOPIC", ko: "상품과 무관", side: "not-actionable" },
];

/** `ItemAnalysisCategories.ORDERED`. 기타 last, as there. */
export const TAGS = ["배송", "교환", "제품정보", "설치", "가격", "품질", "색상", "사이즈", "기타"];

export const MAX_TAGS = 2;

export const TIER_CODES = new Set(TIERS.map((t) => t.code));
export const REASON_CODE_SET = new Set(REASON_CODES.map((r) => r.code));
export const TAG_SET = new Set(TAGS);

/**
 * RUBRIC v2 section 4.2. Rating band × body length in CODE POINTS — the same unit Postgres
 * `length()` and Java `codePointCount` count, so the three places that compute a stratum cannot
 * disagree on a review containing an emoji.
 */
export function stratumOf(rating, bodyCodePoints) {
  const band = rating == null ? null : rating <= 2 ? "LOW" : rating === 3 ? "MID" : "HIGH";
  if (band == null) return null;
  const size = bodyCodePoints >= 40 ? "L" : bodyCodePoints >= 20 ? "M" : "S";
  return `${band}_${size}`;
}

/**
 * RUBRIC v2 section 7.3 — the rows both people label independently, by rating band rather than in
 * the sample's own proportions. A uniform overlap would be ~26 rows of 5-star praise and would
 * measure agreement on the easy class while saying nothing about the scarce one the gates are about.
 */
export const OVERLAP_ALLOCATION = {
  LOW_S: 2,
  LOW_M: 2,
  LOW_L: 2,
  MID_S: 4,
  MID_M: 4,
  MID_L: 2,
  HIGH_L: 8,
  HIGH_M: 4,
  HIGH_S: 2,
};

/**
 * RUBRIC v2 section 7.2 — the owner's worked examples, drawn from OUTSIDE the sample.
 *
 * Only the 4-5 star strata appear, and that is forced rather than chosen: every 1-3 star review in
 * the frame is inside the sample, so no low-rated row exists outside it to teach on. The low-rating
 * tie-breakers are taught by RUBRIC v1 section 2's own worked cases, printed on every page.
 */
export const CALIBRATION_ALLOCATION = { HIGH_L: 10, HIGH_M: 8, HIGH_S: 6 };

/** The draw of RUBRIC v2 section 4.2, as counts per stratum. */
export const ALLOCATION = {
  LOW_S: Infinity,
  LOW_M: Infinity,
  LOW_L: Infinity,
  MID_S: Infinity,
  MID_M: Infinity,
  MID_L: Infinity,
  HIGH_S: 30,
  HIGH_M: 40,
  HIGH_L: 45,
};
