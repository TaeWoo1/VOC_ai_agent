// The issuance carrier's attach path. It must ask for the ISSUANCE carrier (an export/reply/import-hosting
// agent must refuse, not half-attach), derive its ws base from the http base, report a refusal rather than
// throw, and pass v2 frames through unchanged. The codec equivalence the v1→v2 transport cast rests on is
// already pinned by importSession.test.ts (same transport, same JSON framing), so it is not re-proven here.
import { describe, expect, it, vi } from "vitest";
import type { AwClientFrame, AwServerFrame } from "../../../../../contracts/action-window/v2/transport";

const connectAwBridgeSession = vi.fn();
vi.mock("../wsTransport", () => ({
  connectAwBridgeSession: (...args: unknown[]) => connectAwBridgeSession(...args),
}));

const { connectIssuanceSession } = await import("./issuanceSession");

/** A v2 START_RUN for an issuance guidance run — the exact frame shape this session has to carry. */
const V2_COMMAND: AwClientFrame = {
  kind: "aw_command",
  command: {
    protocolVersion: 2,
    commandId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    runId: "run_issue01issue01",
    expectedRevision: 1,
    type: "START_RUN",
    payload: { channelCode: "naver", intent: "API_ISSUANCE_GUIDANCE" },
  },
} as AwClientFrame;

/** A v2 issuance view frame with a highlighted step. */
const V2_VIEW: AwServerFrame = {
  kind: "aw_view",
  view: {
    protocolVersion: 2,
    runId: "run_issue01issue01",
    revision: 3,
    channelCode: "naver",
    runCopyKey: "actionWindow.issuance.run",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    intent: "API_ISSUANCE_GUIDANCE",
    currentStep: {
      stepId: "aw.issuance_create_app",
      stepNumber: 2,
      totalSteps: 6,
      copyKey: "actionWindow.issuance.createApp",
      status: "AWAITING_USER",
    },
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
    progress: { completedSteps: 1, totalSteps: 6 },
    updatedAt: "2026-01-01T00:00:00.000003Z",
  },
} as AwServerFrame;

describe("connectIssuanceSession", () => {
  it("asks for the ISSUANCE carrier, so an export/reply/import agent fails closed", async () => {
    connectAwBridgeSession.mockResolvedValue({ ok: false, reason: "carrier-mismatch", announcedCarrier: "import" });
    const result = await connectIssuanceSession();
    expect(connectAwBridgeSession).toHaveBeenCalledWith(expect.objectContaining({ expectedCarrier: "issuance" }));
    expect(result).toEqual({ ok: false, reason: "carrier-mismatch" });
  });

  it("derives the ws base from the http base, so one setting configures both", async () => {
    connectAwBridgeSession.mockResolvedValue({ ok: false, reason: "unpaired" });
    await connectIssuanceSession();
    const calls = connectAwBridgeSession.mock.calls;
    const deps = calls[calls.length - 1]?.[0] as { httpBase: string; wsBase: string };
    expect(deps.wsBase).toBe(deps.httpBase.replace(/^http/, "ws"));
  });

  it.each(["unpaired", "unreachable", "no-announcement", "transport-version-mismatch"] as const)(
    "reports %s rather than throwing",
    async (reason) => {
      connectAwBridgeSession.mockResolvedValue({ ok: false, reason });
      await expect(connectIssuanceSession()).resolves.toEqual({ ok: false, reason });
    },
  );

  it("hands back a v2 transport bound to the announced run and channel", async () => {
    const sent: unknown[] = [];
    const listeners = new Set<(f: unknown) => void>();
    connectAwBridgeSession.mockResolvedValue({
      ok: true,
      session: {
        runId: "run_issue_announce",
        channelCode: "naver",
        transport: {
          send: (f: unknown) => sent.push(f),
          subscribe: (l: (f: unknown) => void) => {
            listeners.add(l);
            return () => listeners.delete(l);
          },
        },
        close: () => {},
      },
    });

    const result = await connectIssuanceSession();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.runId).toBe("run_issue_announce");
    expect(result.session.channelCode).toBe("naver");

    result.session.transport.send(V2_COMMAND);
    expect(sent).toEqual([V2_COMMAND]);
    const received: AwServerFrame[] = [];
    result.session.transport.subscribe((frame) => received.push(frame));
    for (const l of listeners) l(V2_VIEW);
    expect(received).toEqual([V2_VIEW]);
  });
});
