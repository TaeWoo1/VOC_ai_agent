// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrendChart, tickIndexes } from "./TrendChart";
import type { MetricSeries } from "../../lib/types";

const SALES: MetricSeries = { key: "s", label: "매출", unit: "원", points: [
  { date: "2026-08-21", value: 100000 }, { date: "2026-08-22", value: 250000 }, { date: "2026-08-23", value: 0 },
] };
const ORDERS: MetricSeries = { key: "o", label: "주문", unit: "건", points: [
  { date: "2026-08-21", value: 4 }, { date: "2026-08-22", value: 9 }, { date: "2026-08-23", value: 0 },
] };

describe("TrendChart — interactive", () => {
  it("shows the exact values of the hovered day, mapped to the same index in both series", () => {
    render(<TrendChart primary={SALES} secondary={ORDERS} />);
    fireEvent.mouseEnter(screen.getByTestId("trend-band-2026-08-22"));
    const tip = screen.getByTestId("trend-tooltip");
    expect(tip).toHaveTextContent("8월 22일");
    expect(tip).toHaveTextContent("₩250,000");
    expect(tip).toHaveTextContent("9건");
  });

  it("legend toggles a series off and never hides the last one", async () => {
    render(<TrendChart primary={SALES} secondary={ORDERS} />);
    const orders = screen.getByRole("button", { name: "주문" });
    await userEvent.click(orders);
    expect(orders).toHaveAttribute("aria-pressed", "false");
    const sales = screen.getByRole("button", { name: "매출" });
    await userEvent.click(sales);
    expect(sales).toHaveAttribute("aria-pressed", "true");
  });

  it("offers a click only when a drill-down exists, and keyboard reaches it", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<TrendChart primary={SALES} />);
    expect(screen.getByTestId("trend-band-2026-08-21")).not.toHaveStyle({ cursor: "pointer" });
    rerender(<TrendChart primary={SALES} onSelectDate={onSelect} />);
    expect(screen.getByTestId("trend-band-2026-08-21")).toHaveStyle({ cursor: "pointer" });
    fireEvent.click(screen.getByTestId("trend-band-2026-08-23"));
    expect(onSelect).toHaveBeenCalledWith("2026-08-23");
    const chart = screen.getByTestId("trend-chart");
    chart.focus();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByTestId("trend-tooltip")).toHaveTextContent("8월 22일");
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("2026-08-22");
  });

  it("names both maxima when the two series have different units", () => {
    render(<TrendChart primary={SALES} secondary={ORDERS} />);
    expect(screen.getByText(/최대 매출 25만원 · 주문 9건/)).toBeInTheDocument();
  });

  it("tick indexes always include first and last", () => {
    expect(tickIndexes(1)).toEqual([0]);
    expect(tickIndexes(7)).toEqual([0, 2, 3, 5, 6]);
    expect(tickIndexes(30)[0]).toBe(0);
    expect(tickIndexes(30)[tickIndexes(30).length - 1]).toBe(29);
  });
});
