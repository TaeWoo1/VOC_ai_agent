// @vitest-environment jsdom
/**
 * Working Context v1 §5 — a ROWS list keeps the seller's ORDER, so its groups are consecutive runs of
 * one state. Two things follow, and both were wrong in the live render: the same group key appears more
 * than once (React warned it might drop or duplicate rows), and the repeated headers named the state
 * each row's own first word already names.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InquiryListArtifact } from "./InquiryListArtifact";
import type { InquiryItem, InquiryListArtifact as List } from "../../../lib/conversation/types";

function item(id: string, title: string, status: string): InquiryItem {
  return {
    workItemId: status === "UNANSWERED" ? `w-${id}` : null, inquiryId: id, channelCode: "CAFE24",
    channelNameKo: "카페24 자사몰", receivedAt: "2026-08-26T00:00:00Z", phase: "OPEN", status,
    title, productId: null, productName: null, answerBasis: null, to: `/inquiries/${id}`,
  };
}

/** Three consecutive runs of two states — the shape 「현금영수증 관련 문의」 actually produced. */
const runs: List = {
  artifactId: "a1", type: "INQUIRY_LIST", title: "현금영수증 관련 문의", totalCount: 3,
  groups: [
    { key: "UNANSWERED", label: "답변 필요", items: [item("i-1", "소득공제 신청 확인", "UNANSWERED")] },
    { key: "ANSWERED", label: "답변함", items: [item("i-2", "처리됐나요", "ANSWERED")] },
    { key: "UNANSWERED", label: "답변 필요", items: [item("i-3", "발행 부탁드립니다", "UNANSWERED")] },
  ],
};

describe("InquiryListArtifact — consecutive runs", () => {
  it("renders every row once and draws no repeated headers", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<MemoryRouter><InquiryListArtifact artifact={runs} /></MemoryRouter>);
    expect(screen.getByText("소득공제 신청 확인")).toBeInTheDocument();
    expect(screen.getByText("처리됐나요")).toBeInTheDocument();
    expect(screen.getByText("발행 부탁드립니다")).toBeInTheDocument();
    // Duplicate React keys warn on `console.error`; three sections, three unique keys.
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    warn.mockRestore();
    // The headers said 답변 필요 · 답변함 · 답변 필요, counting to one each; the rows say it themselves.
    expect(screen.getAllByText("답변 필요")).toHaveLength(2);
    expect(screen.getAllByText("답변함")).toHaveLength(1);
  });

  it("a genuinely grouped list — each label once — keeps its headers and counts", () => {
    const grouped: List = {
      ...runs,
      groups: [
        { key: "UNANSWERED", label: "답변 필요", items: [item("i-1", "가", "UNANSWERED"), item("i-3", "다", "UNANSWERED")] },
        { key: "ANSWERED", label: "답변함", items: [item("i-2", "나", "ANSWERED")] },
      ],
    };
    render(<MemoryRouter><InquiryListArtifact artifact={grouped} /></MemoryRouter>);
    // Header (with its count) plus the two rows' own words.
    expect(screen.getAllByText("답변 필요")).toHaveLength(3);
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
