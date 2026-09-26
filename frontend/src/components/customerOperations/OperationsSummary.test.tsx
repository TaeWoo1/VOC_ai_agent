/**
 * The Home's summary line as it renders — `docs/pilot_usage_loop_v1.md` §8.
 *
 * <p>Pinned here rather than in `homeSummary.test.ts` because the thing under test is the SENTENCE:
 * §8-4b allows 「새로 확인」 and forbids 「처리 완료」, and only rendered text can be held to that.
 */
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerOperationsHome } from "../../lib/customerOperationsTypes";
import type { MetricKpi, MetricSeries, OperationsHome, OperationsMetrics } from "../../lib/types";

const api = vi.hoisted(() => ({
  getInquiryQueueStrict: vi.fn(),
  getReviewWorkStrict: vi.fn(),
  activateCustomerOperations: vi.fn(),
  resumeCustomerOperations: vi.fn(),
}));
vi.mock("../../lib/apiClient", () => ({ api, getToken: () => null }));

import { CustomerOpsHome } from "./CustomerOpsHome";

const NOW = new Date("2026-09-16T05:30:00Z"); // 14:30 KST
const TODAY = "2026-09-16";

function kpi(key: string, over: Partial<MetricKpi> = {}): MetricKpi {
  return {
    key, label: key, value: 0, unit: "건", previousValue: null, deltaPercent: null,
    comparable: true, excludedChannels: 0, freshnessUnproven: false, ...over,
  };
}
function series(key: string, value: number): MetricSeries {
  return { key, label: key, unit: "건", points: [{ date: "2026-09-15", value: 9 }, { date: TODAY, value }] };
}
function metrics(over: Partial<OperationsMetrics> = {}): OperationsMetrics {
  return {
    period: { from: "2026-09-10", to: TODAY, previousFrom: "2026-09-03", previousTo: "2026-09-09", days: 7 },
    revenueBasis: "", orderCountBasis: "",
    kpis: [kpi("reviews"), kpi("inquiries")],
    series: [series("reviews", 3), series("inquiries", 5)],
    channels: [], exclusions: [], exampleDataIncluded: false,
    ...over,
  };
}

function co(handled: Partial<CustomerOperationsHome["handled"]> = {}): CustomerOperationsHome {
  return {
    available: true, eligible: true, status: "ACTIVE", cadenceMinutes: 120,
    lastCheckedAt: null, lastRunStatus: null, nextCheckAt: null, sources: [],
    decisions: { total: 0, rows: [] },
    handled: {
      since: "2026-09-15T05:30:00Z", autoResolved: 0, monitoring: 0, draftsPrepared: 0,
      verifying: 0, rows: [], checked: 0, ...handled,
    },
    gaps: { total: 0, rows: [] },
  };
}

function ops(): OperationsHome {
  return {
    reviews: { needsAttentionUndecided: 0, needsAttentionTotal: 0, watchTotal: 0, rows: [] },
    problems: { decidable: 0, observing: 0, dormant: 0, rows: [] },
    collection: [],
    prepared: { reviewRepliesApproved: 0, inquiryDraftsReady: 0, improvementDraftsReady: 0, rows: [] },
  } as never;
}

function draw(home = co(), m: OperationsMetrics | null = metrics()) {
  return render(
    <MemoryRouter>
      <CustomerOpsHome co={home} ops={ops()} now={NOW} onChanged={vi.fn()} metrics={m} />
    </MemoryRouter>,
  );
}

const summary = () => screen.findByTestId("today-summary");

beforeEach(() => {
  api.getInquiryQueueStrict.mockResolvedValue({ content: [], totalElements: 0, page: 0, size: 50 });
  api.getReviewWorkStrict.mockResolvedValue({ attentionTotal: 0, attention: [], committed: [] });
});
afterEach(cleanup);

describe("오늘 들어온 것 — a number only when it is a measured fact", () => {
  it("both lanes fresh: both counts, each with its own noun", async () => {
    draw();
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("오늘 들어온 것"));
    expect(line).toHaveTextContent("리뷰 3");
    expect(line).toHaveTextContent("문의 5");
    expect(line).not.toHaveTextContent("수집 확인 필요");
  });

  it("review lane stale, inquiry fresh: the review number is withheld and the inquiry number is not", async () => {
    draw(co(), metrics({ kpis: [kpi("reviews", { freshnessUnproven: true }), kpi("inquiries")] }));
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("리뷰 수집 확인 필요"));
    expect(line).toHaveTextContent("문의 5");
    expect(line).not.toHaveTextContent("리뷰 3");
    // One lane qualifies, so the lanes differ and the line must say which — never the collapsed form.
    expect(line).not.toHaveTextContent("수집 상태 확인 필요");
  });

  it("inquiry lane stale, review fresh: the mirror case", async () => {
    draw(co(), metrics({ kpis: [kpi("reviews"), kpi("inquiries", { excludedChannels: 1 })] }));
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("문의 수집 확인 필요"));
    expect(line).toHaveTextContent("리뷰 3");
    expect(line).not.toHaveTextContent("문의 5");
    expect(line).not.toHaveTextContent("수집 상태 확인 필요");
  });

  it("both stale: ONE state sentence, not the same five syllables twice", async () => {
    draw(
      co(),
      metrics({
        kpis: [kpi("reviews", { freshnessUnproven: true }), kpi("inquiries", { excludedChannels: 2 })],
        series: [series("reviews", 0), series("inquiries", 0)],
      }),
    );
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("수집 상태 확인 필요"));
    // The per-lane sentences are the thing being replaced — neither may also appear.
    expect(line).not.toHaveTextContent("리뷰 수집 확인 필요");
    expect(line).not.toHaveTextContent("문의 수집 확인 필요");
    // And still no digits: an unobserved zero never becomes 「0」.
    expect(line.textContent).not.toMatch(/리뷰 \d|문의 \d/);
  });

  it("a measured zero IS printed — that is the difference the state words exist to keep", async () => {
    draw(co(), metrics({ series: [series("reviews", 0), series("inquiries", 0)] }));
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("리뷰 0"));
    expect(line).toHaveTextContent("문의 0");
    expect(line).not.toHaveTextContent("수집 확인 필요");
  });

  it("names no channel it was not given — the summary never invents where a gap is", async () => {
    draw(co(), metrics({ kpis: [kpi("reviews", { excludedChannels: 1 }), kpi("inquiries")] }));
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("리뷰 수집 확인 필요"));
    // `excludedChannels` is a COUNT; the response's `exclusions` name channels but this line is not
    // given them, so it must not print 쿠팡/네이버/카페24 from a number.
    expect(line.textContent).not.toMatch(/쿠팡|네이버|카페24|스마트스토어/);
  });

  it("a failed overview read draws no inflow group at all", async () => {
    draw(co(), null);
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("최근 24시간"));
    expect(line).not.toHaveTextContent("오늘 들어온 것");
    expect(line).not.toHaveTextContent("수집 확인 필요");
  });

  it("example data is shown and labelled — a DEMO_SEED count may never read as the seller's", async () => {
    draw(co(), metrics({ exampleDataIncluded: true }));
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("예시 데이터"));
    expect(line).toHaveTextContent("리뷰 3");
  });

  it("drops the example label when no figure survived the freshness gate — it would qualify nothing", async () => {
    draw(
      co(),
      metrics({
        exampleDataIncluded: true,
        kpis: [kpi("reviews", { freshnessUnproven: true }), kpi("inquiries", { excludedChannels: 1 })],
      }),
    );
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("수집 상태 확인 필요"));
    expect(line).not.toHaveTextContent("예시 데이터");
  });

  it("and carries no label when the figures are the seller's own", async () => {
    draw();
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("리뷰 3"));
    expect(line).not.toHaveTextContent("예시 데이터");
  });
});

describe("최근 24시간 — what we opened, never what was completed", () => {
  it("nothing opened: one sentence, not three zeros", async () => {
    draw(co({ checked: 0, autoResolved: 0, draftsPrepared: 0 }));
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("최근 24시간 · 새로 확인한 일 없음"));
    expect(line.textContent).not.toMatch(/새로 확인 0/);
  });

  it("something opened: the denominator and its two subsets, in that order", async () => {
    draw(co({ checked: 12, autoResolved: 3, draftsPrepared: 2 }));
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("새로 확인 12"));
    expect(line).toHaveTextContent("그중 정리 3");
    expect(line).toHaveTextContent("초안 준비 2");
    expect(line).not.toHaveTextContent("새로 확인한 일 없음");
  });

  it("the two subsets may be zero while the denominator is not — they are subsets, not a sum", async () => {
    draw(co({ checked: 4, autoResolved: 0, draftsPrepared: 0 }));
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("새로 확인 4"));
    expect(line).toHaveTextContent("그중 정리 0");
    expect(line).toHaveTextContent("초안 준비 0");
  });

  it("never prints monitoring or verifying in this group — neither has a window", async () => {
    // §8-4a. Both are point-in-time counts of currently-open cases.
    draw(co({ checked: 7, autoResolved: 1, draftsPrepared: 1, monitoring: 5, verifying: 4 }), null);
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("새로 확인 7"));
    expect(line).not.toHaveTextContent("관찰");
    expect(line).not.toHaveTextContent("처리 확인 중");
    expect(line.textContent).not.toMatch(/\b5\b|\b4\b/);
  });

  it("says nothing when there is no window yet", async () => {
    draw(co({ since: null }));
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("오늘 들어온 것"));
    expect(line).not.toHaveTextContent("최근 24시간");
  });

  it("never calls any of it completion — the words §8-3 forbids appear nowhere", async () => {
    draw(co({ checked: 12, autoResolved: 3, draftsPrepared: 2 }));
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("새로 확인 12"));
    for (const banned of ["오늘 처리 완료", "처리 완료", "최근 24시간 처리", "Reviewnary가 처리한 일", "완료"]) {
      expect(line).not.toHaveTextContent(banned);
    }
  });
});

describe("the line as a whole", () => {
  it("reads inflow → work → window, in that order", async () => {
    draw(co({ checked: 12, autoResolved: 3, draftsPrepared: 2 }));
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("새로 확인 12"));
    const text = line.textContent ?? "";
    expect(text.indexOf("오늘 들어온 것")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("오늘 들어온 것")).toBeLessThan(text.indexOf("최근 24시간"));
  });

  it("is one line of muted 13px text with no box, no tile and no chart", async () => {
    const { container } = draw(co({ checked: 12 }));
    const line = await summary();
    expect(line.tagName).toBe("P");
    expect(line.className).toContain("text-[13px]");
    expect(line.className).toContain("text-muted");
    expect(line.className).not.toMatch(/border|bg-|rounded|shadow/);
    // Only the figures take ink and weight; nothing here is a headline number.
    expect(line.querySelectorAll(".font-semibold.text-ink.tabular-nums").length).toBeGreaterThan(0);
    expect(line.querySelectorAll("[class*='text-2xl'],[class*='text-xl'],[class*='font-bold']")).toHaveLength(0);
    expect(container.querySelectorAll("svg,canvas")).toHaveLength(0);
  });

  it("the arrows between groups are decoration and are hidden from assistive tech", async () => {
    draw(co({ checked: 1 }));
    const line = await summary();
    const arrows = [...line.querySelectorAll("span")].filter((el) => el.textContent === "→");
    expect(arrows.length).toBeGreaterThan(0);
    for (const arrow of arrows) expect(arrow).toHaveAttribute("aria-hidden", "true");
  });

  it("disappears entirely when nothing in it is true", async () => {
    draw(co({ since: null }), null);
    await screen.findByTestId("today-status");
    await waitFor(() => expect(screen.queryByTestId("today-summary")).toBeNull());
  });

  it("does not claim 실행 대기 while the job is not running", async () => {
    draw({ ...co({ checked: 1 }), status: "PAUSED" });
    const line = await summary();
    await waitFor(() => expect(line).toHaveTextContent("최근 24시간"));
    expect(line).not.toHaveTextContent("실행 대기");
  });
});
