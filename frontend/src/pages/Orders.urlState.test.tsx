// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Orders, orderSeries } from "./Orders";
import { api } from "../lib/apiClient";

vi.mock("../lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/apiClient")>()),
  api: { getChannelsStrict: vi.fn(), getOrdersSummaryStrict: vi.fn() },
}));

function Probe() { const l = useLocation(); return <p data-testid="url">{l.pathname + l.search}</p>; }
function mount(path = "/orders") {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/orders" element={<><Orders /><Probe /></>} /></Routes></MemoryRouter>);
}
const summary = (n: number) => ({ totalOrders7d: n, totalSales7d: n * 1000, trend: [
  { date: "2026-08-25", orderCount: 3, salesAmount: 30000 }, { date: "2026-08-26", orderCount: 5, salesAmount: 50000 }, { date: "2026-08-27", orderCount: 2, salesAmount: 20000 },
], channelShare: [{ channelNameKo: "쿠팡", salesAmount: 700, percent: 70 }] });

beforeEach(() => {
  vi.mocked(api.getChannelsStrict).mockResolvedValue([{ id: "ch-1", code: "COUPANG", nameKo: "쿠팡" } as never]);
  vi.mocked(api.getOrdersSummaryStrict).mockReset().mockImplementation(async (p) => summary(p?.from === p?.to ? 7 : 192));
});

describe("Orders — the URL is the filter", () => {
  it("range, channel and day all live in the URL and all read from one response", async () => {
    mount();
    await screen.findByText("192");
    await userEvent.click(screen.getByRole("button", { name: "최근 30일" }));
    await waitFor(() => expect(screen.getByTestId("url")).toHaveTextContent("days=30"));
    expect(api.getOrdersSummaryStrict).toHaveBeenLastCalledWith(expect.objectContaining({ channelId: undefined }));
    await userEvent.click(await screen.findByRole("button", { name: /쿠팡/ }));
    await waitFor(() => expect(screen.getByTestId("url")).toHaveTextContent("channel=ch-1"));
    await waitFor(() => expect(api.getOrdersSummaryStrict).toHaveBeenLastCalledWith(expect.objectContaining({ channelId: "ch-1" })));
    expect(screen.getByRole("combobox")).toHaveValue("ch-1");
  });

  it("a bar press drills into that day; the figures say the day and the chart keeps the window", async () => {
    mount();
    await screen.findByText("192");
    fireEvent.click(screen.getByTestId("trend-band-2026-08-26"));
    await waitFor(() => expect(screen.getByTestId("url")).toHaveTextContent("date=2026-08-26"));
    expect(await screen.findByText("주문 · 8월 26일")).toBeInTheDocument();
    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(api.getOrdersSummaryStrict).toHaveBeenLastCalledWith(expect.objectContaining({ from: "2026-08-26", to: "2026-08-26" }));
    expect(screen.getByTestId("trend-band-2026-08-25")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("orders-day-chip"));
    await waitFor(() => expect(screen.getByTestId("url")).not.toHaveTextContent("date="));
  });

  it("orderSeries keeps the two units apart", () => {
    const s = orderSeries(summary(1).trend);
    expect(s.sales.unit).toBe("원");
    expect(s.orders.unit).toBe("건");
    expect(s.orders.points[1]).toEqual({ date: "2026-08-26", value: 5 });
  });
});
