// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Metric } from "./Metric";
import type { MetricKpi } from "../../lib/types";

const kpi: MetricKpi = {
  key: "orders",
  label: "최근 7일 주문",
  value: 0,
  unit: "건",
  comparable: true,
  deltaPercent: null,
  excludedChannels: 3,
  freshnessUnproven: false,
} as unknown as MetricKpi;

describe("the coverage qualification before the first connection (Pilot Readiness Gate v1 §4)", () => {
  it("says a seller with connections which channels are missing, in warn", () => {
    render(<Metric kpi={kpi} />);
    const line = screen.getByText("채널 3곳이 이 숫자에 없습니다");
    expect(line.className).toContain("text-warn");
  });

  it("says the plainer fact, and not in warn, on an account that has connected nothing", () => {
    render(<Metric kpi={kpi} beforeFirstConnection />);
    const line = screen.getByText("아직 연결된 채널이 없습니다");
    expect(line.className).toContain("text-muted");
    expect(line.className).not.toContain("text-warn");
    // The three-channel subtraction is not shown to somebody who has no total to subtract from.
    expect(screen.queryByText("채널 3곳이 이 숫자에 없습니다")).toBeNull();
  });
});
