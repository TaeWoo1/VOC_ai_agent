// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ApprovalArtifact } from "./ApprovalArtifact";
import type { ApprovalArtifact as Approval } from "../../../lib/conversation/types";

const getInquiryDetailStrict = vi.fn();
const getInquiryPublishCapability = vi.fn();
const confirmInquiryPublish = vi.fn();
const getReviewReplyPrep = vi.fn();
const executeReviewReply = vi.fn();
vi.mock("../../../lib/apiClient", () => ({
  api: {
    getInquiryDetailStrict: (id: string) => getInquiryDetailStrict(id),
    getInquiryPublishCapability: () => getInquiryPublishCapability(),
    confirmInquiryPublish: (...a: unknown[]) => confirmInquiryPublish(...a),
    getReviewReplyPrep: (...a: unknown[]) => getReviewReplyPrep(...a),
    executeReviewReply: (...a: unknown[]) => executeReviewReply(...a),
  },
  getToken: () => null,
}));

const ARTIFACT: Approval = {
  artifactId: "ap-1",
  type: "APPROVAL",
  title: "전송 승인",
  objectKind: "INQUIRY",
  targetId: "w-1",
  workItemId: "w-1",
  inquiryId: "i-1",
  channelCode: "CAFE24",
  channelNameKo: "카페24 자사몰",
  draftVersion: 2,
  contentFingerprint: "fp-2",
  execution: "API_EXECUTION",
  executableIdentity: "MARKETPLACE",
  to: "/inquiries/i-1",
};

const REVIEW: Approval = {
  artifactId: "ap-r",
  type: "APPROVAL",
  title: "답변 전송 승인",
  objectKind: "REVIEW",
  targetId: "rv-1",
  accountId: "acc-c24",
  actionRef: "ref-1",
  channelCode: "CAFE24",
  channelNameKo: "카페24 자사몰",
  draftVersion: 1,
  contentFingerprint: "rfp-1",
  execution: "API_EXECUTION",
  executableIdentity: "MARKETPLACE",
  to: "/reviews/rv-1",
};

function prep(approvedFingerprint = "rfp-1") {
  return {
    actionRef: "ref-1", redactedBody: null, bodyRedacted: false, triageDisposition: "RESPONSE_NEEDED",
    suggestion: { body: "x" }, draft: { version: 1, body: "감사합니다.", contentFingerprint: approvedFingerprint, fingerprintAlgorithm: "sha256", createdAt: "x" },
    approval: { state: "APPROVED", approvedVersion: 1, approvedFingerprint, approvedBody: "소중한 후기 감사합니다.", decidedAt: "x" },
    outcome: null, capabilities: { canSave: false, canApprove: false, canWithdraw: true, canCopy: true, canStartSubmissionRun: false },
    channelReplyState: null, productName: null, reviewDate: null, rating: 5,
  };
}

function detail(fingerprint = "fp-2") {
  return {
    workItemId: "w-1", inquiryId: "i-1", channelCode: "CAFE24", channelNameKo: "카페24 자사몰", status: "UNANSWERED", phase: "PROPOSED",
    replyCapability: null,
    draft: { version: 2, answerStatus: 0, title: "t", comments: "안녕하세요. 확인 후 안내드리겠습니다.", contentFingerprint: fingerprint, fingerprintAlgorithm: "sha256", createdAt: "x", authorKind: "MODEL", modelVersion: null, knowledgeState: null, knowledgeNote: null, answerBasis: null, answerBasisNote: null, answerBasisAction: null },
  };
}

beforeEach(() => {
  getInquiryDetailStrict.mockReset();
  getInquiryPublishCapability.mockReset();
  confirmInquiryPublish.mockReset();
  getReviewReplyPrep.mockReset();
  executeReviewReply.mockReset();
});

describe("approval artifact — the confirm step is the only way to the one write", () => {
  it("a first press reveals the confirm step; the second calls confirm once with the exact fingerprint", async () => {
    getInquiryDetailStrict.mockResolvedValue(detail());
    getInquiryPublishCapability.mockResolvedValue({ executionEnabled: true, replyAdapterChannelCodes: ["CAFE24"] });
    confirmInquiryPublish.mockResolvedValue({ workItemId: "w-1", phase: "EXECUTED", executionStatus: "DONE", category: "COMPLETED", approvedDraftVersion: 2, approvedFingerprint: "fp-2", providerMessageNo: null, resultCode: null, presendStateProven: null, presendNote: null });
    render(<MemoryRouter><ApprovalArtifact artifact={ARTIFACT} /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "답변 보내기" }));
    expect(confirmInquiryPublish).not.toHaveBeenCalled();
    expect(screen.getByText("정말 보내시겠습니까?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "승인하고 전송" }));
    await waitFor(() => expect(confirmInquiryPublish).toHaveBeenCalledTimes(1));
    const [workItemId, request] = confirmInquiryPublish.mock.calls[0] as [string, { commandId: string; expectedFingerprint: string }];
    expect(workItemId).toBe("w-1");
    expect(request.expectedFingerprint).toBe("fp-2");
    expect(request.commandId).toMatch(/[0-9a-f-]{20,}/);
    expect(await screen.findByText("답변이 등록되었습니다.")).toBeInTheDocument();
    expect(screen.getByText("전송됨")).toBeInTheDocument();
  });

  it("when this deployment cannot send, the copy path is offered and the reason said — no send control", async () => {
    getInquiryDetailStrict.mockResolvedValue(detail());
    getInquiryPublishCapability.mockResolvedValue({ executionEnabled: false, replyAdapterChannelCodes: [] });
    render(<MemoryRouter><ApprovalArtifact artifact={ARTIFACT} /></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "초안 복사" })).toBeInTheDocument();
    expect(screen.getByText(/reviewnary가 답변을 대신 등록하지 않습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "답변 보내기" })).toBeNull();
    expect(confirmInquiryPublish).not.toHaveBeenCalled();
  });

  it("a draft that moved since the approval was prepared gets no send control", async () => {
    getInquiryDetailStrict.mockResolvedValue(detail("fp-3"));
    getInquiryPublishCapability.mockResolvedValue({ executionEnabled: true, replyAdapterChannelCodes: ["CAFE24"] });
    render(<MemoryRouter><ApprovalArtifact artifact={ARTIFACT} /></MemoryRouter>);
    expect(await screen.findByText(/초안이 그 사이 변경되었습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "답변 보내기" })).toBeNull();
  });

  it("executableIdentity NONE: a file-imported inquiry gets the copy path and the honest sentence, never a send control", async () => {
    getInquiryDetailStrict.mockResolvedValue(detail());
    getInquiryPublishCapability.mockResolvedValue({ executionEnabled: true, replyAdapterChannelCodes: ["CAFE24"] });
    render(<MemoryRouter><ApprovalArtifact artifact={{ ...ARTIFACT, executableIdentity: "NONE" }} /></MemoryRouter>);
    expect(await screen.findByText(/파일로 가져온 기록이라 채널로 보낼 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "초안 복사" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "답변 보내기" })).toBeNull();
    expect(confirmInquiryPublish).not.toHaveBeenCalled();
  });
});

describe("approval artifact — REVIEW kind (Cafe24 API execution)", () => {
  it("confirm step → ONE /reply/execute with the approved fingerprint → EXECUTION_RESULT with its verification", async () => {
    getReviewReplyPrep.mockResolvedValue(prep());
    executeReviewReply.mockResolvedValue({ status: "EXECUTED", category: "COMPLETED", verification: "VERIFIED", providerRef: "c-1" });
    render(<MemoryRouter><ApprovalArtifact artifact={REVIEW} /></MemoryRouter>);
    expect(await screen.findByText("소중한 후기 감사합니다.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "답변 보내기" }));
    expect(executeReviewReply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "승인하고 전송" }));
    await waitFor(() => expect(executeReviewReply).toHaveBeenCalledTimes(1));
    const [accountId, actionRef, request] = executeReviewReply.mock.calls[0] as [string, string, { commandId: string; expectedFingerprint: string }];
    expect(accountId).toBe("acc-c24");
    expect(actionRef).toBe("ref-1");
    expect(request.expectedFingerprint).toBe("rfp-1");
    expect(request.commandId).toMatch(/[0-9a-f-]{20,}/);
    expect(await screen.findByText("확인됨")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "리뷰 화면에서 확인" })).toHaveAttribute("href", "/reviews/rv-1");
    expect(getInquiryDetailStrict).not.toHaveBeenCalled();
  });

  it("an approval that moved since the artifact was prepared gets no send control", async () => {
    getReviewReplyPrep.mockResolvedValue(prep("rfp-9"));
    render(<MemoryRouter><ApprovalArtifact artifact={REVIEW} /></MemoryRouter>);
    expect(await screen.findByText(/승인된 답변이 그 사이 변경되었습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "답변 보내기" })).toBeNull();
  });

  it("execution NOT_SUPPORTED / identity NONE: honest sentence + copy, no send control, no call", async () => {
    getReviewReplyPrep.mockResolvedValue(prep());
    const { unmount } = render(<MemoryRouter><ApprovalArtifact artifact={{ ...REVIEW, execution: "NOT_SUPPORTED" }} /></MemoryRouter>);
    expect(await screen.findByText(/답글을 남기는 기능을 지원하지 않습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "답변 보내기" })).toBeNull();
    unmount();
    render(<MemoryRouter><ApprovalArtifact artifact={{ ...REVIEW, executableIdentity: "NONE" }} /></MemoryRouter>);
    expect(await screen.findByText(/이 리뷰는 파일로 가져온 기록이라/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "초안 복사" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "답변 보내기" })).toBeNull();
    expect(executeReviewReply).not.toHaveBeenCalled();
  });
});
