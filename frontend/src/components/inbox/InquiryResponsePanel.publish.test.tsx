// @vitest-environment jsdom
/**
 * The seller-facing guards on the ONE marketplace WRITE this product has.
 *
 * Every assertion here is about something that must NOT happen: a send offered on a deployment that
 * cannot send, a send offered for a channel with no adapter, a reply posted by a single click, or an
 * approval bound to content the seller did not read. The happy path is one test; the rest are the
 * fence around it.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InquiryResponsePanel } from "./InquiryResponsePanel";

const getInquiryDetailStrict = vi.fn();
const getInquiryPublishCapability = vi.fn();
const saveInquiryReplyDraft = vi.fn();
const confirmInquiryPublish = vi.fn();
const generateInquiryProposal = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getInquiryDetailStrict: (id: string) => getInquiryDetailStrict(id),
    getInquiryPublishCapability: () => getInquiryPublishCapability(),
    saveInquiryReplyDraft: (id: string, r: unknown) => saveInquiryReplyDraft(id, r),
    confirmInquiryPublish: (id: string, r: unknown) => confirmInquiryPublish(id, r),
    verifyInquiryPublish: vi.fn(),
    resumeInquiryPublish: vi.fn(),
    generateInquiryProposal: (id: string) => generateInquiryProposal(id),
  },
  getToken: () => null,
}));

const DRAFT = {
  version: 2,
  answerStatus: 0,
  title: "[답변] 배송 문의",
  comments: "확인 후 안내드리겠습니다.",
  contentFingerprint: "f".repeat(64),
  fingerprintAlgorithm: "SHA-256",
  createdAt: "2026-08-19T00:00:00Z",
};

function detail(over: Record<string, unknown> = {}) {
  return {
    workItemId: "w1",
    inquiryId: "i1",
    sellerAccountId: "s1",
    channelId: "c1",
    channelCode: "COUPANG",
    channelNameKo: "쿠팡",
    isSecret: false,
    phase: "PROPOSED",
    status: "UNANSWERED",
    informStatus: null,
    title: "배송 문의",
    details: "언제 오나요",
    receivedAt: "2026-08-19T00:00:00Z",
    proposal: null,
    draft: DRAFT,
    ...over,
  };
}

beforeEach(() => {
  getInquiryDetailStrict.mockResolvedValue(detail());
  getInquiryPublishCapability.mockResolvedValue({
    executionEnabled: true,
    replyAdapterChannelCodes: ["COUPANG"],
  });
  saveInquiryReplyDraft.mockResolvedValue({ ...DRAFT, version: 3, contentFingerprint: "a".repeat(64) });
  confirmInquiryPublish.mockResolvedValue({
    workItemId: "w1",
    phase: "ACTION_PENDING",
    executionStatus: "EXECUTED",
    category: "COMPLETED",
    approvedDraftVersion: 2,
    approvedFingerprint: "f".repeat(64),
    providerMessageNo: null,
    resultCode: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("InquiryResponsePanel — the send is offered only when the backend says it can be done", () => {
  it("offers NOTHING to send on the default posture (execution off, no adapters)", async () => {
    getInquiryPublishCapability.mockResolvedValue({ executionEnabled: false, replyAdapterChannelCodes: [] });
    render(<InquiryResponsePanel workItemId="w1" />);

    await screen.findByText(/답변 초안/);
    expect(screen.queryByRole("button", { name: /등록하기/ })).not.toBeInTheDocument();
    // …and it says WHY, rather than leaving a silent gap where a control would be.
    expect(screen.getByText(/대신 등록하지 않습니다/)).toBeInTheDocument();
  });

  it("offers nothing when the channel has no reply adapter, and names that channel", async () => {
    getInquiryPublishCapability.mockResolvedValue({
      executionEnabled: true,
      replyAdapterChannelCodes: ["ESM"],
    });
    render(<InquiryResponsePanel workItemId="w1" />);

    await screen.findByText(/판매자센터에서 직접 답변해 주세요/);
    expect(screen.getByText(/쿠팡 문의는/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /등록하기/ })).not.toBeInTheDocument();
  });

  it("fails CLOSED when the capability read did not land — a write is never offered on a guess", async () => {
    getInquiryPublishCapability.mockRejectedValue(new Error("down"));
    render(<InquiryResponsePanel workItemId="w1" />);

    await screen.findByText(/확인하지 못했습니다/);
    expect(screen.queryByRole("button", { name: /등록하기/ })).not.toBeInTheDocument();
  });

  it("refuses to send an UNSAVED edit — the fingerprint on screen must be the one that goes", async () => {
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);
    await screen.findByRole("button", { name: /등록하기/ });

    await user.type(screen.getByLabelText("내용"), " 추가로 적었습니다");

    expect(screen.queryByRole("button", { name: /등록하기/ })).not.toBeInTheDocument();
    expect(screen.getByText(/편집한 내용을 먼저 저장해 주세요/)).toBeInTheDocument();
  });
});

describe("InquiryResponsePanel — the press that writes", () => {
  it("takes TWO presses, restates what will be posted, and sends nothing on the first", async () => {
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /쿠팡에 답변 등록하기/ }));

    // The first press only opened the confirm block. Nothing has been sent.
    expect(confirmInquiryPublish).not.toHaveBeenCalled();
    expect(screen.getByText(/등록 후에는 취소할 수 없습니다/)).toBeInTheDocument();
    // The exact text that will be posted is shown back INSIDE the confirm block — read-only, beside
    // the destination and the version — so the seller cannot discover afterwards what was sent.
    const confirm = within(screen.getByRole("group", { name: "답변 등록 확인" }));
    expect(confirm.getByText(DRAFT.comments)).toBeInTheDocument();
    expect(confirm.getByText(/저장된 버전 2/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /확인, 등록합니다/ }));

    await waitFor(() => expect(confirmInquiryPublish).toHaveBeenCalledTimes(1));
    const [, request] = confirmInquiryPublish.mock.calls[0]!;
    // Bound to the exact version the seller read — a draft that moved is a 409, not a silent send.
    expect(request.expectedFingerprint).toBe(DRAFT.contentFingerprint);
    // A fresh idempotency key per press, so a timeout + retry cannot become a second reply.
    expect(request.commandId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("cancelling the confirm block sends nothing", async () => {
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /쿠팡에 답변 등록하기/ }));
    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(confirmInquiryPublish).not.toHaveBeenCalled();
    expect(screen.queryByText(/등록 후에는 취소할 수 없습니다/)).not.toBeInTheDocument();
  });

  it("saving a new draft version CLOSES an open confirm — a stale approval cannot be pressed", async () => {
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /쿠팡에 답변 등록하기/ }));
    expect(screen.getByText(/등록 후에는 취소할 수 없습니다/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /초안 저장/ }));

    await waitFor(() => expect(screen.queryByText(/등록 후에는 취소할 수 없습니다/)).not.toBeInTheDocument());
    expect(confirmInquiryPublish).not.toHaveBeenCalled();
  });

  it("reports the outcome in the seller's words, and stops offering to send again", async () => {
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /쿠팡에 답변 등록하기/ }));
    await user.click(screen.getByRole("button", { name: /확인, 등록합니다/ }));

    await screen.findByText("답변이 등록되었습니다.");
    expect(screen.queryByRole("button", { name: /등록하기/ })).not.toBeInTheDocument();
  });
});
