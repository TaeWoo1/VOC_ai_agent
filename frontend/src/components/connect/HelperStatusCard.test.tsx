// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelperStatusCard } from "./HelperStatusCard";
import { MIN_HELPER_VERSION } from "../../lib/helper/helperStatus";
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
/** The helper's `GET /bridge/device/status` answer; null = the route does not answer (an older helper). */
let deviceStatus: unknown = null;
/** The helper's `POST /bridge/device/link` answer. */
let linkStart: unknown = null;
const approve = vi.fn(async (_code: string) => {});
vi.mock("../../lib/apiClient", () => ({ api: { approveHelperDevice: (code: string) => approve(code) } }));
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  const answer = (body: unknown) =>
    Promise.resolve(body === null ? { ok: false, json: () => Promise.resolve(null) } : { ok: true, json: () => Promise.resolve(body) });
  if (url.endsWith("/bridge/device/status")) {
    if (!init?.headers || !("Authorization" in (init.headers as Record<string, string>))) return answer(null);
    return answer(deviceStatus);
  }
  if (url.endsWith("/bridge/device/link")) {
    // The real helper reports a pending grant from the moment it accepted the press.
    if (linkStart && (linkStart as { ok?: unknown }).ok === true) deviceStatus = { linked: false, linking: "pending", verified: "UNVERIFIED" };
    return answer(linkStart);
  }
  return answer(healthBody);
});

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
  deviceStatus = null;
  linkStart = null;
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

  it("연결 필요 → 도우미 연결 asks for the pairing — nothing is raised on its own", async () => {
    phase = "unpaired";
    healthBody = { ok: true, agentVersion: MIN_HELPER_VERSION };
    renderCard();
    // Never paired from this browser: no 「다시」 for a first-time seller.
    expect(await screen.findByTestId("helper-state")).toHaveTextContent(/^연결 필요$/);
    expect(requestPairing).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("helper-connect"));
    expect(requestPairing).toHaveBeenCalledTimes(1);
  });

  it("연결됨 has no control, and 업데이트 필요 comes from the version the helper reports", async () => {
    phase = "paired";
    window.localStorage.setItem("sellerops_bridge_token", "t");
    healthBody = { ok: true, agentVersion: MIN_HELPER_VERSION };
    deviceStatus = { linked: true, linking: null, verified: "OK" };
    const { unmount } = renderCard();
    await waitFor(() => expect(screen.getByTestId("helper-state")).toHaveTextContent("연결됨"));
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    healthBody = { ok: true, agentVersion: "0.0.1-poc" };
    renderCard();
    await waitFor(() => expect(screen.getByTestId("helper-state")).toHaveTextContent("업데이트 필요"));
    expect(screen.getByRole("link", { name: "업데이트 방법 보기" })).toHaveAttribute("href", "/connect/helper");
  });

  it("the NAVER line is the helper's last observation: 로그인 필요 opens the guided run, READY says when", async () => {
    phase = "paired";
    window.localStorage.setItem("sellerops_bridge_token", "t");
    healthBody = { ok: true, agentVersion: MIN_HELPER_VERSION };
    deviceStatus = { linked: true, linking: null, verified: "OK" };
    renderCard(naver("LOGIN_REQUIRED", new Date(Date.now() - 3 * 60_000).toISOString()));
    expect(await screen.findByTestId("naver-session-state")).toHaveTextContent("로그인 필요");
    expect(screen.getByTestId("naver-login")).toBeInTheDocument();
  });

  it("never shows 로그인됨 without an observation, and prints no internal word", async () => {
    phase = "paired";
    window.localStorage.setItem("sellerops_bridge_token", "t");
    healthBody = { ok: true, agentVersion: MIN_HELPER_VERSION };
    deviceStatus = { linked: true, linking: null, verified: "OK" };
    renderCard(naver(null));
    expect(await screen.findByTestId("naver-session-state")).toHaveTextContent("확인되지 않음");
    const text = document.body.textContent ?? "";
    for (const w of ["bridge", "carrier", "pairing", "token", "47615", "localhost", "profile"]) {
      expect(text.toLowerCase()).not.toContain(w);
    }
  });
});

describe("HelperStatusCard — 이 기기 연결 (Helper Device Authentication v1)", () => {
  beforeEach(() => {
    window.localStorage.setItem("sellerops_bridge_token", "pairing-bearer");
    phase = "paired";
    healthBody = { ok: true, agentVersion: MIN_HELPER_VERSION };
  });

  it("a paired helper that is not linked to the account says 기기 연결 필요 with one control", async () => {
    deviceStatus = { linked: false, linking: null, verified: "UNVERIFIED" };
    const { container } = renderCard();
    await waitFor(() => expect(screen.getByTestId("helper-state")).toHaveTextContent("기기 연결 필요"));
    expect(screen.getByTestId("helper-link")).toHaveTextContent("이 기기 연결");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await expectNoAxeViolations(container);
  });

  it("one press: the helper's code goes to the server with the seller's own session, then the card watches until linked", async () => {
    deviceStatus = { linked: false, linking: null, verified: "UNVERIFIED" };
    linkStart = { ok: true, userCode: "BCDFGHJK", expiresAt: "2026-09-05T00:05:00Z" };
    renderCard();
    await waitFor(() => expect(screen.getByTestId("helper-state")).toHaveTextContent("기기 연결 필요"));
    fireEvent.click(screen.getByTestId("helper-link"));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("BCDFGHJK"));
    await waitFor(() => expect(screen.getByTestId("helper-state")).toHaveTextContent("연결 확인 중"));
    // The helper collects its token; the next status read says linked.
    deviceStatus = { linked: true, linking: null, verified: "OK" };
    await waitFor(() => expect(screen.getByTestId("helper-state")).toHaveTextContent("연결됨"), { timeout: 4000 });
    expect(screen.queryByRole("button")).toBeNull();
    // Nothing the seller typed, and no password anywhere on the wire.
    const bodies = fetchMock.mock.calls.map((c) => String(c[1]?.body ?? ""));
    for (const b of bodies) expect(b.toLowerCase()).not.toMatch(/password|email/);
  });

  it("a refused approval says so and offers the link again; an old helper without the route is not called 연결됨", async () => {
    deviceStatus = { linked: false, linking: null, verified: "UNVERIFIED" };
    linkStart = { ok: true, userCode: "BCDFGHJK", expiresAt: "2026-09-05T00:05:00Z" };
    approve.mockRejectedValueOnce(new Error("404"));
    const { unmount } = renderCard();
    await waitFor(() => expect(screen.getByTestId("helper-state")).toHaveTextContent("기기 연결 필요"));
    fireEvent.click(screen.getByTestId("helper-link"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("승인하지 못했습니다"));
    expect(screen.getByTestId("helper-link")).toBeInTheDocument();
    unmount();
    deviceStatus = null;
    renderCard();
    await waitFor(() => expect(screen.getByTestId("helper-state")).toHaveTextContent("확인 중"));
    expect(screen.queryByTestId("helper-link")).toBeNull();
  });

  it("a helper that cannot reach the server says which side is unreachable", async () => {
    deviceStatus = { linked: false, linking: "unreachable", verified: "UNVERIFIED" };
    renderCard();
    await waitFor(() => expect(screen.getByTestId("helper-state")).toHaveTextContent("서버 연결 확인 필요"));
    expect(screen.getByTestId("helper-link")).toHaveTextContent("다시 시도");
  });
});
