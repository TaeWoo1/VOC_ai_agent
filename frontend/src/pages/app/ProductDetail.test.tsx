// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProductDetail } from "./ProductDetail";
import { expectNoAxeViolations } from "../../test/axe";
import type { ProductKnowledgeView, ReviewIssueView } from "../../lib/types";

/**
 * 상품 상세 — every number a door, and every repeated problem reachable
 * (Product Operations Continuity v1 §1–§4).
 *
 * <p>What is pinned here is the continuity, not the layout: a figure whose destination reads through a
 * different predicate, or a 근거 N건 that cannot be opened, is the defect this package exists to close.
 * Zero stays a fact rather than becoming a control, because a door onto an empty list is a promise the
 * product cannot keep.
 */

const getProductKnowledgeStrict = vi.fn();
const getKnowledgeDocuments = vi.fn();
const getKnowledgeCandidates = vi.fn();
const listProductKnowledgeSources = vi.fn();
const getOpportunitiesStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getProductKnowledgeStrict: (id: string) => getProductKnowledgeStrict(id),
    getKnowledgeDocuments: (id?: string) => getKnowledgeDocuments(id),
    getKnowledgeCandidates: () => getKnowledgeCandidates(),
    listProductKnowledgeSources: (id: string) => listProductKnowledgeSources(id),
    getOpportunitiesStrict: (o: unknown) => getOpportunitiesStrict(o),
  },
  getToken: () => "token",
}));

function issue(over: Partial<ReviewIssueView> = {}): ReviewIssueView {
  return {
    id: "issue-1",
    title: "접착 탈락",
    aspect: "접착",
    problem: "탈락",
    severity: "MODERATE",
    lifecycleState: "OBSERVING",
    lifecycleLabelKo: "지켜보는 중",
    evidenceCount: 19,
    firstEvidenceOn: "2026-01-02",
    lastEvidenceOn: "2026-08-18",
    dominantProductId: "p-1",
    dominantProductName: "선바로 일체형 전선몰딩",
    dismissed: false,
    extractorKind: "RULE",
    change: { kinds: [], labelsKo: [], highSurge: false, surgeWindowCount: 0, surgeBaselineWeekly: 0 },
    ...over,
  } as ReviewIssueView;
}

function view(over: Partial<ProductKnowledgeView["signals"]["volume"]> = {}, issues: ReviewIssueView[] = [issue()]): ProductKnowledgeView {
  return {
    productId: "p-1",
    name: "선바로 일체형 전선몰딩",
    sku: "6473457702",
    status: "ACTIVE",
    listings: [],
    variants: [],
    facts: [],
    signals: {
      productId: "p-1",
      productName: "선바로 일체형 전선몰딩",
      sku: "6473457702",
      referenceDate: "2026-09-04",
      issues,
      recommendedActions: [],
      volume: { reviews: 1761, inquiries: 8, unansweredInquiries: 1, issueEvidence: 80, ...over },
      linkedChannels: ["NAVER"],
      coverage: [
        { signal: "REVIEW", coverage: "COVERED", linked: 1761, unlinked: 0, provenance: "x" },
      ],
    },
    knowledgeCoverage: [],
  } as unknown as ProductKnowledgeView;
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/products/p-1"]}>
      <Routes>
        <Route path="/products/:productId" element={<ProductDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getProductKnowledgeStrict.mockResolvedValue(view());
  getKnowledgeDocuments.mockResolvedValue([]);
  getKnowledgeCandidates.mockResolvedValue([]);
  listProductKnowledgeSources.mockResolvedValue([]);
  getOpportunitiesStrict.mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

describe("상품 상세 — the figures are doors", () => {
  it("리뷰 opens THIS product's review record", async () => {
    renderDetail();
    const link = await screen.findByRole("link", { name: /^리뷰 1,761건 보기$/ });
    expect(link).toHaveAttribute("href", "/reviews?productId=p-1");
  });

  it("문의 and 미답변 문의 keep their product-scoped destinations", async () => {
    renderDetail();
    expect(await screen.findByRole("link", { name: /^문의 8건 보기$/ })).toHaveAttribute(
      "href",
      "/inquiries?productId=p-1",
    );
    expect(screen.getByRole("link", { name: /^미답변 문의 1건 보기$/ })).toHaveAttribute(
      "href",
      "/inquiries?productId=p-1&status=UNANSWERED",
    );
  });

  it("zero is a fact, not a control", async () => {
    getProductKnowledgeStrict.mockResolvedValue(view({ reviews: 0, inquiries: 0, unansweredInquiries: 0 }));
    renderDetail();
    await screen.findByRole("heading", { level: 1, name: "선바로 일체형 전선몰딩" });
    expect(screen.queryByRole("link", { name: /리뷰 0건 보기/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /문의 0건 보기/ })).toBeNull();
  });

  it("문제 근거 is no longer a fourth figure standing on its own", async () => {
    renderDetail();
    await screen.findByRole("heading", { level: 1, name: "선바로 일체형 전선몰딩" });
    // The number is not gone — it moved to the heading of the section whose rows produce it.
    expect(screen.getByText(/근거 80건/)).toBeInTheDocument();
  });
});

describe("상품 상세 — repeated problems lead to their evidence", () => {
  it("each problem opens the issue whose evidence it counted", async () => {
    renderDetail();
    const row = await screen.findByRole("link", { name: /접착 탈락/ });
    expect(row).toHaveAttribute("href", "/memory/issue-1");
    expect(row).toHaveTextContent("근거 19건");
  });

  it("does not stop at five problems without saying so", async () => {
    const many = Array.from({ length: 8 }, (_, i) => issue({ id: `issue-${i}`, title: `문제 ${i}` }));
    getProductKnowledgeStrict.mockResolvedValue(view({}, many));
    renderDetail();
    expect(await screen.findByText("문제 3건 더 보기")).toBeInTheDocument();
  });

  it("says so plainly when there is nothing repeated", async () => {
    getProductKnowledgeStrict.mockResolvedValue(view({ issueEvidence: 0 }, []));
    renderDetail();
    expect(await screen.findByText("이 상품에서 반복 문제로 잡힌 것이 없습니다.")).toBeInTheDocument();
  });
});

describe("상품 상세 — knowledge continuity", () => {
  it("points at the company library where the same sources live", async () => {
    renderDetail();
    const links = await screen.findAllByRole("link", { name: "회사 전체 지식에서 보기" });
    expect(links).toHaveLength(2);
    links.forEach((link) => expect(link).toHaveAttribute("href", "/knowledge"));
  });

  it("counts what is still waiting for THIS product, and links to where it is answered", async () => {
    getKnowledgeCandidates.mockResolvedValue([
      { id: "c-1", scope: "PRODUCT", productId: "p-1", productName: "선바로", subject: "가닥", content: "", origin: "DRAFT_GAP", evidenceCount: 0, state: "OPEN", sourceId: null, createdAt: "2026-09-01T00:00:00Z" },
      { id: "c-2", scope: "PRODUCT", productId: "p-9", productName: "다른 상품", subject: "두께", content: "", origin: "DRAFT_GAP", evidenceCount: 0, state: "OPEN", sourceId: null, createdAt: "2026-09-01T00:00:00Z" },
      { id: "c-3", scope: "ORG", productId: null, productName: null, subject: "배송", content: "", origin: "DRAFT_GAP", evidenceCount: 0, state: "OPEN", sourceId: null, createdAt: "2026-09-01T00:00:00Z" },
    ]);
    renderDetail();
    expect(await screen.findByText(/확인이 필요한 항목이 1건 있습니다/)).toBeInTheDocument();
  });

  it("a failed candidate read says nothing rather than 0건", async () => {
    getKnowledgeCandidates.mockRejectedValue(new Error("nope"));
    renderDetail();
    await screen.findByRole("heading", { level: 1, name: "선바로 일체형 전선몰딩" });
    expect(screen.queryByText(/확인이 필요한 항목/)).toBeNull();
  });
});

describe("상품 상세 — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderDetail();
    await screen.findByRole("heading", { level: 1, name: "선바로 일체형 전선몰딩" });
    await expectNoAxeViolations(container);
  });
});

describe("상품 상세 — repeated problems continue into opportunities (Opportunity Engine v1)", () => {
  it("draws a product's opportunities as rows that open the issue's own surface", async () => {
    getOpportunitiesStrict.mockResolvedValue([
      {
        issueId: "issue-1", kind: "FAQ_SUPPLEMENT", kindLabelKo: "FAQ 보완", status: "OPEN", statusLabelKo: "검토 전",
        issueTitle: "접착 탈락", aspect: "접착", problem: "탈락", severity: "NORMAL", evidenceCount: 19,
        firstEvidenceOn: "2026-01-02", lastEvidenceOn: "2026-08-18", changeLabelsKo: [],
        productId: "p-1", productName: "선바로 일체형 전선몰딩",
        whyKo: ["「접착 탈락」 근거 리뷰 19건."], recommendationKo: "'접착' 관련 안내를 이 상품의 자주 묻는 질문에 추가하는 것을 검토하세요.",
        evidenceTo: "/memory/issue-1", knowledge: { scope: "PRODUCT", scopeLabelKo: "이 상품의 상품 지식", type: "USAGE", topicLabelKo: "접착", sources: 0, mentions: 0, excerpts: [] },
        nextActionKo: "FAQ 초안 준비", draft: null, decidedAt: null,
      },
      {
        issueId: "issue-1", kind: "PRODUCT_IMPROVEMENT_REVIEW", kindLabelKo: "제품 개선 검토", status: "DISMISSED", statusLabelKo: "보류",
        issueTitle: "접착 탈락", aspect: "접착", problem: "탈락", severity: "NORMAL", evidenceCount: 19,
        firstEvidenceOn: null, lastEvidenceOn: null, changeLabelsKo: [], productId: "p-1", productName: null,
        whyKo: [], recommendationKo: "제품 자체를 검토하세요.", evidenceTo: "/memory/issue-1", knowledge: null,
        nextActionKo: "메모 준비", draft: null, decidedAt: "2026-09-04T00:00:00Z",
      },
    ]);
    renderDetail();
    const section = await screen.findByRole("region", { name: "개선 기회" });
    // Only what the seller can still act on is counted; the dismissed one is the issue surface's to show.
    expect(section.textContent).toContain("개선 기회 1건");
    const row = section.querySelector("a") as HTMLAnchorElement;
    expect(row.getAttribute("href")).toBe("/memory/issue-1");
    expect(row.textContent).toContain("FAQ 보완");
    expect(row.textContent).toContain("자주 묻는 질문에 추가");
    expect(section.textContent).not.toContain("제품 개선 검토");
  });

  it("is silent when there are none, and silent when the read failed — neither is a fact about the product", async () => {
    getOpportunitiesStrict.mockRejectedValue(new Error("down"));
    renderDetail();
    await screen.findByText("반복되는 문제");
    expect(screen.queryByRole("region", { name: "개선 기회" })).toBeNull();
  });
});
