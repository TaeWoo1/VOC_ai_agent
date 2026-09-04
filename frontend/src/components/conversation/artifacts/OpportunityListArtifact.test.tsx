// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OpportunityListArtifact } from "./OpportunityListArtifact";
import type { OpportunityListArtifact as OpportunityList } from "../../../lib/conversation/types";

const base: OpportunityList = {
  artifactId: "a-opportunities", type: "OPPORTUNITY_LIST", title: "개선할 만한 기회", productId: null,
  items: [
    {
      issueId: "issue-1", kind: "FAQ_SUPPLEMENT", kindLabelKo: "FAQ 보완", status: "OPEN", statusLabelKo: "검토 전",
      issueTitle: "접착 탈락", recommendationKo: "'접착' 관련 안내를 자주 묻는 질문에 추가하는 것을 검토하세요.",
      evidenceCount: 5, productId: "p-1", productName: "전선몰딩", to: "/memory/issue-1",
    },
  ],
};

describe("개선 기회 artifact — the same object the workspace shows, as rows into its evidence", () => {
  it("renders the suggestion, the issue and the evidence count, and opens the issue surface", () => {
    render(<MemoryRouter><OpportunityListArtifact artifact={base} /></MemoryRouter>);
    const row = screen.getByRole("link");
    expect(row.getAttribute("href")).toBe("/memory/issue-1");
    expect(row.textContent).toContain("FAQ 보완");
    expect(row.textContent).toContain("자주 묻는 질문에 추가");
    expect(row.textContent).toContain("접착 탈락 · 근거 리뷰 5건 · 전선몰딩");
    // The conversation decides nothing: no accept, no dismiss.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says so when there is nothing", () => {
    render(<MemoryRouter><OpportunityListArtifact artifact={{ ...base, items: [] }} /></MemoryRouter>);
    expect(screen.getByText("지금 제안할 개선 기회가 없습니다.")).toBeTruthy();
  });
});
