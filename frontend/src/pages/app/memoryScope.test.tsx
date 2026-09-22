// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CustomerMemory } from "./CustomerMemory";
import type { ReviewIssueView } from "../../lib/types";

const getReviewIssuesStrict = vi.fn();
const getReviewIssueDetailStrict = vi.fn();
const getRepeatedIssueContextStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getReviewIssuesStrict: () => getReviewIssuesStrict(),
    getReviewIssueDetailStrict: (id: string) => getReviewIssueDetailStrict(id),
    getRepeatedIssueContextStrict: (id: string) => getRepeatedIssueContextStrict(id),
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
  getRepeatedIssueContextStrict.mockResolvedValue({
    issueId: ISSUE.id,
    aspect: "접착",
    evidence: {
      totalEvidence: 0, byProduct: [], unattributedEvidence: 0,
      ratingDistribution: { rating1: 0, rating2: 0, rating3: 0, rating4: 0, rating5: 0, unrated: 0 },
      firstEvidenceOn: null, lastEvidenceOn: null,
    },
    knowledge: {
      productId: null, productName: null, productSources: 0, productMentions: 0,
      orgSources: 0, orgMentions: 0, excerpts: [],
    },
  });
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

  it("offers the same Agent conversation every other screen does — and hands it no issue id", async () => {
    const { container } = renderMemory("/memory/issue-1");
    await screen.findAllByText(ISSUE.title);
    const launcher = screen.getByRole("link", { name: /이 내용으로 물어보기/ });
    // The panel is the destination when the shell provides one; bare (as here) it is the /agent route.
    // Either way the only thing that travels is WHICH SCREEN this is — no issue id, no title, and no
    // second chat on this page.
    const href = launcher.getAttribute("href") ?? "";
    expect(href).toContain("from=memory");
    expect(href).not.toMatch(/goal=|productId=|issue-1/);

    // This used to assert zero textareas, as a proxy for 「no second chat composer here」. The proxy
    // stopped meaning that when the workspace gained a place to write down what the seller decided
    // to do about the problem — a field that posts one note to one issue's own record, and can no
    // more ask a question than the 기록 list below it can. Asserting the proxy would now forbid the
    // seller from writing anything at all on a screen whose purpose is deciding, so the claim is
    // made directly instead: the only writable field here is that record, and it is not a composer.
    const fields = Array.from(container.querySelectorAll("textarea"));
    expect(fields).toHaveLength(1);
    expect(fields[0].getAttribute("id")).toBe("issue-decision-note");
    expect(screen.getByLabelText(/무엇을 하기로 하셨나요/)).toBe(fields[0]);
    expect(fields[0].getAttribute("placeholder") ?? "").not.toMatch(/검색|찾기|물어|질문/);
  });

  it("describes what the surface holds without promising unbuilt capability", async () => {
    renderMemory();
    // One name since UI/UX v2 Phase 1: the nav entry, the Home section and this title all say 반복 문제.
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("반복 문제");
    expect(screen.getByText(/반복해서 말한 문제와 그 근거/)).toBeInTheDocument();
  });
});
