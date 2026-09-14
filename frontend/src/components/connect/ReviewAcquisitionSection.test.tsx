// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { HelperState } from "../../lib/helper/helperStatus";

const getReviewAcquisitionReadiness = vi.fn();
const setStoreIdentity = vi.fn();
vi.mock("../../lib/apiClient", () => ({
  api: {
    getReviewAcquisitionReadiness: (id: string) => getReviewAcquisitionReadiness(id),
    setStoreIdentity: (id: string, v: string) => setStoreIdentity(id, v),
  },
  getToken: () => "token",
}));

/** The card is the single owner of the helper word; here it just reports whatever the test wants. */
let helperState: HelperState = { key: "CONNECTED", label: "연결됨", tone: "good", note: null, action: null };
vi.mock("./HelperStatusCard", () => ({
  HelperStatusCard: ({ onState }: { onState?: (s: HelperState) => void }) => {
    // In an effect, like the real card — reporting during render would set state on the parent mid-render.
    useEffect(() => onState?.(helperState), [onState]);
    return <div data-testid="helper-card">도우미</div>;
  },
}));

vi.mock("../acquisition/GuidedAcquisitionRun", () => ({
  GuidedAcquisitionRun: ({ accountId, path }: { accountId: string; path: string }) => (
    <div data-testid="run">{`${path}:${accountId}`}</div>
  ),
}));

import { ReviewAcquisitionSection } from "./ReviewAcquisitionSection";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  helperState = { key: "CONNECTED", label: "연결됨", tone: "good", note: null, action: null };
});

function renderSection() {
  render(
    <MemoryRouter>
      <ReviewAcquisitionSection accountId="acct-1" onCompleted={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("상품평 가져오기 — the press the channel screen never offered", () => {
  it("draws the control and starts exactly one run per press", async () => {
    getReviewAcquisitionReadiness.mockResolvedValue({ state: "READY", channelCode: "COUPANG" });
    renderSection();

    const start = await screen.findByTestId("acquisition-start");
    expect((start as HTMLButtonElement).disabled).toBe(false);
    // Nothing has run yet: mounting the section must not start anything.
    expect(screen.queryByTestId("run")).toBeNull();

    start.click();
    await waitFor(() => expect(screen.getByTestId("run")).toHaveTextContent("WING_READ_ACTION_WINDOW:acct-1"));
    // And the way to read again is another press, not a second automatic run.
    expect(screen.getByTestId("acquisition-restart")).toBeTruthy();
  });

  it("renders nothing at all for a channel with no screen read", async () => {
    getReviewAcquisitionReadiness.mockResolvedValue({ state: "CHANNEL_NOT_SUPPORTED", channelCode: "NAVER" });
    renderSection();
    await waitFor(() => expect(screen.queryByText("상품평 가져오기")).toBeNull());
    expect(screen.queryByTestId("acquisition-start")).toBeNull();
  });

  it("renders nothing when the readiness read failed — an unknown precondition is not a button", async () => {
    getReviewAcquisitionReadiness.mockRejectedValue(new Error("boom"));
    renderSection();
    await waitFor(() => expect(screen.queryByTestId("acquisition-start")).toBeNull());
    expect(screen.queryByText("상품평 가져오기")).toBeNull();
  });

  it("blocks the press and names the one next step when the account has no helper link", async () => {
    getReviewAcquisitionReadiness.mockResolvedValue({ state: "HELPER_NOT_LINKED", channelCode: "COUPANG" });
    renderSection();
    expect(await screen.findByTestId("acquisition-blocked")).toHaveTextContent("도우미와 연결되지 않았습니다");
    expect((screen.getByTestId("acquisition-start") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "도우미 연결하기" })).toBeTruthy();
  });

  it("blocks on a stopped 도우미 using the card's own sentence, not a second diagnosis", async () => {
    getReviewAcquisitionReadiness.mockResolvedValue({ state: "READY", channelCode: "COUPANG" });
    helperState = {
      key: "START", label: "실행 필요", tone: "warn",
      note: "도우미가 실행되고 있지 않습니다.", action: { kind: "retry", label: "다시 찾기" },
    };
    renderSection();
    expect(await screen.findByTestId("acquisition-blocked")).toHaveTextContent("도우미가 준비되면");
    expect((screen.getByTestId("acquisition-start") as HTMLButtonElement).disabled).toBe(true);
  });

  /**
   * <b>업체코드 is not an API key, and the screen stops asking for one.</b> The vendor code lived only in
   * the OpenAPI credential form, whose three fields are all required, so browser collection used to
   * require issuing API keys. The field that answers it is now here.
   */
  it("asks for the store code itself when that is what is missing — and offers no API-key detour", async () => {
    getReviewAcquisitionReadiness.mockResolvedValue({ state: "STORE_IDENTITY_UNKNOWN", channelCode: "COUPANG" });
    setStoreIdentity.mockResolvedValue({ state: "READY", channelCode: "COUPANG" });
    renderSection();

    const form = await screen.findByTestId("store-identity-form");
    expect((screen.getByTestId("acquisition-start") as HTMLButtonElement).disabled).toBe(true);
    // No trip to the credential wizard, and nothing on screen asks for a key or a secret.
    expect(screen.queryByRole("link", { name: /쿠팡 연결/ })).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/액세스 키|시크릿|API 키/);

    fireEvent.change(screen.getByLabelText("쿠팡 업체코드"), { target: { value: " A00123456 " } });
    fireEvent.click(within(form).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(setStoreIdentity).toHaveBeenCalledWith("acct-1", "A00123456"));
    // The answer it returns is the readiness it changed — the press becomes available with no reload.
    await waitFor(() => expect((screen.getByTestId("acquisition-start") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("store-identity-form")).toBeNull();
  });

  it("says what must be open before the press, and never names what carries the read", async () => {
    getReviewAcquisitionReadiness.mockResolvedValue({ state: "READY", channelCode: "COUPANG" });
    renderSection();
    await screen.findByTestId("acquisition-start");
    const text = document.body.textContent ?? "";
    // The login cannot be checked without reading the marketplace, so it is stated as a precondition.
    expect(text).toContain("로그인한 뒤 상품평 목록을 열어");
    // Deployment facts stay off a screen about the seller's reviews (execution_strategy_v1.md §5).
    for (const word of ["ASIDE", "Aside", "LOCAL_HELPER", "SELLER_CENTER_READ", "Action Window", "carrier", "bridge"]) {
      expect(text).not.toContain(word);
    }
  });
});
