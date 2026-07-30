import { describe, expect, it } from "vitest";
import { parseGoal, routeIntent } from "../../src/goal/parseGoal";
import { AgentRouter } from "../../src/router";
import { InquiryAgentRuntime } from "../../src/runtime";
import { ReviewAgentRuntime } from "../../src/reviewRuntime";
import { IssueAgentRuntime } from "../../src/issueRuntime";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { twoReviews, OLDER_REVIEW_REF } from "../support/reviewFixtures";
import { fourIssues } from "../support/issueFixtures";

describe("review goal parsing + routing", () => {
  it("accepts the explicit review intent and carries the account scope", () => {
    const g = parseGoal({ intent: "HANDLE_REVIEW_REPLIES", accountId: "acct-1" });
    expect(g.intent).toBe("HANDLE_REVIEW_REPLIES");
    expect(g.accountId).toBe("acct-1");
    expect(routeIntent(g.intent)).toBe("REVIEW");
  });

  it("maps review free-text to the review intent (ko + en)", () => {
    expect(parseGoal({ text: "리뷰 답변 좀 준비해줘" }).intent).toBe("HANDLE_REVIEW_REPLIES");
    expect(parseGoal({ text: "후기에 답글 달아줘" }).intent).toBe("HANDLE_REVIEW_REPLIES");
    expect(parseGoal({ text: "prepare the review replies" }).intent).toBe("HANDLE_REVIEW_REPLIES");
  });

  it("maps operations-issue free-text to the issue intent (the three example requests)", () => {
    expect(parseGoal({ text: "최근 악화된 상품 문제 알려줘" }).intent).toBe("HANDLE_OPERATIONS_ISSUES");
    expect(parseGoal({ text: "반복되는 고객 불만 보여줘" }).intent).toBe("HANDLE_OPERATIONS_ISSUES");
    expect(parseGoal({ text: "지금 먼저 확인할 운영 이슈는 뭐야" }).intent).toBe("HANDLE_OPERATIONS_ISSUES");
  });

  it("routes inquiry vs review vs issue intents to three distinct domains", () => {
    expect(routeIntent("HANDLE_UNANSWERED_INQUIRIES")).toBe("INQUIRY");
    expect(routeIntent("HANDLE_REVIEW_REPLIES")).toBe("REVIEW");
    expect(routeIntent("HANDLE_OPERATIONS_ISSUES")).toBe("ISSUE");
  });

  it("keeps review keywords winning over inquiry, and issue keywords distinct from both", () => {
    // "리뷰" (review) must not be shadowed by the broad inquiry "답변"; issue words never collide.
    expect(parseGoal({ text: "리뷰 답변 준비" }).intent).toBe("HANDLE_REVIEW_REPLIES");
    expect(parseGoal({ text: "미답변 문의 처리" }).intent).toBe("HANDLE_UNANSWERED_INQUIRIES");
    expect(parseGoal({ text: "운영 이슈 브리핑" }).intent).toBe("HANDLE_OPERATIONS_ISSUES");
  });
});

describe("AgentRouter coexistence", () => {
  function makeRouter(): {
    router: AgentRouter;
    review: FakeReviewSpringClient;
    inquiry: FakeSpringClient;
    issue: FakeIssueSpringClient;
  } {
    const inquiry = new FakeSpringClient(twoInquiries());
    const review = new FakeReviewSpringClient(twoReviews());
    const issue = new FakeIssueSpringClient(fourIssues());
    const r = new AgentRouter({
      inquiry: new InquiryAgentRuntime({ client: inquiry }),
      review: new ReviewAgentRuntime({ client: review }),
      issue: new IssueAgentRuntime({ client: issue }),
    });
    return { router: r, review, inquiry, issue };
  }

  it("dispatches each of the three intents to its own runtime and touches no other backend", async () => {
    const { router, review, inquiry, issue } = makeRouter();

    const rev = await router.start("t-rev", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });
    expect(rev.domain).toBe("REVIEW");
    expect(rev.result.status).toBe("AWAITING_APPROVAL");
    expect(review.calls.list).toBe(1);
    expect(inquiry.calls.list).toBe(0);
    expect(issue.reads.search).toBe(0);

    const inq = await router.start("t-inq", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    expect(inq.domain).toBe("INQUIRY");
    expect(inq.result.status).toBe("AWAITING_APPROVAL");
    expect(inquiry.calls.list).toBe(1);

    const iss = await router.start("t-iss", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: "2026-07-25" });
    expect(iss.domain).toBe("ISSUE");
    // The issue path has no checkpoint — it finishes at start.
    expect(iss.result.status).toBe("DONE");
    expect(issue.reads.search).toBe(1);
    // Dispatching the issue goal touched neither the review nor the inquiry backend again.
    expect(review.calls.list).toBe(1);
    expect(inquiry.calls.list).toBe(1);
  });

  it("resumes review/inquiry threads by domain, and refuses to resume a checkpoint-free issue run", async () => {
    const { router, review } = makeRouter();
    await router.start("t-rev", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });
    const done = await router.resume("t-rev", { approved: true, approvedBy: "op" });
    expect(done.domain).toBe("REVIEW");
    expect(done.result.status).toBe("DONE");
    expect(review.approvalStateOf(OLDER_REVIEW_REF)).toBe("APPROVED");

    await router.start("t-iss", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: "2026-07-25" });
    await expect(router.resume("t-iss", { approved: true, approvedBy: "op" })).rejects.toThrow(
      /no checkpoint to resume/,
    );
  });
});
