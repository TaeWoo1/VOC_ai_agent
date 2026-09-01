/**
 * OrderOps — the order/sales flow, as the seller's own dashboard states it.
 *
 * <b>Every number here is the backend's.</b> `get_sales_trend` returns the same overview the home
 * screen draws (period totals, the previous same-length period, per-channel rows, dense daily series,
 * the exclusions and the example-data disclosure), and this specialist restates it in seller words
 * without recomputing a single figure. A channel-scoped question reads that channel's own trend
 * beside it. Nothing here explains WHY a number moved — that is a claim the evidence cannot carry, and
 * the rule judge refuses causal language anyway.
 *
 * <b>Period → window is the planner's token, not the sentence.</b> `filters.period` is a closed value
 * the model chose; this file maps it onto the overview's trailing window (7/14/30) and, for a week
 * question, splits the 14-day series into the two weeks the seller is comparing.
 */
import type { EvidenceRef, Finding, SpecialistResult } from "../state/OperatorState";
import type { NeedState } from "../plan/InvestigationPlan";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import type { SalesTrendRead } from "../tools/OperatorTools";
import type { SpecialistInput } from "./specialistInput";
import { attemptTool } from "../failure/SpecialistOutcome";
import { eventRange, observationDate } from "../scope/EvidenceTime";
import type { ChartArtifact, DateWindow, OrderSummaryArtifact } from "../../conversation/contract";
import { overviewDaysOf, periodLabel, windowOf } from "../../conversation/period";
import type { MetricSeries } from "../../spring/types";
import { log } from "../../log";

/** The need kinds this specialist answers. */
export const ORDER_NEEDS = ["ORDER_HISTORY"] as const;

export interface OrderOpsResult extends SpecialistResult {
  readonly needStates: readonly NeedState[];
}

export async function runOrderOps(input: SpecialistInput): Promise<OrderOpsResult> {
  const { registry, budget, evidence, allowedTools } = input;
  const pending = (reason: string): OrderOpsResult => ({
    specialist: "ORDER_OPS", findings: [], evidence: [], coverage: [],
    needStates: input.needs.map((n) => ({ id: n.id, status: "PENDING" as const, evidenceIds: [] })),
    note: reason,
  });
  // <b>A specialist with no needs reports nothing.</b> 「…는 이번 조사 계획에 포함되지 않았습니다」 is a fact
  // about OUR plan, not about the seller's business, and it arrived under answers it had nothing to do
  // with (live: 「너는 어떤 일을 도와줄 수 있어?」 ended in 「주문·매출 흐름은 이번 조사 계획에 포함되지
  // 않았습니다」). Nothing was asked of this specialist, so it claims nothing either way — the silence
  // guard in `operatorGraph` still says any REQUIRED need that ended PENDING.
  if (input.needs.length === 0) {
    return { specialist: "ORDER_OPS", findings: [], evidence: [], coverage: [], needStates: [] };
  }
  if (!budget.spend("tool")) {
    return pending("주문·매출을 읽기 전에 예산이 끝났습니다.");
  }
  const needId = input.needs[0]!.id;
  const period = input.filters?.period ?? input.workingSet?.filters.period?.token ?? null;
  const days = overviewDaysOf(period);
  // A channel the planner filtered to, the run is scoped to, or the previous set was about — in that
  // order of authority. The scope gate checks a named channel against `locator.channelCode` either way.
  const channel = input.filters?.channel ?? input.channelScope ?? input.workingSet?.filters.channelCode ?? null;

  const attempt = await attemptTool(
    { specialist: "ORDER_OPS", tool: OPERATOR_TOOL.GET_SALES_TREND, needId },
    () => registry.invoke<SalesTrendRead>(
      OPERATOR_TOOL.GET_SALES_TREND,
      { days, ...(channel ? { channel } : {}) },
      allowedTools,
    ),
  );
  if (!attempt.ok) {
    return { ...pending("주문·매출 흐름을 읽지 못했습니다."), failures: [attempt.failure], terminal: "FAILED" };
  }
  const read = attempt.value;
  const metrics = read.overview.metrics;
  const today = observationDate(input.referenceDate);
  const series = (key: string): MetricSeries | undefined => metrics.series.find((s) => s.key === key);

  // The window the ANSWER is about. For a week question the overview's 14-day totals are not what the
  // seller asked; the two halves of its series are, so the totals are summed from the series' own points.
  const split = period === "LAST_WEEK" || period === "THIS_WEEK";
  const revenuePts = series("revenue")?.points ?? [];
  const orderPts = series("orders")?.points ?? [];
  let window: DateWindow;
  let sales: number; let orders: number; let previousSales: number | null; let previousOrders: number | null;
  if (split && revenuePts.length >= 14) {
    const half = revenuePts.length - 7;
    const sum = (pts: readonly { value: number }[], from: number, to: number): number =>
      pts.slice(from, to).reduce((acc, p) => acc + p.value, 0);
    const recentWeek = { from: revenuePts[half]!.date, to: revenuePts[revenuePts.length - 1]!.date };
    const priorWeek = { from: revenuePts[0]!.date, to: revenuePts[half - 1]!.date };
    // 「지난주보다」 compares this week against last week; 「지난주」 alone is last week against the one
    // before it, which the 14-day read cannot show — so both tokens state the same pair and say which.
    window = { ...recentWeek, token: period };
    sales = sum(revenuePts, half, revenuePts.length);
    orders = sum(orderPts, half, orderPts.length);
    previousSales = sum(revenuePts, 0, half);
    previousOrders = sum(orderPts, 0, half);
    void priorWeek;
  } else {
    window = period ? windowOf(period, today) : { from: metrics.period.from, to: metrics.period.to, token: null };
    if (!period || period === "TODAY" || period === "YESTERDAY") {
      window = { from: metrics.period.from, to: metrics.period.to, token: period };
    }
    const kpi = (key: string) => metrics.kpis.find((k) => k.key === key);
    sales = kpi("revenue")?.value ?? revenuePts.reduce((a, p) => a + p.value, 0);
    orders = kpi("orders")?.value ?? orderPts.reduce((a, p) => a + p.value, 0);
    previousSales = kpi("revenue")?.previousValue ?? null;
    previousOrders = kpi("orders")?.previousValue ?? null;
  }
  const salesDelta = deltaPercent(sales, previousSales);
  const ordersDelta = deltaPercent(orders, previousOrders);

  // A channel-scoped answer states that channel's own trend, never the org's totals under its name.
  const channelRow = channel ? metrics.channels.find((c) => c.channelCode.toUpperCase() === channel.toUpperCase()) : null;
  const channelSales = read.channel ? read.channel.summary.totalSales7d : (channelRow?.revenue ?? null);
  const channelOrders = read.channel ? read.channel.summary.totalOrders7d : (channelRow?.orders ?? null);

  const ref = evidence.add({
    kind: "ORDER_SUMMARY",
    sourceTool: OPERATOR_TOOL.GET_SALES_TREND,
    args: { days, channel: channel ?? null },
    locator: {
      label: "주문·매출",
      count: channel ? (channelOrders ?? 0) : orders,
      ...(channel ? { channelCode: channel } : {}),
    },
    // The window's own span — the rows behind these totals happened inside it, by the read's definition.
    events: eventRange(window.from, window.to),
    coverage: "COVERED",
    provenance: `dashboard/overview:${days}d${channel ? `:${channel}` : ""}`,
  });

  const findings: Finding[] = [];
  const label = periodLabel(period);
  if (channel) {
    const name = channelRow?.channelNameKo ?? channel;
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "ORDER_OPS",
      statement: `${label} ${name} 매출은 ${won(channelSales ?? 0)}(주문 ${channelOrders ?? 0}건)입니다.`,
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: `/orders?days=${days}&channel=${channel}`,
      needId,
    });
  } else {
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "ORDER_OPS",
      statement: `${label} 매출은 ${won(sales)}(주문 ${orders}건)`
        + (salesDelta == null ? "입니다." : `으로 직전 ${label === "지난주" || label === "이번 주" ? "주" : `${days}일`}보다 ${Math.abs(salesDelta)}% ${salesDelta < 0 ? "줄었습니다" : "늘었습니다"}.`),
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: `/orders?days=${days}`,
      needId,
    });
    const counted = metrics.channels.filter((c) => c.countedInOrders);
    if (counted.length > 1) {
      findings.push({
        findingId: `f-${ref.evidenceId}-channels`,
        specialist: "ORDER_OPS",
        statement: `채널별로는 ${counted.map((c) => `${c.channelNameKo} ${won(c.revenue)}`).join(" · ")}입니다.`,
        evidenceIds: [ref.evidenceId],
        confidence: "NEEDS_REVIEW",
        verdict: null,
        surfaceLink: `/orders?days=${days}`,
        needId,
      });
    }
  }

  const notes: string[] = [];
  const orderExclusions = metrics.exclusions.filter((e) => e.dataType === "ORDER_SUMMARY" || e.dataType === "ORDER");
  if (orderExclusions.length > 0) {
    notes.push(`${orderExclusions.map((e) => `${e.channelNameKo}(${e.reasonKo})`).join(" · ")}은 이 숫자에 없습니다.`);
  }
  if (metrics.kpis.some((k) => (k.key === "revenue" || k.key === "orders") && k.freshnessUnproven)) {
    notes.push("일부 채널은 최신 수집이 확인되지 않아 이 숫자가 지금 상태인지 확인하지 못했습니다.");
  }
  if (metrics.exampleDataIncluded) {
    notes.push("예시 데이터가 포함된 숫자입니다.");
  }
  if ((period === "TODAY" || period === "YESTERDAY")) {
    notes.push(`주문·매출은 하루 단위로 조회할 수 없어 최근 ${days}일 기준으로 확인했습니다.`);
  }

  const summary: OrderSummaryArtifact = {
    artifactId: `a-${ref.evidenceId}`,
    type: "ORDER_SUMMARY",
    title: channel ? `${channelRow?.channelNameKo ?? channel} 주문·매출` : `${label} 주문·매출`,
    period: { ...window, days },
    channelCode: channel,
    totals: {
      orders: channel ? (channelOrders ?? 0) : orders,
      sales: channel ? (channelSales ?? 0) : sales,
      previousOrders: channel ? null : previousOrders,
      previousSales: channel ? null : previousSales,
      ordersDeltaPercent: channel ? null : ordersDelta,
      salesDeltaPercent: channel ? null : salesDelta,
    },
    channels: metrics.channels
      .filter((c) => !channel || c.channelCode.toUpperCase() === channel.toUpperCase())
      .map((c) => ({ channelCode: c.channelCode, channelNameKo: c.channelNameKo, orders: c.orders, sales: c.revenue, state: c.orderState })),
    exampleDataIncluded: metrics.exampleDataIncluded,
    exclusions: orderExclusions.map((e) => `${e.channelNameKo}: ${e.reasonKo}`),
    to: `/orders?days=${days}${channel ? `&channel=${channel}` : ""}`,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
  const chartPoints = read.channel
    ? read.channel.summary.trend.map((p) => ({ date: p.date, value: p.salesAmount }))
    : revenuePts.map((p) => ({ date: p.date, value: p.value }));
  const chart: ChartArtifact = {
    artifactId: `a-${ref.evidenceId}-chart`,
    type: "CHART",
    title: "매출 추이",
    unit: "원",
    series: [{ key: "revenue", label: "매출", points: chartPoints }],
    period: window,
    caption: metrics.revenueBasis,
    to: summary.to,
  };
  const artifacts = [summary, chart];

  log("order_ops", { days, channel: channel ?? "NONE", split, exampleData: metrics.exampleDataIncluded,
    exclusions: orderExclusions.length, terminal: "OK" });
  return {
    specialist: "ORDER_OPS",
    findings,
    evidence: [ref],
    coverage: [],
    failures: [],
    terminal: "OK",
    artifacts,
    needStates: input.needs.map((n) => ({
      id: n.id, status: "SATISFIED" as const, evidenceIds: [ref.evidenceId],
      coverage: "COVERED" as const, complete: true, settledBy: "ORDER_OPS" as const,
    })),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

function deltaPercent(current: number, previous: number | null): number | null {
  if (previous == null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function won(amount: number): string {
  return `${Math.trunc(amount).toLocaleString("ko-KR")}원`;
}
