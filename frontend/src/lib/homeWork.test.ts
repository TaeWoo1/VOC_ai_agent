import { describe, expect, it } from "vitest";
import { mergeHomeWork } from "./homeWork";
import type { OperationsHome, OperatorVocItem, ReviewWorkView } from "./types";
import type { CustomerOperationsHome } from "./customerOperationsTypes";

/**
 * <b>확인할 일 holds every piece of review work</b> (UI/UX v2 Phase 3). The audit found two holes: the list read
 * the Home's three-row slice of undecided 확인 필요 reviews (11 existed, 3 were listed, nothing said so), and the
 * seller's own reply work before approval — 초안 필요 / 승인 대기 — was reachable only from the 리뷰 screen's
 * 「내 답변 작업」. These pin the composer that closes both, without re-deciding anything.
 */
const NOW = new Date("2026-09-22T03:00:00Z");

function attention(id: string) {
  return { reviewId: id, accountId: null, channelCode: "NAVER", rating: 1, occurredOn: "2026-09-01", productName: "상품", quote: `불만 ${id}` };
}

function ops(rows: ReturnType<typeof attention>[]): OperationsHome {
  return {
    reviews: { needsAttentionUndecided: 11, needsAttentionTotal: 14, watchTotal: 0, rows },
    problems: { decidable: 0, observing: 0, dormant: 0, rows: [] },
    collection: [],
    prepared: { reviewRepliesApproved: 0, inquiryDraftsReady: 0, improvementDraftsReady: 0, rows: [] },
  } as unknown as OperationsHome;
}

function todo(reviewId: string, state: "DRAFT_NEEDED" | "AWAITING_APPROVAL"): OperatorVocItem {
  return {
    channelCode: "NAVER", channelNameKo: "네이버 스마트스토어", sourceType: "REVIEW", productName: "선바로", rating: 4,
    replyStatus: "PENDING", sourceCreatedDate: "2026-08-28", collectedDate: "2026-08-29", signalType: "LOW_RATING_REVIEW",
    safePreview: `답변할 리뷰 ${reviewId}`, actionRef: `review:${reviewId}`, reviewId, triageDisposition: "RESPONSE_NEEDED",
    hasReplyPreparation: state === "AWAITING_APPROVAL", replyWorkState: state, category: null, hasReportedSubmission: false,
  } as OperatorVocItem;
}

function reviewWork(attentionRows: ReturnType<typeof attention>[], total: number, items: OperatorVocItem[]): ReviewWorkView {
  return {
    attentionTotal: total,
    attention: attentionRows,
    committed: [{ accountId: "acc-nv", channelCode: "NAVER", channelNameKo: "네이버", coverage: "COVERED", todo: items, recentlyReported: [] }],
  } as unknown as ReviewWorkView;
}

describe("mergeHomeWork — the review half, whole", () => {
  it("lists every undecided 확인 필요 review, not the Home's three", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => attention(`a${i}`));
    const work = mergeHomeWork(null, ops(eleven.slice(0, 3)), null, NOW, reviewWork(eleven, 11, []));
    expect(work.rows.filter((r) => r.reason.tag === "리뷰")).toHaveLength(11);
    expect(work.truncated).toBe(false);
  });

  it("says the list is deeper than the read when the server holds more than it returned", () => {
    const work = mergeHomeWork(null, null, null, NOW, reviewWork([attention("a1")], 150, []));
    expect(work.truncated).toBe(true);
  });

  it("carries the seller's own reply work before approval, in the workState words, opening the Review Case", () => {
    const work = mergeHomeWork(null, null, null, NOW,
      reviewWork([], 0, [todo("r-draft", "DRAFT_NEEDED"), todo("r-approve", "AWAITING_APPROVAL")]));
    const byId = Object.fromEntries(work.rows.map((r) => [r.subjectId, r]));
    expect(byId["r-draft"].reason.tag).toBe("초안 필요");
    expect(byId["r-approve"].reason.tag).toBe("승인 대기");
    expect(byId["r-approve"].line).toContain("미발송");
    expect(byId["r-draft"].to).toBe("/reviews/reply/r-draft");
    expect(byId["r-draft"].kind).toBe("REVIEW");
  });

  it("a case about the same review wins — one review is one row", () => {
    const co = {
      decisions: { total: 1, rows: [{
        caseId: "c-1", subjectKind: "REVIEW", channelNameKo: "네이버", title: "케이스", rating: 2, reasonNote: "",
        summary: null, recommendedActionType: null, recommendedAction: null, missingInformation: [], draftPrepared: false,
        decidedBy: "RULE", openedAt: "2026-09-01T00:00:00Z", to: "/reviews/reply/r-draft",
      }] },
      handled: { rows: [] },
    } as unknown as CustomerOperationsHome;
    const work = mergeHomeWork(co, null, null, NOW, reviewWork([], 0, [todo("r-draft", "DRAFT_NEEDED")]));
    expect(work.rows).toHaveLength(1);
    expect(work.rows[0].kind).toBe("CASE");
  });

  it("without the read, the list is what it was — the Home's own rows", () => {
    const work = mergeHomeWork(null, ops([attention("a1"), attention("a2"), attention("a3")]), null, NOW);
    expect(work.rows).toHaveLength(3);
  });
});
