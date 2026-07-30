import { describe, expect, it } from "vitest";
import { parseGoal, routeIntent } from "../../src/goal/parseGoal";
import { AgentRouter } from "../../src/router";
import { InquiryAgentRuntime } from "../../src/runtime";
import { ReviewAgentRuntime } from "../../src/reviewRuntime";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { twoInquiries } from "../support/fixtures";
import { twoReviews, OLDER_REVIEW_REF } from "../support/reviewFixtures";

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

  it("routes inquiry vs review intents to distinct domains", () => {
    expect(routeIntent("HANDLE_UNANSWERED_INQUIRIES")).toBe("INQUIRY");
    expect(routeIntent("HANDLE_REVIEW_REPLIES")).toBe("REVIEW");
  });
});

describe("AgentRouter coexistence", () => {
  function makeRouter(): { router: AgentRouter; review: FakeReviewSpringClient; inquiry: FakeSpringClient } {
    const inquiry = new FakeSpringClient(twoInquiries());
    const review = new FakeReviewSpringClient(twoReviews());
    const r = new AgentRouter({
      inquiry: new InquiryAgentRuntime({ client: inquiry }),
      review: new ReviewAgentRuntime({ client: review }),
    });
    return { router: r, review, inquiry };
  }

  it("dispatches a review goal to the review runtime and an inquiry goal to the inquiry runtime", async () => {
    const { router, review, inquiry } = makeRouter();

    const rev = await router.start("t-rev", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });
    expect(rev.domain).toBe("REVIEW");
    expect(rev.result.status).toBe("AWAITING_APPROVAL");
    // Only the review backend was touched.
    expect(review.calls.list).toBe(1);
    expect(inquiry.calls.list).toBe(0);

    const inq = await router.start("t-inq", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    expect(inq.domain).toBe("INQUIRY");
    expect(inq.result.status).toBe("AWAITING_APPROVAL");
    expect(inquiry.calls.list).toBe(1);
  });

  it("resumes each thread against the domain it started in", async () => {
    const { router, review } = makeRouter();
    await router.start("t-rev", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });
    const done = await router.resume("t-rev", { approved: true, approvedBy: "op" });
    expect(done.domain).toBe("REVIEW");
    expect(done.result.status).toBe("DONE");
    expect(review.approvalStateOf(OLDER_REVIEW_REF)).toBe("APPROVED");
  });
});
