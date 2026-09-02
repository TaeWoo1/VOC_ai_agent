// @vitest-environment jsdom
import { StrictMode } from "react";
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
const listReviewImportPlans = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const selectReviewImportRange = vi.fn(async (..._a: unknown[]) => ({ plan: { id: "plan-1" } }));
const extendReviewImportPlan = vi.fn(async (..._a: unknown[]) => ({ plan: { id: "plan-1" } }));
const launchNextReviewImportSegment = vi.fn(async (..._a: unknown[]) => ({ launchRef: "0f1e2d3c4b5a6978", kind: "SEGMENT" }));
/**
 * Continuity v1 §2: the conversation lane asks for ONE thing — "authorize this account's next review run" —
 * and the server finds or creates the plan, carries it to today and picks the segment. The four-request
 * stitch this replaces is what made the seller meet a plan, a date picker and a merge.
 */
const launchNextReviewImportForAccount = vi.fn(async (..._a: unknown[]) => (
  { launchRef: "0f1e2d3c4b5a6978", kind: "SEGMENT", planId: "plan-1", segmentId: "seg-1" }
));
const getReviewImportPlan = vi.fn(async (..._a: unknown[]) => ({
  plan: { id: "plan-1" },
  segments: [{ id: "seg-1", segmentStart: "2026-08-20", segmentEnd: "2026-09-02", executionState: "PENDING", coverageState: "UNVERIFIED" }],
  nextSegmentId: "seg-1",
}));
const expireReviewImportLaunch = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("../../../lib/apiClient", () => ({
  api: {
    manualSync: (...a: unknown[]) => manualSync(...a),
    startReviewAcquisitionRun: (...a: unknown[]) => startReviewAcquisitionRun(...a),
    listReviewImportPlans: (...a: unknown[]) => listReviewImportPlans(...a),
    selectReviewImportRange: (...a: unknown[]) => selectReviewImportRange(...a),
    extendReviewImportPlan: (...a: unknown[]) => extendReviewImportPlan(...a),
    launchNextReviewImportSegment: (...a: unknown[]) => launchNextReviewImportSegment(...a),
    launchNextReviewImportForAccount: (...a: unknown[]) => launchNextReviewImportForAccount(...a),
    getReviewImportPlan: (...a: unknown[]) => getReviewImportPlan(...a),
    expireReviewImportLaunch: (...a: unknown[]) => expireReviewImportLaunch(...a),
  },
  getToken: () => null,
}));

/** A fake guided-IMPORT runtime (the trusted `import/naver` carrier): records the one START_RUN, publishes snapshots. */
function fakeImport() {
  type Snap = import("../../../lib/actionWindow/import/importRuntime").GuidedImportSnapshot;
  const listeners = new Set<(s: Snap | null) => void>();
  let latest: Snap | null = null;
  const starts: Array<{ launchRef: string; kind: string }> = [];
  const runtime = {
    starts,
    snapshot: () => latest,
    subscribe(l: (s: Snap | null) => void) { listeners.add(l); return () => listeners.delete(l); },
    start: vi.fn(async (input: { launchRef: string; kind: "DISCOVERY" | "SEGMENT" }) => { starts.push(input); }),
    setGuidancePack: vi.fn(),
    subscribeIntent: () => () => undefined,
    subscribeRefusal: () => () => undefined,
    send: vi.fn(),
    resync: () => undefined,
    dispose: vi.fn(),
    publish(s: Snap) { latest = s; listeners.forEach((l) => l(s)); },
  };
  return runtime;
}

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
    expect(screen.getByRole("heading", { name: "카페24 자사몰 리뷰 최신 상태 확인" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "직접 진행하기" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "최신 상태 확인" }));
    await waitFor(() => expect(manualSync).toHaveBeenCalledWith("acc-1", "REVIEW"));
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
  });

  it("ACTION_WINDOW / FILE_UPLOAD: a link to the screen, returning to the home", () => {
    render(<MemoryRouter><HumanActionArtifact artifact={artifact({ path: "ACTION_WINDOW", to: "/connect/channels/acc-1", channelNameKo: "쿠팡" })} onResume={() => undefined} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "최신 상태 확인" })).toBeNull();
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
  it("NAVER export: the seller's press mints a bounded launch and starts ONE run on the trusted import carrier; COMPLETED resumes once", async () => {
    const runtime = fakeImport();
    const onResume = vi.fn();
    render(
      <MemoryRouter>
        <HumanActionArtifact
          artifact={artifact({ path: "EXPORT_ACTION_WINDOW", channelCode: "NAVER", channelNameKo: "네이버", accountId: "acc-nv", to: "/connect/imports", fallback: { path: "FILE_UPLOAD", to: "/connect/upload", label: "파일로 올리기" } })}
          onResume={onResume}
          importRuntime={runtime as never}
        />
      </MemoryRouter>,
    );
    // Compact before the press: title · reason · ONE primary. The guided sentence comes with the run, and
    // so do the escapes — a card with three controls at rest asks the seller to pick a strategy for a step
    // that has one way forward (Chat-first Operating Experience v3; observed live 2026-09-02).
    expect(screen.queryByText(/판매자센터의 리뷰 내려받기 화면과 기간을 준비합니다/)).toBeNull();
    expect(screen.queryByRole("link", { name: "파일로 올리기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "계속 확인하기" })).toBeNull();
    expect(runtime.start).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "최신 상태 확인" }));
    expect(screen.getByText(/판매자센터의 리뷰 내려받기 화면과 기간을 준비합니다/)).toBeInTheDocument();
    // …and now they are there, as what they are: the way out of a step the seller is standing in. Still a
    // text link, never a second primary.
    expect(screen.getByRole("link", { name: "파일로 올리기" })).toHaveAttribute("href", "/connect/upload?returnTo=%2F");
    expect(screen.queryByText(/한 번 클릭/)).toBeNull();
    await waitFor(() => expect(runtime.start).toHaveBeenCalledTimes(1));
    // Acceptance Closure §4: the run is bound to a launch the backend minted for THIS account — the same
    // trusted `import/naver` path onboarding uses — never a v1-clean export nobody can attribute.
    expect(launchNextReviewImportForAccount).toHaveBeenCalledWith("acc-nv");
    // The lane no longer picks a period of its own — that is what put 구간/병합 in a seller's way (§2).
    expect(selectReviewImportRange).not.toHaveBeenCalled();
    expect(extendReviewImportPlan).not.toHaveBeenCalled();
    expect(runtime.starts).toEqual([{ launchRef: "0f1e2d3c4b5a6978", kind: "SEGMENT" }]);
    expect(startReviewAcquisitionRun).not.toHaveBeenCalled();
    expect(expireReviewImportLaunch).not.toHaveBeenCalled();

    act(() => runtime.publish({ runId: "run_1", channelCode: "naver", status: "WAITING_FOR_HUMAN", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", step: { stepNumber: 2, totalSteps: 3, copyKey: "actionWindow.step.userDownload", copyParams: {}, status: "AWAITING_USER" }, blocker: null, allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"], revision: 2 } as never));
    expect(await screen.findByTestId("guided-import-run")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /다시 확인/ }));
    expect(runtime.send).toHaveBeenCalledWith("REQUEST_STEP_RECHECK");
    expect(onResume).not.toHaveBeenCalled();

    act(() => runtime.publish({ runId: "run_1", channelCode: "naver", status: "COMPLETED", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", step: null, blocker: null, allowedCommands: [], revision: 3 } as never));
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
    act(() => runtime.publish({ runId: "run_1", channelCode: "naver", status: "COMPLETED", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", step: null, blocker: null, allowedCommands: [], revision: 4 } as never));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  /**
   * <b>§1 — an instruction is not answered with a button that repeats it.</b>
   *
   * 「네이버 리뷰 최신화해줘」 and 「오늘 리뷰 있어?」 produced the same card, so a seller who had just written
   * the instruction was handed a control asking for it again. `autoStart` is the runtime's deterministic
   * reading of that sentence; the run it starts is the identical guided READ — same carrier, same launch,
   * same seller-performed confirmations in their own window.
   */
  it("autoStart: the sentence WAS the press — the run starts on arrival, with no second control to find", async () => {
    const runtime = fakeImport();
    render(
      <MemoryRouter>
        <HumanActionArtifact
          artifact={artifact({
            path: "EXPORT_ACTION_WINDOW", channelCode: "NAVER", channelNameKo: "네이버",
            accountId: "acc-nv", autoStart: true,
          })}
          onResume={vi.fn()}
          importRuntime={runtime as never}
        />
      </MemoryRouter>,
    );
    await waitFor(() => expect(runtime.start).toHaveBeenCalledTimes(1));
    expect(launchNextReviewImportForAccount).toHaveBeenCalledWith("acc-nv");
    // The button that asked for the instruction a second time is not rendered at all.
    expect(screen.queryByRole("button", { name: "최신 상태 확인" })).toBeNull();
    expect(screen.getByText(/판매자센터의 리뷰 내려받기 화면과 기간을 준비합니다/)).toBeInTheDocument();
  });

  it("without autoStart nothing starts until the seller presses — the default is unchanged", async () => {
    launchNextReviewImportForAccount.mockClear();
    const runtime = fakeImport();
    render(
      <MemoryRouter>
        <HumanActionArtifact
          artifact={artifact({ path: "EXPORT_ACTION_WINDOW", channelCode: "NAVER", channelNameKo: "네이버", accountId: "acc-nv" })}
          onResume={vi.fn()}
          importRuntime={runtime as never}
        />
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(runtime.start).not.toHaveBeenCalled();
    expect(launchNextReviewImportForAccount).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "최신 상태 확인" })).toBeInTheDocument();
  });

  it("NAVER export: a refused start hands the unspent ticket back", async () => {
    const runtime = fakeImport();
    runtime.start.mockRejectedValueOnce(new Error("refused"));
    render(
      <MemoryRouter>
        <HumanActionArtifact
          artifact={artifact({ path: "EXPORT_ACTION_WINDOW", channelCode: "NAVER", channelNameKo: "네이버", accountId: "acc-nv" })}
          onResume={vi.fn()}
          importRuntime={runtime as never}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "최신 상태 확인" }));
    await waitFor(() => expect(expireReviewImportLaunch).toHaveBeenCalledWith("0f1e2d3c4b5a6978"));
    expect(launchNextReviewImportForAccount).toHaveBeenCalledWith("acc-nv");
    expect(await screen.findByRole("status")).toHaveTextContent(/준비하지 못했습니다/);
  });

  /**
   * <b>The 2026-09-02 defect, as a test.</b> — Runtime Closure v2, blocker 2.
   *
   * `React.StrictMode` mounts an effect, tears it down, and mounts it again. The start effect set
   * `startedRef` BEFORE its first `await` and the cleanup never released it, so pass one abandoned itself at
   * `if (!runtime || !live) return;` and pass two was refused by the ref: no ticket was minted, no
   * `START_RUN` was sent, no error appeared, and the card sat there looking ready. `StrictMode` is what the
   * product renders under (`main.tsx`), so this is the product's real mount, not a synthetic one.
   */
  it("StrictMode: a double-invoked mount starts the run exactly once — never zero times", async () => {
    const runtime = fakeImport();
    render(
      <StrictMode>
        <MemoryRouter>
          <HumanActionArtifact
            artifact={artifact({ path: "EXPORT_ACTION_WINDOW", channelCode: "NAVER", channelNameKo: "네이버", accountId: "acc-nv" })}
            onResume={vi.fn()}
            importRuntime={runtime as never}
          />
        </MemoryRouter>
      </StrictMode>,
    );
    await userEvent.click(screen.getByRole("button", { name: "최신 상태 확인" }));
    await waitFor(() => expect(runtime.start).toHaveBeenCalledTimes(1));
    // The mint MAY be attempted more than once here and that is not a defect: it is idempotent by segment —
    // an open `ISSUED` ticket is handed back rather than a second one created, which was verified against the
    // live backend on 2026-09-02. What must be exactly one is the `START_RUN`, and what must never be zero is
    // the run. The teardown of an uncommitted attempt is what allows the second invocation to get there.
    expect(launchNextReviewImportForAccount.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * <b>The 2026-09-02 live sitting's silent screen.</b>
   *
   * The runtime authors no sentence of its own: with no guidance pack `ImportSegmentSession` renders NO
   * in-page panel, so the seller's SmartStore window showed rings on the right controls and nothing that said
   * what to do, why the run had stopped, or how to recover. The onboarding card had always sent the pack;
   * this lane — the one the product is built around — never did, and the log for that sitting carries no
   * `aw_import_guidance_pack` line at all.
   */
  it("sends the in-page guidance pack BEFORE the run starts — otherwise the seller's window is wordless", async () => {
    const runtime = fakeImport();
    render(
      <MemoryRouter>
        <HumanActionArtifact
          artifact={artifact({ path: "EXPORT_ACTION_WINDOW", channelCode: "NAVER", channelNameKo: "네이버", accountId: "acc-nv" })}
          onResume={vi.fn()}
          importRuntime={runtime as never}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "최신 상태 확인" }));
    await waitFor(() => expect(runtime.start).toHaveBeenCalledTimes(1));
    expect(runtime.setGuidancePack).toHaveBeenCalledTimes(1);
    const pack = runtime.setGuidancePack.mock.calls[0]![0] as { chrome?: { product?: string } };
    expect(pack.chrome?.product).toBeTruthy();
    // Order matters: a pack that arrives after the run has already parked leaves the seller reading nothing
    // during the stretch that needed it most.
    expect(runtime.setGuidancePack.mock.invocationCallOrder[0]!).toBeLessThan(
      runtime.start.mock.invocationCallOrder[0]!,
    );
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
    await userEvent.click(screen.getByRole("button", { name: "최신 상태 확인" }));
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
    await userEvent.click(screen.getByRole("button", { name: "최신 상태 확인" }));
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
    expect(screen.getByRole("heading", { name: "네이버 리뷰 최신 상태 확인" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "쿠팡 리뷰 최신 상태 확인" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "최신 상태 확인" })).toHaveLength(2);
  });
});

describe("human action artifact — freshness UX v1: compact, 「언제 기준」, offer vs required", () => {
  const reference = new Date("2026-08-29T03:00:00Z"); // 12:00 KST
  it("a required step names the last observation in one line, and no mechanism word", () => {
    render(<MemoryRouter><HumanActionArtifact artifact={artifact({ path: "WING_READ_ACTION_WINDOW", channelCode: "COUPANG", channelNameKo: "쿠팡", accountId: "acc-cp", asOf: "2026-08-20T01:00:00Z" })} onResume={() => undefined} acquireRuntime={fakeAcquire()} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "쿠팡 리뷰 최신 상태 확인" })).toBeInTheDocument();
    expect(screen.getByText("8월 20일 이후 아직 확인하지 못했어요.")).toBeInTheDocument();
    // ONE control at rest. 「계속 확인하기」 arrives with the run it would resume (v3) — before the press
    // there is no run, and offering to resume nothing is how this card came to hold three buttons.
    expect(screen.getByRole("button", { name: "최신 상태 확인" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "계속 확인하기" })).toBeNull();
    const text = screen.getByTestId("human-action-artifact").textContent ?? "";
    expect(text).not.toMatch(/sync|coverage|SyncJob|수집 확인 안 됨|최신 상태가 아닙니다/i);
    expect(text.length).toBeLessThan(120);
    void reference;
  });
  it("an OFFER is a compact card: 「채널 리뷰 · 언제 기준」, 「최신 상태로 갱신」, no 「계속 확인하기」", async () => {
    const runtime = fakeAcquire();
    render(<MemoryRouter><HumanActionArtifact artifact={artifact({ optional: true, path: "WING_READ_ACTION_WINDOW", channelCode: "COUPANG", channelNameKo: "쿠팡", accountId: "acc-cp", asOf: "2026-08-20T01:00:00Z" })} onResume={() => undefined} acquireRuntime={runtime} /></MemoryRouter>);
    expect(screen.getByTestId("human-action-offer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "쿠팡 리뷰 · 8월 20일 기준" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "계속 확인하기" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "최신 상태로 갱신" }));
    await waitFor(() => expect(runtime.starts).toHaveLength(1));
  });
  it("a channel never observed says so instead of inventing an instant", () => {
    render(<MemoryRouter><HumanActionArtifact artifact={artifact({ path: "FILE_UPLOAD", to: "/connect/upload", channelNameKo: "네이버", reason: "NOT_COLLECTED", asOf: null })} onResume={() => undefined} /></MemoryRouter>);
    expect(screen.getByText("아직 확인한 적이 없어요.")).toBeInTheDocument();
  });
});
