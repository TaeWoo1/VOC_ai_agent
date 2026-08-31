// @vitest-environment jsdom
/**
 * Knowledge Capture v1 — the card: the question (ASKED), the seller's sentence verbatim with a
 * fingerprint-bound 「저장하고 계속」/「취소」 (CANDIDATE, latest turn only), the reason nothing was saved
 * (DUPLICATE/CONFLICT) with the settings path, and what happened after a save. No write from here.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { KnowledgeCaptureArtifact } from "./KnowledgeCaptureArtifact";
import { ConversationTimeline } from "../ConversationTimeline";
import { agentTurn } from "../../../test/conversationFixtures";
import type { KnowledgeCaptureArtifact as Capture } from "../../../lib/conversation/types";

const INTERNAL = /SHIPPING_POLICY|KNOWLEDGE_CAPTURE|CANDIDATE|fingerprint|captureId|\/api\//;

const base: Capture = {
  artifactId: "a-cap-1", type: "KNOWLEDGE_CAPTURE", title: "배송 기준으로 저장", captureId: "cap-1", state: "CANDIDATE", scope: "ORG",
  topicLabel: "배송", productId: null, productName: null, variantName: null, inquiryId: "inq-1",
  question: "이 문의에 답하려면 일반 출고 기간 기준이 필요해요. 보통 결제 후 며칠 안에 출고하시나요?",
  content: "결제 후 보통 2~3일 안에 출고합니다.", fingerprint: "abcd1234abcd1234", existing: null, resume: null, settingsTo: "/settings/policies",
};

describe("KnowledgeCaptureArtifact", () => {
  it("CANDIDATE: the seller's sentence verbatim, and both controls send the bound decision", async () => {
    const onDecision = vi.fn();
    render(<MemoryRouter><KnowledgeCaptureArtifact artifact={base} onDecision={onDecision} /></MemoryRouter>);
    expect(screen.getByTestId("capture-content")).toHaveTextContent("결제 후 보통 2~3일 안에 출고합니다.");
    await userEvent.click(screen.getByRole("button", { name: "저장하고 계속" }));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onDecision.mock.calls).toEqual([["cap-1", "abcd1234abcd1234", "SAVE"], ["cap-1", "abcd1234abcd1234", "CANCEL"]]);
    expect(screen.getByRole("link", { name: "설정에서 직접 편집" })).toHaveAttribute("href", "/settings/policies");
    expect(screen.getByTestId("knowledge-capture").textContent).not.toMatch(INTERNAL);
  });

  it("ASKED draws NOTHING — the question is the turn's own sentence, asked once", () => {
    // Conversation UX v2 §D: a card that repeats the question verbatim under it was the same ask twice.
    const { container } = render(<MemoryRouter><KnowledgeCaptureArtifact artifact={{ ...base, state: "ASKED", content: null, fingerprint: null, title: "배송 기준" }} onDecision={vi.fn()} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("capture-question")).toBeNull();
    expect(screen.queryByRole("button", { name: "저장하고 계속" })).toBeNull();
    // A card with a candidate but no handler still shows no control.
    render(<MemoryRouter><KnowledgeCaptureArtifact artifact={base} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "저장하고 계속" })).toBeNull();
  });

  it("CONFLICT names the existing rule and offers the settings path; SAVED says what happened next", () => {
    render(<MemoryRouter><KnowledgeCaptureArtifact artifact={{ ...base, state: "CONFLICT", fingerprint: null, existing: { title: "배송 안내", excerpt: "결제 후 1~2일 안에 출고합니다." } }} onDecision={vi.fn()} /></MemoryRouter>);
    expect(screen.getByTestId("capture-existing")).toHaveTextContent("등록된 기준 「배송 안내」: 결제 후 1~2일 안에 출고합니다.");
    expect(screen.getByText("기존 기준과 다름")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장하고 계속" })).toBeNull();
    render(<MemoryRouter><KnowledgeCaptureArtifact artifact={{ ...base, artifactId: "a-cap-2", state: "SAVED", fingerprint: null, resume: "DRAFT_GROUNDED" }} /></MemoryRouter>);
    expect(screen.getByTestId("capture-resume")).toHaveTextContent("저장한 기준으로 답변 초안을 다시 준비했습니다.");
  });

  it("in the timeline the controls exist only on the latest agent turn", async () => {
    const onCaptureDecision = vi.fn();
    const older = agentTurn({ turnId: "a-1", artifacts: [base], suggestedActions: [] });
    const newer = agentTurn({ turnId: "a-2", artifacts: [{ ...base, artifactId: "a-cap-2", captureId: "cap-2" }], suggestedActions: [] });
    render(<MemoryRouter><ConversationTimeline turns={[older, newer]} busy={false} stages={[]} elapsed={0} error={null} onPrompt={() => undefined} onResume={() => undefined} onCaptureDecision={onCaptureDecision} /></MemoryRouter>);
    const buttons = screen.getAllByRole("button", { name: "저장하고 계속" });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(onCaptureDecision).toHaveBeenCalledWith("cap-2", "abcd1234abcd1234", "SAVE");
  });
});
