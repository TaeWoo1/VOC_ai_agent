// @vitest-environment jsdom
// The runtime's owner: what the hook resolves, and — the disposal contract's last item — that it
// releases on unmount exactly what it created, and nothing it was handed.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuidedReplyConnectResult } from "./replyBridge";
import { ReplyRuntimeDisposedError, type ReplyRuntime } from "./replyRuntime";
import { useReplyRuntime } from "./useReplyRuntime";

// FILE-SCOPE: resolveReplyRuntime reads import.meta.env.DEV, and a cleanup scoped to one describe
// leaves the stub live for every describe after it.
afterEach(() => {
  vi.unstubAllEnvs();
});
beforeEach(() => {
  // The simulated fallback is developer chrome (A6): DEV AND the fixture-preview opt-in.
  vi.stubEnv("VITE_AW_FIXTURE_PREVIEW", "1");
});

function stubRuntime(): ReplyRuntime & { disposed: boolean } {
  const r = {
    disposed: false,
    start: () => Promise.resolve({ runId: "run_stub000001" }),
    report: (): Promise<never> => Promise.reject(new Error("not driven in this test")),
    dispose() {
      r.disposed = true;
    },
  };
  return r;
}

const refuse = async (): Promise<GuidedReplyConnectResult> => ({ ok: false, reason: "bridge-disabled" });

describe("useReplyRuntime", () => {
  it("passes an INJECTED runtime through untouched — its creator owns its lifecycle", async () => {
    const injected = stubRuntime();
    const connector = vi.fn(refuse);
    const { result, unmount } = renderHook(() => useReplyRuntime(injected, connector));

    expect(result.current).toBe(injected);
    unmount();

    // Never connected on its behalf, never disposed on its behalf.
    expect(connector).not.toHaveBeenCalled();
    expect(injected.disposed).toBe(false);
  });

  it("offers the DEV fallback immediately and keeps it through a refusal — never blocked on a round-trip", async () => {
    const connector = vi.fn(refuse);
    const { result } = renderHook(() => useReplyRuntime(undefined, connector));

    expect(result.current).not.toBeNull(); // the simulated runtime, synchronously
    await act(async () => {}); // let the refusal resolve
    expect(connector).toHaveBeenCalledTimes(1);
    expect(result.current).not.toBeNull(); // still the fallback — the honest-fallback rule
  });

  it("DISPOSES the fallback it created on unmount", async () => {
    const { result, unmount } = renderHook(() => useReplyRuntime(undefined, refuse));
    const fallback = result.current!;
    await act(async () => {});

    unmount();

    await expect(fallback.report("run_x", "SUBMISSION_ABORTED")).rejects.toBeInstanceOf(ReplyRuntimeDisposedError);
  });

  it("adopts the BRIDGE runtime once connected, and closes the whole handle on unmount", async () => {
    const bridgeRuntime = stubRuntime();
    let closes = 0;
    const connector = async (): Promise<GuidedReplyConnectResult> => ({
      ok: true,
      handle: {
        runtime: bridgeRuntime,
        close: () => {
          closes += 1;
          bridgeRuntime.dispose();
        },
      },
    });
    const { result, unmount } = renderHook(() => useReplyRuntime(undefined, connector));
    await waitFor(() => expect(result.current).toBe(bridgeRuntime));

    unmount();

    expect(closes).toBe(1);
    expect(bridgeRuntime.disposed).toBe(true);
  });

  it("closes a session that resolves AFTER unmount — a socket whose owner is gone is not kept", async () => {
    let resolveConnect!: (r: GuidedReplyConnectResult) => void;
    const connector = (): Promise<GuidedReplyConnectResult> =>
      new Promise<GuidedReplyConnectResult>((r) => {
        resolveConnect = r;
      });
    const { unmount } = renderHook(() => useReplyRuntime(undefined, connector));
    unmount();

    let closes = 0;
    resolveConnect({ ok: true, handle: { runtime: stubRuntime(), close: () => (closes += 1) } });

    await waitFor(() => expect(closes).toBe(1));
  });

  it("resolves NULL in a production posture — nothing to guide, nothing simulated", async () => {
    vi.stubEnv("DEV", false);
    const { result } = renderHook(() => useReplyRuntime(undefined, refuse));
    await act(async () => {});

    expect(result.current).toBeNull();
  });
});
