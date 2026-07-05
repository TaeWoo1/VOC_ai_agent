import { describe, expect, it } from "vitest";
import type { InquiryQueueItem, ProposalView } from "./types";
import {
  canGenerateProposal,
  classifyProposeError,
  detailErrorMessage,
  isProposed,
  phaseLabel,
  proposalCategoryLabel,
  provenanceText,
  providerKindLabel,
  queueRowView,
  receivedDateLabel,
  statusLabel,
} from "./inquiryWorkflow";

function queueItem(over: Partial<InquiryQueueItem> = {}): InquiryQueueItem {
  return {
    workItemId: "wi-1",
    inquiryId: "inq-1",
    sellerAccountId: "acc-1",
    channelId: "ch-1",
    phase: "OPEN",
    status: "UNANSWERED",
    title: "배송 문의",
    receivedAt: "2026-06-27T09:00:00Z",
    ...over,
  };
}

function proposal(over: Partial<ProposalView> = {}): ProposalView {
  return {
    proposalId: "prop-1",
    workItemId: "wi-1",
    inquiryId: "inq-1",
    actionKind: "POST_INQUIRY_REPLY",
    summaryCategory: "delivery_status_reply",
    requiresApproval: true,
    proposedBy: "SYSTEM:RULE_PROPOSER",
    providerKind: "RULE_BASED",
    providerName: "rule-proposer",
    providerVersion: "rules-v1",
    ...over,
  };
}

describe("phase gating", () => {
  it("isProposed / canGenerateProposal reflect the phase", () => {
    expect(isProposed("PROPOSED")).toBe(true);
    expect(isProposed("OPEN")).toBe(false);
    expect(canGenerateProposal("OPEN")).toBe(true);
    expect(canGenerateProposal("PROPOSED")).toBe(false);
    expect(canGenerateProposal("APPROVED")).toBe(false);
  });
});

describe("proposalCategoryLabel", () => {
  it("maps known coarse categories to Korean labels", () => {
    expect(proposalCategoryLabel("delivery_status_reply")).toBe("배송 상태 안내");
    expect(proposalCategoryLabel("exchange_return_reply")).toBe("교환·반품 안내");
    expect(proposalCategoryLabel("general_reply")).toBe("일반 응답");
  });
  it("humanizes an unknown category without throwing", () => {
    expect(proposalCategoryLabel("brand_new_reply")).toBe("brand new");
    expect(proposalCategoryLabel("")).toBe("응답 제안");
  });
});

describe("provenance display", () => {
  it("labels the provider kind", () => {
    expect(providerKindLabel("RULE_BASED")).toBe("규칙 기반");
    expect(providerKindLabel("AI")).toBe("AI");
  });
  it("provenanceText shows kind + name + version, never audit/internal fields", () => {
    const text = provenanceText(proposal());
    expect(text).toBe("규칙 기반 · rule-proposer rules-v1");
    // Never leak the actor tag, action kind, or proposal id.
    expect(text).not.toContain("SYSTEM:RULE_PROPOSER");
    expect(text).not.toContain("POST_INQUIRY_REPLY");
    expect(text).not.toContain("prop-1");
  });
});

describe("queueRowView (sanitized row)", () => {
  it("carries only display-safe fields — no body/details/author key exists", () => {
    const view = queueRowView(queueItem());
    expect(view).toEqual({
      workItemId: "wi-1",
      title: "배송 문의",
      phaseLabel: "응답 대기",
      statusLabel: "미답변",
      receivedDate: "2026-06-27",
    });
    expect(Object.keys(view)).not.toContain("details");
    expect(Object.keys(view)).not.toContain("body");
    expect(Object.keys(view)).not.toContain("author");
  });
  it("falls back to a placeholder title", () => {
    expect(queueRowView(queueItem({ title: null })).title).toBe("(제목 없음)");
  });
});

describe("labels", () => {
  it("phaseLabel / statusLabel / receivedDateLabel", () => {
    expect(phaseLabel("OPEN")).toBe("응답 대기");
    expect(phaseLabel("PROPOSED")).toBe("제안 생성됨");
    expect(phaseLabel("APPROVED")).toBe("APPROVED");
    expect(statusLabel("UNANSWERED")).toBe("미답변");
    expect(statusLabel("ANSWERED")).toBe("답변완료");
    expect(receivedDateLabel("2026-06-27T09:00:00Z")).toBe("2026-06-27");
  });
});

describe("classifyProposeError", () => {
  it("404 → unavailable, no refresh", () => {
    const r = classifyProposeError(404);
    expect(r.shouldRefresh).toBe(false);
    expect(r.message).toContain("찾을 수 없습니다");
  });
  it("409 → phase changed, triggers refresh", () => {
    const r = classifyProposeError(409);
    expect(r.shouldRefresh).toBe(true);
    expect(r.message).toContain("변경");
  });
  it("503 → temporarily unavailable, no refresh", () => {
    const r = classifyProposeError(503);
    expect(r.shouldRefresh).toBe(false);
    expect(r.message).toContain("일시적");
  });
  it("undefined/other → generic, no refresh", () => {
    expect(classifyProposeError(undefined).shouldRefresh).toBe(false);
    expect(classifyProposeError(500).message).toContain("문제가 발생");
  });
});

describe("detailErrorMessage", () => {
  it("distinguishes 404 (unavailable) from a generic load error", () => {
    expect(detailErrorMessage(404)).toContain("찾을 수 없습니다");
    expect(detailErrorMessage(500)).toContain("불러오지 못했습니다");
  });
});
