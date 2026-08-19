// @vitest-environment jsdom
// Wiring test for the LIVE host-refusal branch: the agent is paired, but the issuance host cannot host the walk
// — e.g. a resident `--bridge-only` helper that announces no Action Window carrier (`no-announcement`), a helper
// on a different carrier (`carrier-mismatch`), or a START_RUN the agent rejected. Which one it was is an internal
// agent-runtime fact. The seller must NOT be shown an error for it: the walkthrough IS the text issuance flow.
// Needs live mode (no `run` prop) + a mocked issuance host, so it lives in its own file with its own mocks.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import type { BridgeState } from "../../lib/bridge/bridgeClient";

const h = vi.hoisted(() => ({
  bridge: { phase: "paired", maybeNeedsLocalNetworkAccess: false } as BridgeState,
  attach: vi.fn().mockResolvedValue(null),
  unavailable: "no-announcement" as string | null,
}));

vi.mock("../../hooks/useBridge", () => ({
  useBridge: () => ({ state: h.bridge, requestPairing: vi.fn(), revoke: vi.fn(), retry: vi.fn() }),
}));
vi.mock("../../lib/actionWindow/issuance/useGuidedIssuance", () => ({
  useGuidedIssuance: () => ({ view: null, unavailable: h.unavailable, attach: h.attach, send: vi.fn() }),
}));

import { CoupangIssuanceGuidedWalkthrough } from "./CoupangIssuanceGuidedWalkthrough";

beforeEach(() => {
  h.bridge = { phase: "paired", maybeNeedsLocalNetworkAccess: false };
  h.attach.mockClear();
  h.unavailable = "no-announcement";
});

async function start(onIssued = vi.fn()) {
  render(<CoupangIssuanceGuidedWalkthrough onIssued={onIssued} advertisedEgressIps={[]} />);
  await userEvent.click(screen.getByRole("button", { name: "쿠팡 연결 안내 시작" }));
  return onIssued;
}

describe("CoupangIssuanceGuidedWalkthrough — a paired helper that cannot host the walk", () => {
  it.each(["no-announcement", "carrier-mismatch", "ticket-rejected", "start-refused", "transport-version-mismatch"])(
    "paired + %s → the text issuance flow, with no error notice and no helper/carrier wording",
    async (reason) => {
      h.unavailable = reason;
      const onIssued = await start();
      expect(screen.getByLabelText("쿠팡 Open API 키 발급 안내")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText(/화면 안내를 실행할 수 없어요/)).toBeNull();
      expect(screen.queryByText(/안내 실행을 준비하지 못했어요/)).toBeNull();
      expect(screen.queryByText(/다른 연결 세션/)).toBeNull();
      expect(screen.queryByTestId("agent-env-retry")).toBeNull();
      // …and it is the real flow: completing the checklist hands off to credential entry.
      await userEvent.click(screen.getByRole("button", { name: "발급을 완료했어요" }));
      expect(onIssued).toHaveBeenCalledTimes(1);
    },
  );

  it("the host is still attached exactly once on start (the walk is attempted before being ruled out)", async () => {
    await start();
    expect(h.attach).toHaveBeenCalledTimes(1);
  });

  it("no refusal (host still attaching) → the neutral preparing line, not the text flow yet", async () => {
    h.unavailable = null;
    await start();
    expect(screen.getByText("도우미가 연결됐어요. 쿠팡 윙 안내를 준비하고 있어요.")).toBeInTheDocument();
    expect(screen.queryByLabelText("쿠팡 Open API 키 발급 안내")).toBeNull();
  });
});
