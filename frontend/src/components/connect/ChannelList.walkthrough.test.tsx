// @vitest-environment jsdom
//
// The campaign's FIRST in-app entry to the NAVER guided page must not drop the disposable walkthrough
// run id. Before this fix `connect-naver` navigated to a bare `/connect/naver`; in walkthrough mode that
// lands with no `?walkthroughRun=`, which the env-binding reads as MISSING_URL_RUN and fail-closes — the
// seller dead-ends at the mismatch screen. These tests pin: (1) walkthrough mode preserves the bound run
// id on the entry navigation, (2) a normal (non-walkthrough) build still gets the bare path, and (3) the
// run id is the build-injected value, never guessed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ChannelList } from "./ChannelList";
import type { ChannelResponse, ConnectionStatusView } from "../../lib/types";

afterEach(() => vi.unstubAllEnvs());

const NAVER: ChannelResponse = {
  id: "ch-naver",
  code: "NAVER",
  nameKo: "네이버",
  status: "SUPPORTED",
  dataBadges: [],
  lastSyncedAt: null,
  actionLabel: "연결하기",
  support: {
    fileUploadSupported: false,
    fileUploadDataTypes: [],
    autoCollectSupported: true,
    autoCollectDataTypes: ["ORDER_SUMMARY"],
    connectionCheckSupported: true,
    credentialSetupSupported: true,
  },
} as unknown as ChannelResponse;

/** Renders the current location so a click's navigation target is asserted directly. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={["/connect/channels"]}>
      <Routes>
        <Route
          path="/connect/channels"
          element={
            <ChannelList
              channels={[NAVER]}
              accounts={null}
              health={new Map<string, ConnectionStatusView>()}
              statusLoading={false}
              onNotice={() => {}}
            />
          }
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ChannelList — NAVER entry preserves the walkthrough run id", () => {
  it("in walkthrough mode navigates to /connect/naver WITH the bound run id", async () => {
    vi.stubEnv("VITE_WALKTHROUGH_MODE", "true");
    vi.stubEnv("VITE_WALKTHROUGH_RUN_ID", "wt-abc123");
    const { getByRole } = renderList();
    getByRole("button", { name: "연결하기" }).click();
    expect(await screen.findByTestId("loc")).toHaveTextContent(
      "/connect/naver?walkthroughRun=wt-abc123",
    );
  });

  it("outside walkthrough mode navigates to the bare /connect/naver (no query)", async () => {
    vi.stubEnv("VITE_WALKTHROUGH_MODE", "false");
    vi.stubEnv("VITE_WALKTHROUGH_RUN_ID", "");
    const { getByRole } = renderList();
    getByRole("button", { name: "연결하기" }).click();
    const loc = await screen.findByTestId("loc");
    expect(loc).toHaveTextContent("/connect/naver");
    expect(loc.textContent).not.toContain("walkthroughRun");
  });

  it("does NOT append a run id when the build carries none, even in walkthrough mode (never guesses)", async () => {
    vi.stubEnv("VITE_WALKTHROUGH_MODE", "true");
    vi.stubEnv("VITE_WALKTHROUGH_RUN_ID", "");
    const { getByRole } = renderList();
    getByRole("button", { name: "연결하기" }).click();
    const loc = await screen.findByTestId("loc");
    expect(loc.textContent).not.toContain("walkthroughRun");
  });
});
