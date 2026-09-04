// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelperDevices } from "./HelperDevices";
import { expectNoAxeViolations } from "../../test/axe";
import type { HelperDeviceView } from "../../lib/types";

const list = vi.fn<[], Promise<HelperDeviceView[]>>();
const revoke = vi.fn(async (_id: string) => {});
vi.mock("../../lib/apiClient", () => ({
  api: { listHelperDevices: () => list(), revokeHelperDevice: (id: string) => revoke(id) },
}));

const device: HelperDeviceView = {
  id: "dev-1", deviceName: "Mac (arm64)", helperVersion: "0.2.0",
  linkedAt: new Date(Date.now() - 3 * 60_000).toISOString(), lastUsedAt: null, expiresAt: "2027-03-04T00:00:00Z",
};

beforeEach(() => { list.mockReset(); revoke.mockClear(); });
afterEach(() => vi.clearAllMocks());

function renderPage() {
  return render(<MemoryRouter><HelperDevices /></MemoryRouter>);
}

describe("설정 › 연결된 기기", () => {
  it("lists a linked helper by the name it gave, and says nothing internal", async () => {
    list.mockResolvedValue([device]);
    const { container } = renderPage();
    expect(await screen.findByTestId("helper-device")).toHaveTextContent("Mac (arm64)");
    expect(screen.getByTestId("helper-device")).toHaveTextContent("아직 사용 안 함");
    const text = document.body.textContent?.toLowerCase() ?? "";
    for (const w of ["token", "hash", "rvh_", "bridge", "pairing", "localhost"]) expect(text).not.toContain(w);
    await expectNoAxeViolations(container);
  });

  it("연결 해제 asks once, then revokes and re-reads", async () => {
    list.mockResolvedValueOnce([device]).mockResolvedValueOnce([]);
    renderPage();
    fireEvent.click(await screen.findByTestId("revoke"));
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("revoke-confirm"));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("dev-1"));
    await waitFor(() => expect(screen.queryByTestId("helper-device")).toBeNull());
    expect(screen.getByText(/아직 연결된 도우미가 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "채널 연결로 가기" })).toHaveAttribute("href", "/connect");
  });

  it("a failed read says so rather than showing an empty list as truth", async () => {
    list.mockRejectedValue(new Error("500"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("불러오지 못했습니다");
    expect(screen.queryByText(/아직 연결된 도우미가 없습니다/)).toBeNull();
  });
});
