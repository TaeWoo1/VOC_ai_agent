import { describe, expect, it } from "vitest";
import { kstDayKey, recentDay, todayInflow } from "./homeSummary";
import type { CustomerOperationsHome } from "./customerOperationsTypes";
import type { MetricKpi, MetricSeries, OperationsMetrics } from "./types";

/** 2026-09-16 14:30 KST — the same instant the Home tests use, so the day key is unambiguous. */
const NOW = new Date("2026-09-16T05:30:00Z");
const TODAY = "2026-09-16";

function kpi(key: string, over: Partial<MetricKpi> = {}): MetricKpi {
  return {
    key,
    label: key,
    value: 0,
    unit: "건",
    previousValue: null,
    deltaPercent: null,
    comparable: true,
    excludedChannels: 0,
    freshnessUnproven: false,
    ...over,
  };
}

function series(key: string, lastValue: number, lastDate = TODAY): MetricSeries {
  return {
    key,
    label: key,
    unit: "건",
    points: [
      { date: "2026-09-15", value: 99 },
      { date: lastDate, value: lastValue },
    ],
  };
}

function metrics(over: Partial<OperationsMetrics> = {}): OperationsMetrics {
  return {
    period: { from: "2026-09-10", to: TODAY, previousFrom: "2026-09-03", previousTo: "2026-09-09", days: 7 },
    revenueBasis: "",
    orderCountBasis: "",
    kpis: [kpi("reviews"), kpi("inquiries")],
    series: [series("reviews", 4), series("inquiries", 2)],
    channels: [],
    exclusions: [],
    exampleDataIncluded: false,
    ...over,
  };
}

describe("todayInflow — today's arrivals, or the refusal to state them", () => {
  it("takes today from the LAST point of the dense series the Home already read", () => {
    // The whole point of §8-1: no `days=1` call. The 7-day series' upper bound is today in Korea time,
    // so its last point IS today — and it is the last point, not the largest or the first.
    const inflow = todayInflow(metrics(), NOW);
    expect(inflow).toEqual({ reviews: { kind: "COUNT", value: 4 }, inquiries: { kind: "COUNT", value: 2 }, exampleData: false });
  });

  it("a zero that every channel was read for is a MEASURED zero and prints as 0", () => {
    const inflow = todayInflow(metrics({ series: [series("reviews", 0), series("inquiries", 0)] }), NOW);
    expect(inflow?.reviews).toEqual({ kind: "COUNT", value: 0 });
    expect(inflow?.inquiries).toEqual({ kind: "COUNT", value: 0 });
  });

  it("judges each metric on its OWN freshness — a stale review lane does not silence the inquiry count", () => {
    const inflow = todayInflow(
      metrics({ kpis: [kpi("reviews", { freshnessUnproven: true }), kpi("inquiries")] }),
      NOW,
    );
    expect(inflow?.reviews).toEqual({ kind: "UNQUALIFIED" });
    expect(inflow?.inquiries).toEqual({ kind: "COUNT", value: 2 });
  });

  it("and the other way round", () => {
    const inflow = todayInflow(
      metrics({ kpis: [kpi("reviews"), kpi("inquiries", { excludedChannels: 1 })] }),
      NOW,
    );
    expect(inflow?.reviews).toEqual({ kind: "COUNT", value: 4 });
    expect(inflow?.inquiries).toEqual({ kind: "UNQUALIFIED" });
  });

  it("both unqualified when neither lane is provably current", () => {
    const inflow = todayInflow(
      metrics({
        kpis: [kpi("reviews", { excludedChannels: 2 }), kpi("inquiries", { freshnessUnproven: true })],
        series: [series("reviews", 0), series("inquiries", 0)],
      }),
      NOW,
    );
    // The rows were there to be summed; the refusal is about whether every channel was READ, and a
    // zero that nobody could vouch for must not become 「0」.
    expect(inflow?.reviews).toEqual({ kind: "UNQUALIFIED" });
    expect(inflow?.inquiries).toEqual({ kind: "UNQUALIFIED" });
  });

  it("refuses a response whose last point is not today — a held answer is not this morning", () => {
    const stale = metrics({ series: [series("reviews", 4, "2026-09-15"), series("inquiries", 2, "2026-09-15")] });
    expect(todayInflow(stale, NOW)?.reviews).toEqual({ kind: "UNQUALIFIED" });
  });

  it("refuses a metric whose series or KPI is absent rather than assuming zero", () => {
    expect(todayInflow(metrics({ series: [series("inquiries", 2)] }), NOW)?.reviews).toEqual({ kind: "UNQUALIFIED" });
    expect(todayInflow(metrics({ kpis: [kpi("inquiries")] }), NOW)?.reviews).toEqual({ kind: "UNQUALIFIED" });
  });

  it("a failed read says nothing — it does not say zero", () => {
    expect(todayInflow(null, NOW)).toBeNull();
    expect(todayInflow(undefined, NOW)).toBeNull();
  });

  it("carries exampleDataIncluded through, so a DEMO_SEED count can never render unlabelled", () => {
    expect(todayInflow(metrics({ exampleDataIncluded: true }), NOW)?.exampleData).toBe(true);
  });

  it("reads the day in Korea time, not the host's", () => {
    // 2026-09-16 23:30 UTC is already the 17th in Seoul; a UTC-based key would call it the 16th and
    // then read yesterday's last point as today.
    expect(kstDayKey(new Date("2026-09-16T23:30:00Z"))).toBe("2026-09-17");
    expect(kstDayKey(NOW)).toBe(TODAY);
  });
});

function co(handled: Partial<CustomerOperationsHome["handled"]> = {}): CustomerOperationsHome {
  return {
    available: true,
    eligible: true,
    status: "ACTIVE",
    cadenceMinutes: 120,
    lastCheckedAt: null,
    lastRunStatus: null,
    nextCheckAt: null,
    sources: [],
    decisions: { total: 0, rows: [] },
    handled: {
      since: "2026-09-15T05:30:00Z",
      autoResolved: 0,
      monitoring: 0,
      draftsPrepared: 0,
      verifying: 0,
      rows: [],
      checked: 0,
      ...handled,
    },
    gaps: { total: 0, rows: [] },
  };
}

describe("recentDay — the three figures that actually share the 24-hour window", () => {
  it("returns exactly checked / autoResolved / draftsPrepared", () => {
    expect(recentDay(co({ checked: 12, autoResolved: 3, draftsPrepared: 2 }))).toEqual({
      checked: 12,
      autoResolved: 3,
      draftsPrepared: 2,
    });
  });

  it("never carries monitoring or verifying — they are point-in-time and have no window", () => {
    // §8-4a. Putting them under 「최근 24시간」 would attach a window to a number that has none.
    const value = recentDay(co({ checked: 12, monitoring: 5, verifying: 4 })) as Record<string, number>;
    expect(Object.keys(value).sort()).toEqual(["autoResolved", "checked", "draftsPrepared"]);
    expect(Object.values(value)).not.toContain(5);
    expect(Object.values(value)).not.toContain(4);
  });

  it("says nothing when the org has no window yet", () => {
    expect(recentDay(co({ since: null }))).toBeNull();
  });

  it("says nothing when the server did not send the denominator", () => {
    expect(recentDay(co({ checked: undefined }))).toBeNull();
  });

  it("a failed read says nothing", () => {
    expect(recentDay(null)).toBeNull();
    expect(recentDay(undefined)).toBeNull();
  });
});
