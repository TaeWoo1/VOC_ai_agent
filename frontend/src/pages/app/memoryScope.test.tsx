// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CustomerMemory } from "./CustomerMemory";
import type { ReviewIssueView } from "../../lib/types";

const getReviewIssuesStrict = vi.fn();
const getReviewIssueDetailStrict = vi.fn();
const getInboxStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getReviewIssuesStrict: () => getReviewIssuesStrict(),
    getReviewIssueDetailStrict: (id: string) => getReviewIssueDetailStrict(id),
    getInboxStrict: () => getInboxStrict(),
    startReviewIssueAction: vi.fn(),
    markReviewIssueRemediated: vi.fn(),
  },
  getToken: () => null,
}));

const ISSUE: ReviewIssueView = {
  id: "issue-1",
  title: "접착력이 약하다는 이야기가 늘고 있어요",
  aspect: "접착",
  problem: "부착 후 떨어짐",
  severity: "HIGH",
  lifecycleState: "NEEDS_REVIEW",
  lifecycleLabelKo: "확인 필요",
  evidenceCount: 4,
  firstEvidenceOn: "2026-06-18",
  lastEvidenceOn: "2026-08-02",
  dominantProductId: null,
  dominantProductName: null,
  dismissed: false,
  extractorKind: "RULE_BASED",
  change: {
    kinds: ["SURGING"],
    labelsKo: ["증가 중"],
    highSurge: true,
    surgeWindowCount: 4,
    surgeBaselineWeekly: 0.6,
  },
};

function renderMemory(path = "/memory") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/memory" element={<CustomerMemory />} />
        <Route path="/memory/:issueId" element={<CustomerMemory />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getReviewIssuesStrict.mockResolvedValue([ISSUE]);
  getInboxStrict.mockResolvedValue({ items: [], total: 0 });
  getReviewIssueDetailStrict.mockResolvedValue({ issue: ISSUE, evidence: [], history: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * The v1 scope fence for 고객운영 메모리.
 *
 * v1 is recurring issues, their evidence, their trend, and per-product customer signals. Search
 * over past inquiries / reviews / replies is retrieval-backed work outside v1 and gated on a
 * separate scope decision. A search box rendered before that capability exists would promise it,
 * so its absence is asserted rather than assumed — in every state the surface can be in.
 */
describe("고객운영 메모리 — v1 scope fence", () => {
  for (const [label, path] of [
    ["list", "/memory"],
    ["detail", "/memory/issue-1"],
  ] as const) {
    it(`renders no search control in the ${label} state`, async () => {
      const { container } = renderMemory(path);
      // The title appears in both panes on the detail route; wait for any of them.
      await screen.findAllByText(ISSUE.title);
      expect(screen.queryByRole("searchbox")).toBeNull();
      expect(container.querySelector('input[type="search"]')).toBeNull();
      expect(container.querySelectorAll("input")).toHaveLength(0);
      expect(container.querySelectorAll("form")).toHaveLength(0);
    });
  }

  it("renders no search control in the empty state", async () => {
    getReviewIssuesStrict.mockResolvedValue([]);
    const { container } = renderMemory();
    await screen.findByText("아직 쌓인 기록이 없습니다");
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("form")).toHaveLength(0);
  });

  it("offers no search affordance in its copy", async () => {
    const { container } = renderMemory();
    await screen.findAllByText(ISSUE.title);
    const text = container.textContent ?? "";
    for (const token of ["검색", "찾기", "질문하기"]) {
      expect(text).not.toContain(token);
    }
  });

  it("describes what the surface holds without promising unbuilt capability", async () => {
    renderMemory();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("고객운영 메모리");
    expect(screen.getByText(/반복되는 고객 문제와 그 근거/)).toBeInTheDocument();
  });
});
