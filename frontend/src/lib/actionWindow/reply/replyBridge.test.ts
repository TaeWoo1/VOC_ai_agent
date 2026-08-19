// The reply-carrier Bridge connection: DEV-only gate, carrier declaration, refusal passthrough, and
// the one handle whose close() releases runtime and socket together.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AwClientFrame, AwServerFrame } from "../contract";
import type { AwBridgeConnectResult, AwBridgeSession, AwWsDeps } from "../wsTransport";
import { connectGuidedReplyRuntime } from "./replyBridge";
import { ReplyRuntimeDisposedError } from "./replyRuntime";

// FILE-SCOPE: bridge mode reads import.meta.env, and a cleanup scoped to one describe leaves the
// stub live for every describe after it.
afterEach(() => {
  vi.unstubAllEnvs();
});

function fakeSession(): {
  session: AwBridgeSession;
  sentFrames: AwClientFrame[];
  emit: (f: AwServerFrame) => void;
  listenerCount: () => number;
  isClosed: () => boolean;
} {
  const listeners = new Set<(frame: AwServerFrame) => void>();
  const sentFrames: AwClientFrame[] = [];
  let closed = false;
  return {
    sentFrames,
    emit: (f) => listeners.forEach((l) => l(f)),
    listenerCount: () => listeners.size,
    isClosed: () => closed,
    session: {
      runId: "run_reply_0001",
      channelCode: "naver",
      transport: {
        send: (f) => sentFrames.push(f),
        subscribe: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
      close: () => {
        closed = true;
      },
    },
  };
}

describe("connectGuidedReplyRuntime", () => {
  /**
   * The `VITE_AW_BRIDGE` gate is GONE, and its absence is the property now asserted.
   *
   * It used to refuse `bridge-disabled` before touching the network in any build that had not opted
   * in — which read as "production keeps the honest manual handoff" and was really "the guided reply
   * path cannot be reached even when an agent is hosting it". Nothing is opened by removing it: the
   * transport matches `expectedCarrier` against the agent's own announcement, the resident helper
   * refuses `reply` by construction, and the only host that announces it is the seated-operator
   * harness with its account / chrome-identity / selector preflights. A build with no agent at all
   * still lands on a transport refusal, which is what the manual handoff is keyed off.
   */
  it("attempts the connection in every build — the DEV-only gate is gone", async () => {
    // Vitest runs DEV=true but WITHOUT VITE_AW_BRIDGE, which was exactly the posture that used to
    // short-circuit. The refusal must now come from the transport, not from a build flag.
    const connectFn = vi.fn<(d: AwWsDeps) => Promise<AwBridgeConnectResult>>()
      .mockResolvedValue({ ok: false, reason: "unreachable" });

    expect(await connectGuidedReplyRuntime({}, connectFn)).toEqual({ ok: false, reason: "unreachable" });
    expect(connectFn).toHaveBeenCalledTimes(1);
    expect(connectFn.mock.calls[0]![0].expectedCarrier).toBe("reply");
  });

  it("declares the REPLY carrier and derives the ws base — the session is born into the v2 world", async () => {
    vi.stubEnv("VITE_AW_BRIDGE", "1");
    let seen: AwWsDeps | null = null;
    const connectFn = async (d: AwWsDeps): Promise<AwBridgeConnectResult> => {
      seen = d;
      return { ok: false, reason: "unreachable" };
    };

    await connectGuidedReplyRuntime({}, connectFn);

    expect(seen).toMatchObject({
      expectedCarrier: "reply",
      httpBase: "http://127.0.0.1:47615",
      wsBase: "ws://127.0.0.1:47615",
    });
  });

  it("passes a refusal through unchanged — an export-hosting agent stays legible", async () => {
    vi.stubEnv("VITE_AW_BRIDGE", "1");
    const connectFn = async (): Promise<AwBridgeConnectResult> => ({
      ok: false,
      reason: "carrier-mismatch",
      announcedCarrier: "export",
    });

    expect(await connectGuidedReplyRuntime({}, connectFn)).toEqual({
      ok: false,
      reason: "carrier-mismatch",
      announcedCarrier: "export",
    });
  });

  it("wires a live session into a runtime that drives real frames — runId from the announcement, never minted", async () => {
    vi.stubEnv("VITE_AW_BRIDGE", "1");
    const fake = fakeSession();
    const result = await connectGuidedReplyRuntime({}, async () => ({ ok: true, session: fake.session }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const pending = result.handle.runtime.start({ channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" });
    const sent = fake.sentFrames[0] as { kind: string; command: { commandId: string; type: string; runId: string } };
    expect(sent.kind).toBe("aw_command");
    expect(sent.command.type).toBe("START_RUN");
    expect(sent.command.runId).toBe("run_reply_0001");
    fake.emit({ kind: "aw_command_result", commandId: sent.command.commandId, accepted: true });

    await expect(pending).resolves.toEqual({ runId: "run_reply_0001" });
  });

  it("close() releases EVERYTHING: in-flight rejected as disposed, zero listeners, socket closed", async () => {
    vi.stubEnv("VITE_AW_BRIDGE", "1");
    const fake = fakeSession();
    const result = await connectGuidedReplyRuntime({}, async () => ({ ok: true, session: fake.session }));
    if (!result.ok) throw new Error("unreachable");
    const pending = result.handle.runtime.start({ channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" });

    result.handle.close();

    // Disposed is an ANSWER — not a timeout against a socket that is already gone.
    await expect(pending).rejects.toBeInstanceOf(ReplyRuntimeDisposedError);
    expect(fake.listenerCount()).toBe(0);
    expect(fake.isClosed()).toBe(true);
  });
});
