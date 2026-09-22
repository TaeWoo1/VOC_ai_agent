// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CustomerMemory } from "./CustomerMemory";
import { expectNoAxeViolations } from "../../test/axe";
import type { RepeatedIssueContext, ReviewIssueDetailView, ReviewIssueView } from "../../lib/types";

const getReviewIssuesStrict = vi.fn();
const getReviewIssueDetailStrict = vi.fn();
const getRepeatedIssueContextStrict = vi.fn();
const startReviewIssueAction = vi.fn();
const markReviewIssueRemediated = vi.fn();
const getOpportunitiesStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getReviewIssuesStrict: () => getReviewIssuesStrict(),
    getReviewIssueDetailStrict: (id: string) => getReviewIssueDetailStrict(id),
    getRepeatedIssueContextStrict: (id: string) => getRepeatedIssueContextStrict(id),
    startReviewIssueAction: (id: string, note?: string) => startReviewIssueAction(id, note),
    markReviewIssueRemediated: (id: string, note?: string) => markReviewIssueRemediated(id, note),
    getOpportunitiesStrict: (o: unknown) => getOpportunitiesStrict(o),
  },
  getToken: () => null,
}));

function issue(over: Partial<ReviewIssueView> & Pick<ReviewIssueView, "id">): ReviewIssueView {
  return {
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
    ...over,
  } as ReviewIssueView;
}

const SURGING = issue({ id: "issue-1" });
const IMPROVED = issue({
  id: "issue-2",
  title: "재단 중 파손 이야기가 줄었어요",
  severity: "LOW",
  lifecycleState: "VERIFYING",
  lifecycleLabelKo: "개선 확인 중",
  change: {
    kinds: ["IMPROVED"],
    labelsKo: ["개선됨"],
    highSurge: false,
    surgeWindowCount: 0,
    surgeBaselineWeekly: 0,
  } as ReviewIssueView["change"],
});

const REPEAT_CONTEXT: RepeatedIssueContext = {
  issueId: "surge",
  aspect: "접착",
  evidence: {
    totalEvidence: 19,
    byProduct: [
      {
        productId: "prod-1",
        productName: "전선몰딩 1호",
        evidenceCount: 16,
        productReviews: 1761,
        firstOccurredOn: "2026-06-18",
        lastOccurredOn: "2026-08-02",
      },
      {
        productId: "prod-2",
        productName: "종이컵 보관함",
        evidenceCount: 1,
        productReviews: 416,
        firstOccurredOn: "2026-07-01",
        lastOccurredOn: "2026-07-01",
      },
    ],
    unattributedEvidence: 2,
    ratingDistribution: { rating1: 0, rating2: 0, rating3: 3, rating4: 5, rating5: 10, unrated: 1 },
    firstEvidenceOn: "2026-06-18",
    lastEvidenceOn: "2026-08-02",
  },
  knowledge: {
    productId: "prod-1",
    productName: "전선몰딩 1호",
    productSources: 3,
    productMentions: 1,
    orgSources: 2,
    orgMentions: 0,
    excerpts: ["접착 면의 먼지를 닦고 30초간 눌러 주세요."],
  },
};

const DETAIL: ReviewIssueDetailView = {
  issue: SURGING,
  evidence: [
    {
      reviewId: "rev-loaded",
      unitOrdinal: 1,
      occurredOn: "2026-08-02",
      productId: null,
      productName: "전선몰딩 1호",
      rating: 1,
      quote: "부착 후 며칠 지나니 떨어졌어요.",
    },
    {
      reviewId: "rev-not-loaded",
      unitOrdinal: 1,
      occurredOn: "2026-07-28",
      productId: null,
      productName: null,
      rating: 2,
      quote: "한쪽이 들뜹니다.",
    },
    {
      reviewId: "rev-suppressed",
      unitOrdinal: 2,
      occurredOn: "2026-07-19",
      productId: null,
      productName: null,
      rating: 2,
      quote: null,
    },
  ],
  history: [
    {
      fromState: "OBSERVING",
      toState: "NEEDS_REVIEW",
      toStateLabelKo: "확인 필요",
      actor: "SYSTEM",
      reason: "THRESHOLD_REACHED",
      note: null,
      at: "2026-07-01T00:00:00Z",
    },
  ],
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
  getReviewIssuesStrict.mockResolvedValue([SURGING, IMPROVED]);
  getReviewIssueDetailStrict.mockResolvedValue(DETAIL);
  getRepeatedIssueContextStrict.mockResolvedValue(REPEAT_CONTEXT);
  getOpportunitiesStrict.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("고객운영 메모리 — two panes", () => {
  it("renders a grouped issue list — and, beside it on a wide screen, the first problem already open", async () => {
    // UI/UX v2 Phase 1: the first screen used to be two thirds 「왼쪽에서 이슈를 고르면…」. On a wide screen the
    // list and the detail stand side by side and the first problem (the server's worst-first order) is open.
    const restore = stubWide(true);
    try {
      renderMemory();
      const list = await screen.findByLabelText("반복 이슈 목록");
      expect(within(list).getByRole("heading", { name: "확인 필요" })).toBeInTheDocument();
      expect(within(list).getByRole("heading", { name: "개선됨" })).toBeInTheDocument();
      expect(await screen.findByLabelText("선택한 이슈")).toBeInTheDocument();
      expect(screen.queryByText(/왼쪽에서 이슈를 고르면/)).toBeNull();
      expect(within(list).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "true")).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("on a narrow screen draws the list alone — a row opens the problem, there is no empty half", async () => {
    renderMemory();
    await screen.findByLabelText("반복 이슈 목록");
    expect(screen.queryByLabelText("선택한 이슈")).toBeNull();
    expect(screen.queryByText(/왼쪽에서 이슈를 고르면/)).toBeNull();
  });

  it("shows each issue's state, judgement and evidence count on one line — severity moved to the problem itself", async () => {
    renderMemory();
    const list = await screen.findByLabelText("반복 이슈 목록");
    const row = within(list).getByRole("link", { name: /접착력이 약하다는/ });
    expect(row).toHaveTextContent("확인 필요");
    expect(row).toHaveTextContent("증가 중");
    expect(row).toHaveTextContent("근거 4건");
    expect(row).toHaveTextContent("마지막 확인 2026-08-02");
    // Metadata no longer opens the row: the title is read before the facts about it.
    expect(row).not.toHaveTextContent("심각도");
  });

  it("names the severity in the problem's own header", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    expect(detail).toHaveTextContent("심각도 심각");
  });

  it("links each row to its own deep link", async () => {
    renderMemory();
    const list = await screen.findByLabelText("반복 이슈 목록");
    expect(within(list).getByRole("link", { name: /접착력이/ })).toHaveAttribute(
      "href",
      "/memory/issue-1",
    );
  });
});

describe("고객운영 메모리 — deep link", () => {
  it("opens the requested issue with its evidence and trend", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    expect(within(detail).getByRole("heading", { level: 2 })).toHaveTextContent("접착력이");
    expect(await within(detail).findByText(/부착 후 며칠 지나니 떨어졌어요/)).toBeInTheDocument();
    // The quantified surge line, from the server's own numbers.
    expect(within(detail).getByText(/최근 7일 4건/)).toBeInTheDocument();
  });

  it("says so honestly when the issue is not loaded", async () => {
    renderMemory("/memory/nope");
    expect(await screen.findByText("이 문제를 찾을 수 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/목록에서 다시 선택해 주세요/)).toBeInTheDocument();
  });

  it("surfaces suppressed evidence as a count rather than an empty quote", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    expect(await within(detail).findByText(/인용을 표시할 수 없는 근거가 1건/)).toBeInTheDocument();
  });

  it("shows the recorded state history", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    expect(await within(detail).findByText("기록")).toBeInTheDocument();
  });
});

/**
 * <b>Rewritten when the destination changed.</b> The claim this replaced was 「link a quote only when
 * that row is actually loaded in the inbox」, and it was right about its own destination: an inbox
 * page could only open a row it already held, so an unconditional link there would reliably land on
 * 「찾을 수 없습니다」. The cost was that whether a seller could reach the review behind a quote
 * depended on what a different screen had fetched — on this org most evidence is older than any
 * loaded inbox page, so most quotes were dead ends.
 *
 * The destination is now the review's own processing surface, which resolves its account from the
 * review id with an org-scoped read. It needs nothing loaded, so the condition that made the old
 * claim true is gone and the honest claim is stronger: EVERY quote reaches the review behind it, and
 * it reaches the one surface where that review is judged and answered.
 */
describe("고객운영 메모리 — evidence links back to the review", () => {
  it("links every rendered quote to that review's own processing surface", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    const links = await within(detail).findAllByRole("link", { name: "이 리뷰 처리하기" });
    // One per rendered quote — not one per quote the inbox happened to hold.
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/reviews/reply/rev-loaded",
      "/reviews/reply/rev-not-loaded",
    ]);
    // And nothing still points at the inbox, which could not open most of these rows.
    expect(within(detail).queryByRole("link", { name: "인박스에서 보기" })).toBeNull();
  });
});

describe("고객운영 메모리 — 어디서 얼마나 반복되나", () => {
  it("shows each product's evidence count beside that product's own review total", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    const section = await within(detail).findByLabelText("어디서 반복되나");
    expect(within(section).getByText(/리뷰 1,761건 중 16건이 이 문제를 말했습니다/)).toBeInTheDocument();
    expect(within(section).getByText(/리뷰 416건 중 1건이 이 문제를 말했습니다/)).toBeInTheDocument();
  });

  /**
   * The workspace's whole failure mode in one assertion. A ratio drawn from these two numbers would
   * describe an examined population nobody measured — the denominator counts reviews the extractor
   * never read.
   */
  it("never prints a rate computed from the pair", async () => {
    renderMemory("/memory/issue-1");
    const section = await screen.findByLabelText("어디서 반복되나");
    expect(section.textContent ?? "").not.toMatch(/%|퍼센트|비율/);
  });

  it("opens the product behind each row", async () => {
    renderMemory("/memory/issue-1");
    const section = await screen.findByLabelText("어디서 반복되나");
    expect(within(section).getByRole("link", { name: /전선몰딩 1호/ }))
      .toHaveAttribute("href", "/products/prod-1");
  });

  it("states the evidence that belongs to no product rather than losing it", async () => {
    renderMemory("/memory/issue-1");
    const section = await screen.findByLabelText("어디서 반복되나");
    expect(within(section).getByText(/확인되지 않은 근거가 2건/)).toBeInTheDocument();
  });

  /**
   * A read that failed renders nothing at all. 「0개 상품」 would be this screen reporting a fact it
   * could not see — and on a workspace whose job is deciding, an invented zero is the worst output.
   */
  it("renders nothing about repetition when that read failed", async () => {
    getRepeatedIssueContextStrict.mockRejectedValue(new Error("down"));
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    // The problem and its evidence still render — the two reads fail apart.
    expect(within(detail).getByText("근거")).toBeInTheDocument();
    expect(within(detail).queryByLabelText("어디서 반복되나")).toBeNull();
    expect(within(detail).queryByLabelText("우리가 써 둔 것")).toBeNull();
  });
});

describe("고객운영 메모리 — 우리가 써 둔 것", () => {
  it("counts what the library holds against what names this problem, and quotes the seller", async () => {
    renderMemory("/memory/issue-1");
    const section = await screen.findByLabelText("우리가 써 둔 것");
    expect(within(section).getByText("등록된 안내 5건 가운데 1건이 이 문제를 다룹니다.")).toBeInTheDocument();
    expect(within(section).getByText(/접착 면의 먼지를 닦고/)).toBeInTheDocument();
    // Something already answers it, so the screen does not ask for work that is done.
    expect(within(section).queryByRole("link", { name: /답변 기준 채우기/ })).toBeNull();
  });

  it("offers the way to fill a gap only when nothing names this problem", async () => {
    getRepeatedIssueContextStrict.mockResolvedValue({
      ...REPEAT_CONTEXT,
      knowledge: { ...REPEAT_CONTEXT.knowledge, productMentions: 0, excerpts: [] },
    });
    renderMemory("/memory/issue-1");
    const section = await screen.findByLabelText("우리가 써 둔 것");
    expect(within(section).getByText(/이 문제를 다루는 내용은 찾지 못했습니다/)).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: /답변 기준 채우기/ }))
      .toHaveAttribute("href", "/knowledge");
  });
});

describe("고객운영 메모리 — 판단과 조치", () => {
  /**
   * The note is why this section exists. Both transitions have accepted an operator note since the
   * lifecycle was built and no screen ever sent one, so every decision a seller made was recorded as
   * a state change by someone who said nothing about it.
   */
  it("sends the seller's own sentence with the transition", async () => {
    startReviewIssueAction.mockResolvedValue(SURGING);
    renderMemory("/memory/issue-1");
    await screen.findByLabelText("선택한 이슈");

    fireEvent.change(screen.getByLabelText(/무엇을 하기로 하셨나요/), {
      target: { value: "접착 테이프 공급처를 바꿉니다." },
    });
    fireEvent.click(screen.getByRole("button", { name: "조치 시작" }));

    await waitFor(() =>
      expect(startReviewIssueAction).toHaveBeenCalledWith("issue-1", "접착 테이프 공급처를 바꿉니다."),
    );
  });

  /**
   * Optional on purpose: a decision without a sentence is still a decision, and demanding prose
   * before a state change makes the record worse by making people skip the change.
   */
  it("records the decision with no note rather than blocking it", async () => {
    startReviewIssueAction.mockResolvedValue(SURGING);
    renderMemory("/memory/issue-1");
    await screen.findByLabelText("선택한 이슈");

    fireEvent.click(screen.getByRole("button", { name: "조치 시작" }));

    await waitFor(() => expect(startReviewIssueAction).toHaveBeenCalledWith("issue-1", undefined));
  });

  it("says what reviewnary is waiting for where the seller has no move", async () => {
    getReviewIssueDetailStrict.mockResolvedValue({ ...DETAIL, issue: IMPROVED });
    renderMemory("/memory/issue-2");
    const section = await screen.findByLabelText("판단과 조치");
    expect(within(section).queryByRole("button")).toBeNull();
    expect(within(section).queryByLabelText(/무엇을 하기로 하셨나요/)).toBeNull();
  });

  /**
   * <b>A seller may start work on a problem reviewnary has not raised</b> (product-owner decision,
   * 2026-09-13). Before this the control existed only in NEEDS_REVIEW, which an automatic judgement
   * produces — and on sparse evidence none ever fires, so on the demo org all 25 issues sat in
   * OBSERVING with no way to record a decision at all.
   */
  it("offers 조치 시작 on an observed problem, and still says reviewnary has not raised it", async () => {
    const observing = { ...SURGING, lifecycleState: "OBSERVING" as const, lifecycleLabelKo: "관찰 중" };
    getReviewIssuesStrict.mockResolvedValue([observing, IMPROVED]);
    getReviewIssueDetailStrict.mockResolvedValue({ ...DETAIL, issue: observing });
    startReviewIssueAction.mockResolvedValue(observing);

    renderMemory("/memory/issue-1");
    const section = await screen.findByLabelText("판단과 조치");
    // Both, not one instead of the other: the seller is acting ahead of reviewnary and can see that.
    expect(within(section).getByText(/먼저 확인을 권할 만큼 근거가 모이지는 않았습니다/)).toBeInTheDocument();

    fireEvent.change(within(section).getByLabelText(/무엇을 하기로 하셨나요/), {
      target: { value: "공급처를 바꿉니다." },
    });
    fireEvent.click(within(section).getByRole("button", { name: "조치 시작" }));
    await waitFor(() =>
      expect(startReviewIssueAction).toHaveBeenCalledWith("issue-1", "공급처를 바꿉니다."),
    );
  });
});

describe("고객운영 메모리 — 어떤 별점에서 나왔나", () => {
  it("reports each star band as a count of evidence", async () => {
    renderMemory("/memory/issue-1");
    const section = await screen.findByLabelText("어떤 별점에서 나왔나");
    expect(within(section).getByText("5점")).toBeInTheDocument();
    expect(within(section).getByText("근거 10건")).toBeInTheDocument();
    expect(within(section).getByText("근거 5건")).toBeInTheDocument();
    expect(within(section).getByText("별점 없음")).toBeInTheDocument();
  });

  /**
   * A problem raised entirely inside good ratings is invisible to every screen that sorts by star.
   * The zero bands are what make it visible, so they are asserted present rather than tolerated.
   */
  it("keeps the bands nobody complained in, and derives no rate from them", async () => {
    getRepeatedIssueContextStrict.mockResolvedValue({
      ...REPEAT_CONTEXT,
      evidence: {
        ...REPEAT_CONTEXT.evidence,
        ratingDistribution: { rating1: 0, rating2: 0, rating3: 3, rating4: 5, rating5: 10, unrated: 0 },
      },
    });
    renderMemory("/memory/issue-1");
    const section = await screen.findByLabelText("어떤 별점에서 나왔나");
    expect(within(section).getByText("1점")).toBeInTheDocument();
    expect(within(section).getAllByText("근거 0건").length).toBeGreaterThanOrEqual(2);
    expect(section.textContent ?? "").not.toMatch(/%|퍼센트|비율|평균/);
  });

  it("renders nothing at all when there is no evidence to spread", async () => {
    getRepeatedIssueContextStrict.mockResolvedValue({
      ...REPEAT_CONTEXT,
      evidence: {
        ...REPEAT_CONTEXT.evidence,
        ratingDistribution: { rating1: 0, rating2: 0, rating3: 0, rating4: 0, rating5: 0, unrated: 0 },
      },
    });
    renderMemory("/memory/issue-1");
    await screen.findByLabelText("선택한 이슈");
    expect(screen.queryByLabelText("어떤 별점에서 나왔나")).toBeNull();
  });
});

describe("고객운영 메모리 — lifecycle actions", () => {
  it("offers only the transition the lifecycle allows", async () => {
    renderMemory("/memory/issue-1");
    await screen.findByLabelText("선택한 이슈");
    expect(screen.getByRole("button", { name: "조치 시작" })).toBeInTheDocument();
    // There is deliberately no 해결 처리 control at any state — 해결됨 rests on observed quiet
    // weeks, and a button would let an assertion stand in for that evidence.
    expect(screen.queryByRole("button", { name: /해결/ })).toBeNull();
  });

  it("offers no action where the next move belongs to reviewnary", async () => {
    getReviewIssueDetailStrict.mockResolvedValue({ ...DETAIL, issue: IMPROVED });
    renderMemory("/memory/issue-2");
    const detail = await screen.findByLabelText("선택한 이슈");
    expect(
      await within(detail).findByText(/조치 이후 리뷰 변화를 지켜보고 있어요/),
    ).toBeInTheDocument();
    expect(within(detail).queryByRole("button")).toBeNull();
  });

  it("never describes the extraction as AI", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    expect(await within(detail).findByText(/규칙 기반 분석으로 모은 이슈 후보/)).toBeInTheDocument();
    expect(detail.textContent).not.toContain("AI");
  });
});

describe("고객운영 메모리 — empty and failed states", () => {
  it("invites a connection when nothing has been recorded", async () => {
    getReviewIssuesStrict.mockResolvedValue([]);
    renderMemory();
    expect(await screen.findByText("아직 쌓인 기록이 없습니다")).toBeInTheDocument();
  });

  it("says the read failed rather than showing an empty memory", async () => {
    getReviewIssuesStrict.mockRejectedValue(new Error("down"));
    renderMemory();
    expect(await screen.findByText("기록을 불러오지 못했습니다")).toBeInTheDocument();
  });
});

describe("고객운영 메모리 — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderMemory("/memory/issue-1");
    await screen.findByLabelText("선택한 이슈");
    await expectNoAxeViolations(container);
  });
});

describe("고객운영 메모리 — the issue's opportunities live beside its evidence (Opportunity Engine v1)", () => {
  it("draws the 개선 기회 section for the selected issue, read by that issue's id", async () => {
    getOpportunitiesStrict.mockResolvedValue([
      {
        issueId: SURGING.id, kind: "FAQ_SUPPLEMENT", kindLabelKo: "FAQ 보완", status: "OPEN", statusLabelKo: "검토 전",
        issueTitle: SURGING.title, aspect: "접착", problem: "탈락", severity: "HIGH", evidenceCount: 12,
        firstEvidenceOn: null, lastEvidenceOn: null, changeLabelsKo: ["급증"], productId: "p-1", productName: "전선몰딩 1호",
        whyKo: ["「접착 탈락」 근거 리뷰 12건."], recommendationKo: "'접착' 관련 안내를 자주 묻는 질문에 추가하는 것을 검토하세요.",
        evidenceTo: `/memory/${SURGING.id}`, knowledge: { scope: "PRODUCT", scopeLabelKo: "이 상품의 상품 지식", type: "USAGE", topicLabelKo: "접착", sources: 2, mentions: 0, excerpts: [] },
        nextActionKo: "FAQ 초안 준비", draft: null, history: [], decidedAt: null,
      },
    ]);
    renderMemory(`/memory/${SURGING.id}`);
    const section = await screen.findByRole("region", { name: "개선 기회" });
    expect(getOpportunitiesStrict).toHaveBeenCalledWith({ issueId: SURGING.id, includeDismissed: true });
    expect(await within(section).findByText(/자주 묻는 질문에 추가/)).toBeTruthy();
    expect(await within(section).findByRole("button", { name: "FAQ 초안 준비" })).toBeTruthy();
    // On the evidence surface itself, the card does not link back to the page it is on.
    expect(within(section).queryByText(/근거 리뷰 12건 보기/)).toBeNull();
  });

  it("says plainly when the issue yields no opportunity", async () => {
    renderMemory(`/memory/${SURGING.id}`);
    const section = await screen.findByRole("region", { name: "개선 기회" });
    expect(await within(section).findByText(/아직 제안할 개선 기회가 없습니다/)).toBeTruthy();
  });
});

/** Stands the list and the detail side by side, as the layout does at 1200px and up. Returns the restore. */
function stubWide(matches: boolean): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
