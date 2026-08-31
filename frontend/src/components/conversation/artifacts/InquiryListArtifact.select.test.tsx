// @vitest-environment jsdom
/**
 * Agent Interaction Model v2 §3/§7 — CLICK == CONVERSATION FOCUS on the inquiry rows.
 *
 * A row press selects the inquiry in the conversation (the same focus transition as naming it) and
 * expands its compact detail in place; the workspace is a secondary icon action. Outside the provider
 * the row falls back to a plain link so a bare render never dead-ends.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { InquiryListArtifact } from "./InquiryListArtifact";
import type { InquiryListArtifact as InquiryList } from "../../../lib/conversation/types";

const selectEntity = vi.fn(async () => undefined);
let conversation: { workingSet: { selectedInquiry: { inquiryId: string } | null } | null; selectEntity: typeof selectEntity } | null = {
  workingSet: null,
  selectEntity,
};
vi.mock("../../../lib/conversation/ConversationProvider", () => ({ useConversation: () => conversation }));
vi.mock("../../../lib/apiClient", () => ({
  api: { getInquiryDetailStrict: vi.fn(async () => ({ details: "고객이 쓴 문장입니다", draft: null })) },
}));
import { api } from "../../../lib/apiClient";

const ARTIFACT: InquiryList = {
  artifactId: "a-1", type: "INQUIRY_LIST", title: "최근 문의", totalCount: 2,
  groups: [{
    key: "UNANSWERED", label: "답변 필요",
    items: [
      { workItemId: "w-1", inquiryId: "i-1", channelCode: "NAVER", channelNameKo: "네이버", receivedAt: "2026-08-29T00:00:00Z", phase: "OPEN", status: "UNANSWERED", title: "배송 후 분실", productId: "p-1", productName: "종이컵보관함", answerBasis: null, to: "/inquiries/i-1" },
      { workItemId: null, inquiryId: "i-2", channelCode: "CAFE24", channelNameKo: "카페24", receivedAt: "2026-08-28T00:00:00Z", phase: "", status: "ANSWERED", title: "반품 문의", productId: null, productName: null, answerBasis: null, to: "/inquiries/i-2" },
    ],
  }],
};

beforeEach(() => {
  selectEntity.mockClear();
  conversation = { workingSet: null, selectEntity };
  vi.mocked(api.getInquiryDetailStrict).mockClear();
});

describe("row click = select + inline detail; workspace is secondary", () => {
  it("pressing a row calls selectEntity with the row's own ids and expands the customer's sentence", async () => {
    render(<MemoryRouter><InquiryListArtifact artifact={ARTIFACT} onPrompt={() => undefined} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /배송 후 분실/ }));
    expect(selectEntity).toHaveBeenCalledWith({ inquiryId: "i-1", workItemId: "w-1" });
    await waitFor(() => expect(screen.getByTestId("inquiry-row-detail")).toHaveTextContent("고객이 쓴 문장입니다"));
    expect(screen.getByRole("button", { name: "답변 준비" })).toBeInTheDocument();
    // The workspace stays one press away — as the secondary icon action, not the row's default.
    expect(screen.getAllByRole("link", { name: "문의 화면에서 열기" })[0]).toHaveAttribute("href", "/inquiries/i-1");
  });

  it("the selected row is highlighted from the conversation's own working set", () => {
    conversation = { workingSet: { selectedInquiry: { inquiryId: "i-2" } }, selectEntity };
    render(<MemoryRouter><InquiryListArtifact artifact={ARTIFACT} /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /반품 문의/ })).toHaveAttribute("aria-current", "true");
  });

  it("outside the provider the row is a plain link — nothing dead-ends", () => {
    conversation = null;
    render(<MemoryRouter><InquiryListArtifact artifact={ARTIFACT} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /배송 후 분실/ })).toHaveAttribute("href", "/inquiries/i-1");
  });
});
