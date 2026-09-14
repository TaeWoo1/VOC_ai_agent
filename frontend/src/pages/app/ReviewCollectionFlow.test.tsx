// @vitest-environment jsdom
/**
 * 셋업 화면의 계약: <b>한 걸음, 한 컨트롤, 그리고 실패한 자리에만 복구.</b>
 *
 * run은 여기서 주입된다 — 진짜 run을 돌리는 것은 판매자의 쿠팡 화면을 읽는 일이고, 테스트가 할 일이
 * 아니다. 주입되는 것은 그 run이 이미 내보내는 <b>상태</b>뿐이고, 이 화면이 그 상태를 어떤 걸음으로
 * 읽는지가 여기서 단언된다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ActionWindowRunView } from "../../lib/actionWindow/contract";
import { expectNoAxeViolations } from "../../test/axe";

const h = vi.hoisted(() => ({
  getSellerAccountsStrict: vi.fn(),
  getReviewAcquisitionReadiness: vi.fn(),
  getSyncRunsStrict: vi.fn(),
  setStoreIdentity: vi.fn(),
  send: vi.fn(),
  helperKey: "CONNECTED" as string,
  bootstrap: null as unknown,
  injected: {} as Partial<{ view: ActionWindowRunView | null; unavailable: string | null; startFailed: boolean }>,
}));

vi.mock("../../lib/apiClient", () => ({
  api: {
    getSellerAccountsStrict: () => h.getSellerAccountsStrict(),
    getReviewAcquisitionReadiness: (...a: unknown[]) => h.getReviewAcquisitionReadiness(...a),
    getSyncRunsStrict: (...a: unknown[]) => h.getSyncRunsStrict(...a),
    setStoreIdentity: (...a: unknown[]) => h.setStoreIdentity(...a),
  },
}));

/** 도우미 카드는 자기 상태를 보고하는 것으로 충분하다 — 이 화면은 그 답을 읽을 뿐이다. */
vi.mock("../../components/connect/HelperStatusCard", () => ({
  HelperStatusCard: ({ onState }: { onState?: (s: unknown) => void }) => {
    onState?.({
      key: h.helperKey,
      label: h.helperKey === "CONNECTED" ? "연결됨" : "기기 연결 필요",
      tone: "good",
      note: null,
      action: null,
    });
    return <div data-testid="helper-status">도우미</div>;
  },
}));

/**
 * run은 주입된다. 진짜 run을 돌리는 것은 판매자의 쿠팡 화면을 읽는 일이고, 테스트가 할 일이 아니다 —
 * 주입되는 것은 그 run이 이미 내보내는 상태뿐이다.
 */
vi.mock("../../components/acquisition/GuidedAcquisitionRun", () => ({
  GuidedAcquisitionRun: ({
    renderSurface,
    onCompleted,
  }: {
    renderSurface?: (s: unknown) => unknown;
    onCompleted?: () => void;
  }) => {
    // 진짜 컴포넌트가 하는 그대로: 끝난 run은 한 번 보고한다.
    const done = h.injected.view?.status === "COMPLETED";
    useEffect(() => {
      if (done) onCompleted?.();
    }, [done, onCompleted]);
    return ((renderSurface?.({
      paired: true,
      view: h.injected.view ?? null,
      unavailable: h.injected.unavailable ?? null,
      startFailed: h.injected.startFailed ?? false,
      starting: false,
      send: h.send,
    }) as JSX.Element) ?? null) as JSX.Element;
  },
}));

vi.mock("../../lib/storeIdentityBootstrap", () => ({
  readStoreIdentityBootstrap: () => Promise.resolve(h.bootstrap),
}));

import { ReviewCollectionFlow } from "./ReviewCollectionFlow";

function run(partial: Partial<ActionWindowRunView>): ActionWindowRunView {
  return {
    protocolVersion: 1,
    runId: "run-1",
    revision: 1,
    channelCode: "coupang",
    runCopyKey: "actionWindow.reviewAcquisition.run",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK"],
    progress: { completedSteps: 1, totalSteps: 3 },
    updatedAt: "2026-09-14T00:00:00Z",
    ...partial,
  } as ActionWindowRunView;
}

/** 기본은 판매자가 눌러서 도착한 방문 — 그것이 이 화면의 정상 진입이다. */
function view(arrival: "PRESSED" | "VISITED" = "PRESSED") {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/connect/channels/acc-1/review-collection",
          ...(arrival === "PRESSED" ? { state: { start: true } } : {}),
        },
      ]}
    >
      <Routes>
        <Route path="/connect/channels/:accountId/review-collection" element={<ReviewCollectionFlow />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.helperKey = "CONNECTED";
  h.injected = {};
  h.bootstrap = null;
  h.getSellerAccountsStrict.mockResolvedValue([{ id: "acc-1", channelNameKo: "쿠팡" }]);
  h.getReviewAcquisitionReadiness.mockResolvedValue({ state: "READY", channelCode: "COUPANG" });
  h.getSyncRunsStrict.mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe("리뷰 수집 셋업 — 한 걸음, 한 컨트롤", () => {
  it("도우미가 준비되지 않았으면 그 카드가 이 걸음의 전부다", async () => {
    h.helperKey = "LINK";
    view();
    expect(await screen.findByText("브라우저 수집 준비")).toBeInTheDocument();
    expect(screen.getByTestId("helper-status")).toBeInTheDocument();
    expect(screen.queryByTestId("flow-primary")).toBeNull();
  });

  it("장벽의 컨트롤은 판매자가 한 일의 이름을 단다", async () => {
    h.injected = { view: run({}) };
    view();
    expect(await screen.findByTestId("flow-primary")).toHaveTextContent("상품평 목록을 열었습니다");
    // 기술어는 이 화면에 없다.
    expect(screen.queryByText("확인 완료")).toBeNull();
    expect(screen.queryByText("직접 진행")).toBeNull();
    expect(screen.queryByText("안내를 준비하고 있어요")).toBeNull();
    // 도우미는 연결된 뒤 렌더되지 않는다.
    expect(screen.getByTestId("helper-status").parentElement?.className).toContain("hidden");
  });

  it("정상 걸음에는 복구 UI가 없다", async () => {
    h.injected = { view: run({}) };
    view();
    await screen.findByTestId("flow-primary");
    expect(screen.queryByTestId("flow-failure")).toBeNull();
  });

  it("실패한 걸음에서만 복구가 나타나고, 그 걸음에 붙는다", async () => {
    h.injected = { view: run({ blocker: { code: "STORE_MISMATCH", recoverable: true } as never }) };
    view();
    const failure = await screen.findByTestId("flow-failure");
    expect(failure).toHaveTextContent("다른 판매자 계정으로 로그인되어 있습니다");
    expect(screen.getByTestId("flow-primary")).toBeInTheDocument();
  });

  it("스토어 확인은 이 흐름에서 판매자가 답하는 유일한 질문이다", async () => {
    h.getReviewAcquisitionReadiness.mockResolvedValue({ state: "STORE_IDENTITY_UNKNOWN", channelCode: "COUPANG" });
    h.bootstrap = { state: "CANDIDATE", value: "A00012345" };
    h.injected = { view: run({ blocker: { code: "STORE_UNRESOLVED", recoverable: true } as never }) };
    view();
    expect(await screen.findByTestId("flow-store")).toHaveTextContent("A00012345");
    expect(screen.getByTestId("flow-primary")).toHaveTextContent("이 스토어를 연결하고 가져오기");
    expect(screen.getByTestId("flow-other-store")).toBeInTheDocument();
  });

  it("이미 아는 계정에서는 스토어 확인 칸이 진행 표시에도 없다", async () => {
    h.injected = { view: run({}) };
    view();
    await screen.findByTestId("flow-primary");
    expect(screen.queryByText("스토어 확인")).toBeNull();
  });

  it("완료 문장은 이 걸음이 남긴 기록에서만 온다", async () => {
    // 시작 전 기준과 같은 기록뿐이라면, 이 걸음은 아무것도 저장하지 않은 것이다.
    h.getSyncRunsStrict.mockResolvedValue([]);
    h.injected = { view: run({ status: "COMPLETED" }) };
    view();
    await screen.findByTestId("flow-done");
    await waitFor(() =>
      expect(screen.getByTestId("flow-done")).toHaveTextContent("새로 가져올 상품평이 없었습니다."),
    );
  });

  it("「그만두기」는 실제로 그만둔다 — 돌고 있는 읽기를 두고 화면만 나가지 않는다", async () => {
    h.injected = { view: run({ status: "RUNNING", allowedCommands: ["CANCEL_RUN", "FIND_CURRENT_STEP"] }) };
    view();
    await screen.findByTestId("flow-busy");
    fireEvent.click(screen.getByTestId("flow-exit"));
    expect(h.send).toHaveBeenCalledWith("CANCEL_RUN");
  });

  it("넘기는 중에는 취소를 보내지 않는다 — 이미 나간 POST는 되돌릴 수 없다", async () => {
    h.injected = { view: run({ status: "PROCESSING", allowedCommands: ["FIND_CURRENT_STEP"] }) };
    view();
    await screen.findByTestId("flow-busy");
    fireEvent.click(screen.getByTestId("flow-exit"));
    expect(h.send).not.toHaveBeenCalled();
  });

  it("주소로 들어오면 시작은 판매자에게 돌아간다 — 새로고침이 수집이 되지 않는다", async () => {
    view("VISITED");
    expect(await screen.findByTestId("flow-primary")).toHaveTextContent("지금 가져오기");
  });

  it("접근성 위반 0", async () => {
    h.injected = { view: run({}) };
    const { container } = view();
    await screen.findByTestId("flow-primary");
    await expectNoAxeViolations(container);
  });
});
