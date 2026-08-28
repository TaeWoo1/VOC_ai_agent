// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { act } from "@testing-library/react";
import { HumanActionArtifact } from "./HumanActionArtifact";
import type { HumanActionRequiredArtifact } from "../../../lib/conversation/types";
import type { AcquireRuntime, AcquisitionStart } from "../../../lib/actionWindow/acquire/acquireRuntime";
import type { ActionWindowRunView } from "../../../lib/actionWindow/contract";

const manualSync = vi.fn();
const startReviewAcquisitionRun = vi.fn();
vi.mock("../../../lib/apiClient", () => ({
  api: {
    manualSync: (...a: unknown[]) => manualSync(...a),
    startReviewAcquisitionRun: (...a: unknown[]) => startReviewAcquisitionRun(...a),
  },
  getToken: () => null,
}));

/** A fake acquisition runtime: records the one START_RUN and lets the test publish views. */
function fakeAcquire() {
  const listeners = new Set<(v: ActionWindowRunView | null) => void>();
  let latest: ActionWindowRunView | null = null;
  const starts: AcquisitionStart[] = [];
  const sent: string[] = [];
  const runtime: AcquireRuntime & { starts: AcquisitionStart[]; sent: string[]; publish: (v: ActionWindowRunView) => void } = {
    starts,
    sent,
    view: () => latest,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    start: vi.fn(async (input: AcquisitionStart) => {
      starts.push(input);
    }),
    send: (type) => sent.push(type),
    resync: () => undefined,
    dispose: vi.fn(),
    publish(v) {
      latest = v;
      listeners.forEach((l) => l(v));
    },
  };
  return runtime;
}

function view(status: ActionWindowRunView["status"], allowed: ActionWindowRunView["allowedCommands"] = []): ActionWindowRunView {
  return {
    runId: "run_1", channelCode: "naver", status, revision: 2, runCopyKey: "actionWindow.run.export",
    currentStep: { stepNumber: 2, totalSteps: 3, stepId: "aw.user_download", copyKey: "actionWindow.step.userDownload", copyParams: {}, mode: "ACTION_WINDOW", status: "WAITING_FOR_HUMAN" },
    progress: { completedSteps: 1, totalSteps: 3 }, blocker: null, allowedCommands: allowed, updatedAt: "2026-08-28T00:00:00Z",
  } as unknown as ActionWindowRunView;
}

function artifact(over: Partial<HumanActionRequiredArtifact>): HumanActionRequiredArtifact {
  return {
    artifactId: "h-1",
    type: "HUMAN_ACTION_REQUIRED",
    title: "리뷰 가져오기 필요",
    actionType: "REVIEW_IMPORT",
    reason: "FRESHNESS_UNPROVEN",
    path: "MANUAL_SYNC",
    channelCode: "CAFE24",
    channelNameKo: "카페24 자사몰",
    accountId: "acc-1",
    dataType: "REVIEW",
    to: null,
    requestedAt: "2026-08-27T09:00:00Z",
    resumable: true,
    ...over,
  };
}

beforeEach(() => {
  manualSync.mockReset();
  startReviewAcquisitionRun.mockReset().mockResolvedValue({ acquisitionRef: "acq-1", channelCode: "COUPANG" });
});

describe("human action artifact — one primary per path", () => {
  it("MANUAL_SYNC: 「지금 리뷰 가져오기」 starts the seller-pressed collection, then resumes", async () => {
    manualSync.mockResolvedValue({ id: "run-1" });
    const onResume = vi.fn();
    render(<MemoryRouter><HumanActionArtifact artifact={artifact({})} onResume={onResume} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "새 리뷰를 확인하려면 리뷰 가져오기가 필요합니다" })).toBeInTheDocument();
    expect(screen.getByText(/카페24 자사몰/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "직접 진행하기" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "지금 리뷰 가져오기" }));
    await waitFor(() => expect(manualSync).toHaveBeenCalledWith("acc-1", "REVIEW"));
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
  });

  it("ACTION_WINDOW / FILE_UPLOAD: a link to the screen, returning to the home", () => {
    render(<MemoryRouter><HumanActionArtifact artifact={artifact({ path: "ACTION_WINDOW", to: "/connect/channels/acc-1", channelNameKo: "쿠팡" })} onResume={() => undefined} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "지금 리뷰 가져오기" })).toBeNull();
    expect(screen.getByRole("link", { name: "직접 진행하기" })).toHaveAttribute("href", "/connect/channels/acc-1?returnTo=%2F");
    expect(manualSync).not.toHaveBeenCalled();
  });

  it("「계속 확인하기」 resumes without starting anything", async () => {
    const onResume = vi.fn();
    render(<MemoryRouter><HumanActionArtifact artifact={artifact({ path: "FILE_UPLOAD", to: "/connect/upload", channelNameKo: "네이버" })} onResume={onResume} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "계속 확인하기" }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(manualSync).not.toHaveBeenCalled();
  });
});

describe("human action artifact — guided acquisition inline (EXPORT_ACTION_WINDOW · WING_READ_ACTION_WINDOW)", () => {
  it("NAVER export: the seller's press starts ONE v1-clean START_RUN; controls come from allowedCommands; COMPLETED resumes once", async () => {
    const runtime = fakeAcquire();
    const onResume = vi.fn();
    render(
      <MemoryRouter>
        <HumanActionArtifact
          artifact={artifact({ path: "EXPORT_ACTION_WINDOW", channelCode: "NAVER", channelNameKo: "네이버", accountId: "acc-nv", to: "/connect/imports", fallback: { path: "FILE_UPLOAD", to: "/connect/upload", label: "파일로 올리기" } })}
          onResume={onResume}
          acquireRuntime={runtime}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/판매자센터의 리뷰 내려받기 화면과 기간을 준비합니다/)).toBeInTheDocument();
    expect(screen.queryByText(/한 번 클릭/)).toBeNull();
    // The fallback is a secondary text link, never the primary.
    expect(screen.getByRole("link", { name: "파일로 올리기" })).toHaveAttribute("href", "/connect/upload?returnTo=%2F");
    expect(runtime.start).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "지금 네이버 리뷰 가져오기" }));
    await waitFor(() => expect(runtime.start).toHaveBeenCalledTimes(1));
    expect(runtime.starts).toEqual([{ intent: "EXPORT" }]);
    expect(startReviewAcquisitionRun).not.toHaveBeenCalled();

    act(() => runtime.publish(view("WAITING_FOR_HUMAN", ["REQUEST_STEP_RECHECK", "CANCEL_RUN"])));
    expect(await screen.findByTestId("guided-acquisition-run")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /확인 완료/ })).toBeInTheDocument();
    // SWITCH_TO_MANUAL was not allowed by the runtime's view ⇒ not rendered.
    expect(screen.queryByRole("button", { name: /직접 진행/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /확인 완료/ }));
    expect(runtime.sent).toEqual(["REQUEST_STEP_RECHECK"]);
    // Nothing completed client-side: still waiting until the runtime says otherwise.
    expect(onResume).not.toHaveBeenCalled();

    act(() => runtime.publish(view("COMPLETED")));
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
    act(() => runtime.publish(view("COMPLETED")));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(manualSync).not.toHaveBeenCalled();
  });

  it("Coupang WING read: connect first, mint the single-use acquisitionRef second, then START_RUN(REVIEW_ACQUISITION)", async () => {
    const runtime = fakeAcquire();
    render(
      <MemoryRouter>
        <HumanActionArtifact
          artifact={artifact({ path: "WING_READ_ACTION_WINDOW", channelCode: "COUPANG", channelNameKo: "쿠팡", accountId: "acc-cp", to: null, requiresLocalAgent: true })}
          onResume={() => undefined}
          acquireRuntime={runtime}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "지금 쿠팡 리뷰 가져오기" }));
    await waitFor(() => expect(startReviewAcquisitionRun).toHaveBeenCalledWith("acc-cp"));
    await waitFor(() => expect(runtime.starts).toEqual([{ intent: "REVIEW_ACQUISITION", acquisitionRef: "acq-1" }]));
    expect(screen.queryByRole("link", { name: "직접 진행하기" })).toBeNull();
  });

  it("a mint that fails leaves the run unstarted and says so", async () => {
    startReviewAcquisitionRun.mockRejectedValue(new Error("403"));
    const runtime = fakeAcquire();
    render(
      <MemoryRouter>
        <HumanActionArtifact artifact={artifact({ path: "WING_READ_ACTION_WINDOW", channelCode: "COUPANG", channelNameKo: "쿠팡", accountId: "acc-cp", to: null })} onResume={() => undefined} acquireRuntime={runtime} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "지금 쿠팡 리뷰 가져오기" }));
    expect(await screen.findByText(/판매자센터 화면을 준비하지 못했습니다/)).toBeInTheDocument();
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it("several channels ⇒ one card per channel, each with its own primary", () => {
    render(
      <MemoryRouter>
        <HumanActionArtifact artifact={artifact({ artifactId: "h-nv", path: "EXPORT_ACTION_WINDOW", channelCode: "NAVER", channelNameKo: "네이버", accountId: "acc-nv" })} onResume={() => undefined} acquireRuntime={fakeAcquire()} />
        <HumanActionArtifact artifact={artifact({ artifactId: "h-cp", path: "WING_READ_ACTION_WINDOW", channelCode: "COUPANG", channelNameKo: "쿠팡", accountId: "acc-cp" })} onResume={() => undefined} acquireRuntime={fakeAcquire()} />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId("human-action-artifact")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "지금 네이버 리뷰 가져오기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "지금 쿠팡 리뷰 가져오기" })).toBeInTheDocument();
  });
});
