// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, it, vi } from "vitest";
import { VocItemReplyPrep } from "./VocItemReplyPrep";
import { api } from "../lib/apiClient";
import { expectNoAxeViolations } from "../test/axe";
import type { ReviewReplyPrep } from "../lib/types";

vi.mock("../lib/apiClient", () => ({
  api: {
    getReviewReplyPrep: vi.fn(),
    saveReviewReplyDraft: vi.fn(),
    decideReviewReplyApproval: vi.fn(),
  },
}));

// axe scans of the reply panel across its rendered states.
//
// Worth scanning per-state rather than once: the panel swaps controls in and out as the
// approval moves (승인 → 승인 해제 + 복사) and turns the editor read-only, and each of
// those is a chance to ship a control with no accessible name or an aria-disabled that
// contradicts its role.

const REF = "review:mock-voc-0";

function prepView(over: Partial<ReviewReplyPrep> = {}): ReviewReplyPrep {
  return {
    actionRef: REF,
    redactedBody: "합성-리뷰-본문: 배송이 너무 늦었습니다",
    bodyRedacted: true,
    triageDisposition: "RESPONSE_NEEDED",
    suggestion: {
      body: "합성-추천-초안",
      category: "delivery_reply",
      providerKind: "RULE_BASED",
      providerName: "review-reply-template",
      providerVersion: "templates-v1",
    },
    draft: null,
    approval: null,
    outcome: null,
    capabilities: { canSave: true, canApprove: false, canWithdraw: false, canCopy: false, canStartSubmissionRun: false },
    ...over,
  };
}

const DRAFT = {
  version: 1,
  body: "합성-저장된-초안",
  contentFingerprint: "mock-abc",
  fingerprintAlgorithm: "review-reply-v1",
  createdAt: "2026-07-17T00:00:00Z",
};

describe("VocItemReplyPrep a11y", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function scan(view: ReviewReplyPrep) {
    vi.mocked(api.getReviewReplyPrep).mockResolvedValue(view);
    const { container } = render(
      <VocItemReplyPrep
        accountId="mock-acct-1"
        actionRef={REF}
        disposition={view.triageDisposition}
      />,
    );
    await screen.findByRole("heading", { name: "답변 준비" });
    await expectNoAxeViolations(container);
  }

  it("has no violations before anything is drafted", async () => {
    await scan(prepView());
  });

  it("has no violations with a saved draft awaiting approval", async () => {
    await scan(
      prepView({
        draft: DRAFT,
        capabilities: { canSave: true, canApprove: true, canWithdraw: false, canCopy: false, canStartSubmissionRun: false },
      }),
    );
  });

  it("has no violations once approved (frozen editor, copy offered)", async () => {
    await scan(
      prepView({
        draft: DRAFT,
        approval: {
          state: "APPROVED",
          approvedVersion: 1,
          approvedFingerprint: "mock-abc",
          approvedBody: "합성-저장된-초안",
          decidedAt: "2026-07-17T00:00:00Z",
        },
        capabilities: { canSave: false, canApprove: false, canWithdraw: true, canCopy: true, canStartSubmissionRun: true },
      }),
    );
  });

  it("has no violations when the review has left 대응 필요", async () => {
    await scan(
      prepView({
        triageDisposition: "MONITOR",
        draft: DRAFT,
        capabilities: { canSave: false, canApprove: false, canWithdraw: false, canCopy: false, canStartSubmissionRun: false },
      }),
    );
  });
});
