// @vitest-environment jsdom
// The hook's job is lifecycle: attach once (resync → START_RUN once), hold the session for the walk, release the
// socket on a terminal run and on unmount. It drives the REAL runtime over a fake transport, so the exactly-once
// START_RUN and the refresh-safe reattach are proven end to end, not just at the runtime seam.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useGuidedIssuance } from "./useGuidedIssuance";
import type {
  AwClientFrame,
  AwServerFrame,
  AwClientTransport,
} from "../../../../../contracts/action-window/v2/transport";
import type { ActionWindowRunView } from "../../../../../contracts/action-window/v2/index";

const connectIssuanceSession = vi.fn();
vi.mock("./issuanceSession", () => ({
  connectIssuanceSession: (...args: unknown[]) => connectIssuanceSession(...args),
}));

function fakeTransport() {
  const sent: AwClientFrame[] = [];
  let listener: ((f: AwServerFrame) => void) | null = null;
  const transport: AwClientTransport = {
    send: (f) => sent.push(f),
    subscribe: (l) => {
      listener = l;
      return () => {
        if (listener === l) listener = null;
      };
    },
  };
  return { transport, sent, emit: (f: AwServerFrame) => listener?.(f) };
}

function hostedView(over: Partial<ActionWindowRunView> = {}): ActionWindowRunView {
  return {
    protocolVersion: 2,
    runId: "run_live01",
    revision: 2,
    channelCode: "naver",
    runCopyKey: "actionWindow.issuance.run",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    intent: "API_ISSUANCE_GUIDANCE",
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
    progress: { completedSteps: 1, totalSteps: 5 },
    updatedAt: "2026-01-01T00:00:00.000002Z",
    ...over,
  };
}

const startRuns = (sent: AwClientFrame[]) =>
  sent.filter((f): f is Extract<AwClientFrame, { kind: "aw_command" }> => f.kind === "aw_command" && f.command.type === "START_RUN");

afterEach(() => {
  vi.restoreAllMocks();
  connectIssuanceSession.mockReset();
});

describe("useGuidedIssuance", () => {
  it("does nothing until attach() is called (no socket on mount)", () => {
    renderHook(() => useGuidedIssuance());
    expect(connectIssuanceSession).not.toHaveBeenCalled();
  });

  it("attach → resync then exactly one START_RUN when the agent is idle", async () => {
    const t = fakeTransport();
    const close = vi.fn();
    connectIssuanceSession.mockResolvedValue({
      ok: true,
      session: { transport: t.transport, runId: "run_seed", channelCode: "naver", close },
    });
    const { result } = renderHook(() => useGuidedIssuance());

    await act(async () => {
      await result.current.attach();
    });
    // Idle → resync sent, then one START_RUN once the idle result lands.
    expect(t.sent.some((f) => f.kind === "aw_resync")).toBe(true);
    act(() => t.emit({ kind: "aw_resync_result", view: null, events: [] }));
    expect(startRuns(t.sent).length).toBe(1);
    expect(connectIssuanceSession).toHaveBeenCalledTimes(1);
  });

  it("a second attach opens no second socket and starts no second run", async () => {
    const t = fakeTransport();
    connectIssuanceSession.mockResolvedValue({
      ok: true,
      session: { transport: t.transport, runId: "run_seed", channelCode: "naver", close: () => {} },
    });
    const { result } = renderHook(() => useGuidedIssuance());
    await act(async () => {
      await result.current.attach();
    });
    act(() => t.emit({ kind: "aw_resync_result", view: null, events: [] }));
    await act(async () => {
      await result.current.attach(); // idempotent
    });
    expect(connectIssuanceSession).toHaveBeenCalledTimes(1);
    expect(startRuns(t.sent).length).toBe(1);
  });

  it("reattaches to a run already hosted without a second START_RUN (page-refresh safe)", async () => {
    const t = fakeTransport();
    connectIssuanceSession.mockResolvedValue({
      ok: true,
      session: { transport: t.transport, runId: "run_seed", channelCode: "naver", close: () => {} },
    });
    const { result } = renderHook(() => useGuidedIssuance());
    await act(async () => {
      await result.current.attach();
    });
    act(() => t.emit({ kind: "aw_resync_result", view: hostedView(), events: [] }));
    expect(startRuns(t.sent).length).toBe(0);
    expect(result.current.view?.runId).toBe("run_live01");
  });

  it("published views drive the hook's view; commands are gated by the view", async () => {
    const t = fakeTransport();
    connectIssuanceSession.mockResolvedValue({
      ok: true,
      session: { transport: t.transport, runId: "run_seed", channelCode: "naver", close: () => {} },
    });
    const { result } = renderHook(() => useGuidedIssuance());
    await act(async () => {
      await result.current.attach();
    });
    act(() => t.emit({ kind: "aw_view", view: hostedView({ allowedCommands: ["REQUEST_STEP_RECHECK"] }) }));
    expect(result.current.view?.status).toBe("WAITING_FOR_HUMAN");

    const before = t.sent.filter((f) => f.kind === "aw_command").length;
    act(() => result.current.send("CANCEL_RUN")); // not allowed
    act(() => result.current.send("REQUEST_STEP_RECHECK")); // allowed
    const after = t.sent.filter((f) => f.kind === "aw_command").length;
    expect(after - before).toBe(1);
  });

  it("surfaces a transport refusal as unavailable", async () => {
    connectIssuanceSession.mockResolvedValue({ ok: false, reason: "carrier-mismatch" });
    const { result } = renderHook(() => useGuidedIssuance());
    await act(async () => {
      await result.current.attach();
    });
    expect(result.current.unavailable).toBe("carrier-mismatch");
  });

  it("releases the socket on a terminal run but keeps the last view (for the completion CTA)", async () => {
    const t = fakeTransport();
    const close = vi.fn();
    connectIssuanceSession.mockResolvedValue({
      ok: true,
      session: { transport: t.transport, runId: "run_seed", channelCode: "naver", close },
    });
    const { result } = renderHook(() => useGuidedIssuance());
    await act(async () => {
      await result.current.attach();
    });
    act(() => t.emit({ kind: "aw_view", view: hostedView({ status: "COMPLETED", allowedCommands: [] }) }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(result.current.view?.status).toBe("COMPLETED"); // retained for the CTA
  });

  it("closes the session on unmount", async () => {
    const t = fakeTransport();
    const close = vi.fn();
    connectIssuanceSession.mockResolvedValue({
      ok: true,
      session: { transport: t.transport, runId: "run_seed", channelCode: "naver", close },
    });
    const { result, unmount } = renderHook(() => useGuidedIssuance());
    await act(async () => {
      await result.current.attach();
    });
    unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
