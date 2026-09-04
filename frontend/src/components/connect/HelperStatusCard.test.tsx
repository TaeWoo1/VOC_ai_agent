// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelperStatusCard } from "./HelperStatusCard";
import { expectNoAxeViolations } from "../../test/axe";
import type { ConnectionStatusView } from "../../lib/types";

const requestPairing = vi.fn();
const retry = vi.fn();
let phase = "unreachable";
let extra: Record<string, unknown> = {};

vi.mock("../../hooks/useBridge", () => ({
  useBridge: () => ({
    state: { phase, maybeNeedsLocalNetworkAccess: false, ...extra },
    requestPairing,
    revoke: vi.fn(),
    retry,
  }),
}));

let healthBody: unknown = null;
const fetchMock = vi.fn(() =>
  Promise.resolve(healthBody === null ? { ok: false, json: () => Promise.resolve(null) } : { ok: true, json: () => Promise.resolve(healthBody) }),
);

function naver(sessionReadiness: string | null, observedAt: string | null = null): ConnectionStatusView {
  return {
    sellerAccountId: "acc-nv", state: "CONNECTED", lastSuccessAt: null, consecutiveFailures: 0, lastError: null,
    lastSyncedAt: null, nextScheduledAt: null, sessionReadiness, sessionObservedAt: observedAt,
  };
}

function renderCard(health: ConnectionStatusView | null = naver(null)) {
  return render(
    <MemoryRouter>
      <HelperStatusCard naverHealth={health} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
  phase = "unreachable";
  extra = {};
  healthBody = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("HelperStatusCard — the six words and their one control", () => {
  it("설치 필요 with the guide when nothing answers and this browser never met a helper", async () => {
    const { container } = renderCard();
    expect(await screen.findByTestId("helper-state")).toHaveTextContent("설치 필요");
    expect(screen.getByRole("link", { name: "설치 안내" })).toHaveAttribute("href", "/connect/helper");
    await expectNoAxeViolations(container);
  });

  it("실행 필요 with 다시 찾기 when this browser was paired before", async () => {
    window.localStorage.setItem("sellerops_bridge_token", "t");
    renderCard();
    expect(await screen.findByTestId("helper-state")).toHaveTextContent("실행 필요");
    fireEvent.click(screen.getByTestId("helper-retry"));
    expect(retry).toHaveBeenCalled();
  });

  it("다시 연결 필요 → 도우미 연결 asks for the pairing — nothing is raised on its own", async () => {
    phase = "unpaired";
    healthBody = { ok: true, agentVersion: "0.1.0" };
    renderCard();
    expect(await screen.findByTestId("helper-state")).toHaveTextContent("다시 연결 필요");
    expect(requestPairing).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("helper-connect"));
    expect(requestPairing).toHaveBeenCalledTimes(1);
  });

  it("연결됨 has no control, and 업데이트 필요 comes from the version the helper reports", async () => {
    phase = "paired";
    healthBody = { ok: true, agentVersion: "0.1.0" };
    const { unmount } = renderCard();
    expect(await screen.findByTestId("helper-state")).toHaveTextContent("연결됨");
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    healthBody = { ok: true, agentVersion: "0.0.1-poc" };
    renderCard();
    await waitFor(() => expect(screen.getByTestId("helper-state")).toHaveTextContent("업데이트 필요"));
    expect(screen.getByRole("link", { name: "업데이트 방법 보기" })).toHaveAttribute("href", "/connect/helper");
  });

  it("the NAVER line is the helper's last observation: 로그인 필요 opens the guided run, READY says when", async () => {
    phase = "paired";
    healthBody = { ok: true, agentVersion: "0.1.0" };
    renderCard(naver("LOGIN_REQUIRED", new Date(Date.now() - 3 * 60_000).toISOString()));
    expect(await screen.findByTestId("naver-session-state")).toHaveTextContent("로그인 필요");
    expect(screen.getByTestId("naver-login")).toBeInTheDocument();
  });

  it("never shows 로그인됨 without an observation, and prints no internal word", async () => {
    phase = "paired";
    healthBody = { ok: true, agentVersion: "0.1.0" };
    renderCard(naver(null));
    expect(await screen.findByTestId("naver-session-state")).toHaveTextContent("확인되지 않음");
    const text = document.body.textContent ?? "";
    for (const w of ["bridge", "carrier", "pairing", "token", "47615", "localhost", "profile"]) {
      expect(text.toLowerCase()).not.toContain(w);
    }
  });
});
