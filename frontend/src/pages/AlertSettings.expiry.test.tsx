// @vitest-environment jsdom
// The connector-alert surface renders the Coupang credential-expiry alert types with their own actionable
// labels (갱신 필요 / 재발급 필요) and supports the idempotent acknowledge (확인 처리). Reuses the existing
// ConnectorAlert FE — this pins the new expiry types onto it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { userEvent } from "../test/renderWithRouter";
import type { ConnectorAlertView } from "../lib/types";

const h = vi.hoisted(() => ({
  alerts: [] as ConnectorAlertView[],
  acknowledge: vi.fn(async (id: string) => ({ ...h.alerts[0], id, acknowledgedAt: "2026-08-07T00:00:00Z" })),
}));

vi.mock("../lib/apiClient", () => ({
  api: {
    getConnectorAlertsStrict: vi.fn(async () => h.alerts),
    acknowledgeConnectorAlert: h.acknowledge,
  },
}));

import { AlertSettings } from "./AlertSettings";
import { OpenAlertsProvider } from "../lib/openAlerts";

function expiring(over: Partial<ConnectorAlertView> = {}): ConnectorAlertView {
  return {
    id: "al-1",
    sellerAccountId: "acc-cp",
    channelId: "coupang-ch",
    channelNameKo: "쿠팡",
    accountAlias: null,
    type: "COUPANG_CREDENTIAL_EXPIRING",
    severity: "WARNING",
    message: "쿠팡 API 키 유효기간이 14일 남았습니다.",
    createdAt: "2026-08-06T00:00:00Z",
    acknowledgedAt: null,
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OpenAlertsProvider>
        <AlertSettings />
      </OpenAlertsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.alerts = [expiring()];
  h.acknowledge.mockClear();
});

describe("AlertSettings — Coupang expiry alerts", () => {
  it("renders the expiring alert with its actionable label + guidance", async () => {
    renderPage();
    expect(await screen.findByText("키 갱신 필요")).toBeInTheDocument();
    expect(screen.getByText(/WING에서 API 키 갱신하기/)).toBeInTheDocument();
  });

  it("renders the EXPIRED alert as 재발급 필요", async () => {
    h.alerts = [expiring({ id: "al-2", type: "COUPANG_CREDENTIAL_EXPIRED", severity: "CRITICAL", message: "쿠팡 API 키가 만료되었습니다." })];
    renderPage();
    expect(await screen.findByText("키 재발급 필요")).toBeInTheDocument();
  });

  it("acknowledges an expiry alert (확인 처리 is idempotent, marks it 확인됨)", async () => {
    renderPage();
    await screen.findByText("키 갱신 필요");
    await userEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => expect(h.acknowledge).toHaveBeenCalledWith("al-1"));
    expect(await screen.findByText(/확인됨/)).toBeInTheDocument();
  });
});
