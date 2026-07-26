// @vitest-environment jsdom
// The hook's job is lifecycle: attach once, hold the session for the whole sitting, release exactly what it
// created. Each of those, wrong, costs the seller either a socket per press or a card that stops updating.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { availabilityFromRefusal, useGuidedImport } from "./useGuidedImport";
import type { GuidedImportRuntime, GuidedImportSnapshot } from "./importRuntime";
import type { AwGuidanceIntent } from "../../../../../contracts/action-window/v2/transport";

const connectImportSession = vi.fn();
vi.mock("./importSession", () => ({
  connectImportSession: (...args: unknown[]) => connectImportSession(...args),
}));

function stubRuntime() {
  const listeners = new Set<(s: GuidedImportSnapshot | null) => void>();
  const intentListeners = new Set<(intent: AwGuidanceIntent) => void>();
  let disposed = false;
  let resynced = 0;
  const runtime: GuidedImportRuntime = {
    snapshot: () => null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeIntent(listener) {
      intentListeners.add(listener);
      return () => intentListeners.delete(listener);
    },
    start: async () => {},
    setGuidancePack: () => {},
    send: () => {},
    resync: () => {
      resynced += 1;
    },
    dispose: () => {
      disposed = true;
    },
  };
  return {
    runtime,
    listenerCount: () => listeners.size,
    intentListenerCount: () => intentListeners.size,
    pressPanel: (intent: AwGuidanceIntent) => {
      for (const l of [...intentListeners]) l(intent);
    },
    isDisposed: () => disposed,
    resyncCount: () => resynced,
    publish: (s: GuidedImportSnapshot | null) => {
      for (const l of [...listeners]) l(s);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  connectImportSession.mockReset();
});

describe("availabilityFromRefusal", () => {
  /** The state that made a working agent look broken: it is running, just hosting a different job. */
  it("reports a carrier mismatch as its own state, not as offline", () => {
    expect(availabilityFromRefusal("carrier-mismatch")).toBe("wrong_carrier");
  });

  it.each([
    ["unpaired", "unpaired"],
    ["ticket-rejected", "unpaired"],
    ["transport-version-mismatch", "incompatible"],
    ["unreachable", "not_running"],
    ["no-announcement", "not_running"],
    ["bridge-disabled", "not_running"],
  ] as const)("maps %s to %s", (reason, expected) => {
    expect(availabilityFromRefusal(reason)).toBe(expected);
  });
});

describe("useGuidedImport", () => {
  it("attaches once and reuses the session across the sitting", async () => {
    const stub = stubRuntime();
    connectImportSession.mockResolvedValue({
      ok: true,
      session: { transport: { send: () => {}, subscribe: () => () => {} }, runId: "run_a", channelCode: "naver", close: () => {} },
    });
    const { result } = renderHook(() => useGuidedImport(stub.runtime));

    let first: unknown;
    let second: unknown;
    await act(async () => {
      first = await result.current.ensureRuntime();
      second = await result.current.ensureRuntime();
    });
    expect(first).toBe(stub.runtime);
    expect(second).toBe(stub.runtime);
    // Injected: no socket was opened at all.
    expect(connectImportSession).not.toHaveBeenCalled();
  });

  it("mirrors what the runtime publishes", async () => {
    const stub = stubRuntime();
    const { result } = renderHook(() => useGuidedImport(stub.runtime));
    expect(result.current.snapshot).toBeNull();

    act(() => {
      stub.publish({
        runId: "run_a",
        status: "WAITING_FOR_HUMAN",
        intent: "INITIAL_REVIEW_IMPORT_DISCOVERY",
        step: null,
        blocker: null,
        allowedCommands: [],
        revision: 2,
      });
    });
    expect(result.current.snapshot?.status).toBe("WAITING_FOR_HUMAN");
  });

  it("reports a refusal as an availability the card can explain, and hands back no runtime", async () => {
    connectImportSession.mockResolvedValue({ ok: false, reason: "carrier-mismatch" });
    const { result } = renderHook(() => useGuidedImport());

    let runtime: unknown = "unset";
    await act(async () => {
      runtime = await result.current.ensureRuntime();
    });
    expect(runtime).toBeNull();
    expect(result.current.unavailable).toBe("wrong_carrier");
  });

  /** Two fast presses must not open two sockets to one agent — the second announcement would orphan the first. */
  it("collapses concurrent attach attempts into one connection", async () => {
    let release: (v: unknown) => void = () => {};
    connectImportSession.mockReturnValue(new Promise((r) => (release = r)));
    const { result } = renderHook(() => useGuidedImport());

    await act(async () => {
      void result.current.ensureRuntime();
      void result.current.ensureRuntime();
      release({ ok: false, reason: "unreachable" });
    });
    expect(connectImportSession).toHaveBeenCalledTimes(1);
  });

  it("releases only what it created — an injected runtime belongs to its owner", async () => {
    const stub = stubRuntime();
    const { unmount } = renderHook(() => useGuidedImport(stub.runtime));
    expect(stub.listenerCount()).toBe(1);

    unmount();
    expect(stub.listenerCount()).toBe(0);
    expect(stub.isDisposed()).toBe(false);
  });

  it("closes a session it opened when the card unmounts", async () => {
    const close = vi.fn();
    connectImportSession.mockResolvedValue({
      ok: true,
      session: { transport: { send: () => {}, subscribe: () => () => {} }, runId: "run_a", channelCode: "naver", close },
    });
    const { result, unmount } = renderHook(() => useGuidedImport());
    await act(async () => {
      await result.current.ensureRuntime();
    });

    unmount();
    expect(close).toHaveBeenCalled();
  });

  /** A page refreshed mid-run must recover the guided view rather than show a fresh card over a live run. */
  it("resyncs as soon as it attaches", async () => {
    const transport = { send: vi.fn(), subscribe: () => () => {} };
    connectImportSession.mockResolvedValue({
      ok: true,
      session: { transport, runId: "run_a", channelCode: "naver", close: () => {} },
    });
    const { result } = renderHook(() => useGuidedImport());
    await act(async () => {
      await result.current.ensureRuntime();
    });
    expect(transport.send).toHaveBeenCalledWith({ kind: "aw_resync", runId: "run_a", sinceSequence: 0 });
  });

  it("closes a session that arrives after unmount instead of leaking it", async () => {
    const close = vi.fn();
    let release: (v: unknown) => void = () => {};
    connectImportSession.mockReturnValue(new Promise((r) => (release = r)));
    const { result, unmount } = renderHook(() => useGuidedImport());

    const pending = result.current.ensureRuntime();
    unmount();
    await act(async () => {
      release({
        ok: true,
        session: { transport: { send: () => {}, subscribe: () => () => {} }, runId: "run_a", channelCode: "naver", close },
      });
      await pending;
    });
    expect(close).toHaveBeenCalled();
  });
});

/**
 * The in-page panel's presses reach the caller through here, and the two hazards are lifecycle ones — which is
 * why they belong to the hook rather than to the runtime.
 */
describe("useGuidedImport — presses from the marketplace panel", () => {
  it("delivers an intent to the current callback, not the one the runtime was adopted with", () => {
    const stub = stubRuntime();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: (i: AwGuidanceIntent) => void }) => useGuidedImport(stub.runtime, cb), {
      initialProps: { cb: first },
    });

    // A component that re-renders with a fresh closure every time — which is every component — must not end up
    // with a listener that still points at the first one. That would make the panel's continue button work once.
    rerender({ cb: second });
    act(() => stub.pressPanel("CONTINUE_NEXT_SEGMENT"));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("CONTINUE_NEXT_SEGMENT");
    // One subscription, not one per render.
    expect(stub.intentListenerCount()).toBe(1);
  });

  it("stops delivering after unmount", () => {
    const stub = stubRuntime();
    const onIntent = vi.fn();
    const { unmount } = renderHook(() => useGuidedImport(stub.runtime, onIntent));
    unmount();
    act(() => stub.pressPanel("CONTINUE_NEXT_SEGMENT"));
    expect(onIntent).not.toHaveBeenCalled();
    expect(stub.intentListenerCount()).toBe(0);
  });
});
