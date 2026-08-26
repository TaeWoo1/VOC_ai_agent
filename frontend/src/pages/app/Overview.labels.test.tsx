// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { withPeriodLabel } from "./Overview";
import { Metric } from "../../components/ui/Metric";
import type { MetricKpi } from "../../lib/types";

function kpi(over: Partial<MetricKpi> & Pick<MetricKpi, "key" | "label">): MetricKpi {
  return {
    value: 1,
    unit: "건",
    previousValue: 0,
    deltaPercent: null,
    comparable: true,
    excludedChannels: 0,
    freshnessUnproven: false,
    ...over,
  } as MetricKpi;
}

/**
 * The home screen's numbers were arithmetically correct and read as contradictions, because nothing
 * on the card said which span it counted. These assertions are the fix's contract.
 */
describe("home KPI labels say which span they count", () => {
  it("prefixes a windowed number with the window the SERVER reported", () => {
    expect(withPeriodLabel(kpi({ key: "orders", label: "주문" }), 7).label).toBe("최근 7일 주문");
    expect(withPeriodLabel(kpi({ key: "orders", label: "주문" }), 30).label).toBe("최근 30일 주문");
  });

  it("prefixes a point-in-time number with 현재 — it has no window at all", () => {
    // The backend marks it by having nothing to compare against, which is what is read here. A KPI
    // added later is labelled correctly without anyone editing a list.
    const now = kpi({
      key: "unansweredInquiries",
      label: "미답변 문의",
      comparable: false,
      previousValue: null,
    });
    expect(withPeriodLabel(now, 7).label).toBe("현재 미답변 문의");
  });

  it("disambiguates 문의 from 미답변 문의, which sat beside each other reading as one quantity", () => {
    expect(withPeriodLabel(kpi({ key: "inquiries", label: "문의" }), 7).label).toBe(
      "최근 7일 신규 문의",
    );
  });

  it("changes only the label — never a value, a unit or a comparison", () => {
    const source = kpi({ key: "revenue", label: "매출", value: 2_500_000, unit: "원", deltaPercent: 12 });
    const out = withPeriodLabel(source, 14);
    expect({ ...out, label: source.label }).toEqual(source);
  });
});

describe("a metric that navigates says so", () => {
  it("draws a chevron when it is pressable", () => {
    const { container } = render(
      <Metric kpi={kpi({ key: "orders", label: "최근 7일 주문" })} onClick={() => {}} />,
    );
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("draws none when it is only a number to read", () => {
    const { container } = render(<Metric kpi={kpi({ key: "orders", label: "최근 7일 주문" })} />);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("최근 7일 주문")).toBeInTheDocument();
  });
});
