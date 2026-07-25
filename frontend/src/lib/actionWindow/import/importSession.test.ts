// The import carrier's attach path. Two things are worth pinning: that it asks for the IMPORT carrier (an
// export- or reply-hosting agent must refuse, not half-attach), and that the one assumption the v1-typed
// transport rests on — identical framing — is actually true rather than believed.
import { describe, expect, it, vi } from "vitest";
import {
  deserializeFrame as v1Deserialize,
  serializeFrame as v1Serialize,
} from "../../../../../contracts/action-window/v1/transport";
import {
  deserializeFrame as v2Deserialize,
  serializeFrame as v2Serialize,
  type AwClientFrame,
  type AwServerFrame,
} from "../../../../../contracts/action-window/v2/transport";

const connectAwBridgeSession = vi.fn();
vi.mock("../wsTransport", () => ({
  connectAwBridgeSession: (...args: unknown[]) => connectAwBridgeSession(...args),
}));

const { connectImportSession } = await import("./importSession");

/** A v2 START_RUN for a segment import — the exact frame shape this session has to carry. */
const V2_COMMAND: AwClientFrame = {
  kind: "aw_command",
  command: {
    protocolVersion: 2,
    commandId: "11111111-2222-3333-4444-555555555555",
    runId: "run_abc123abc123",
    expectedRevision: 4,
    type: "START_RUN",
    payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: "0f1e2d3c4b5a6978" },
  },
};

/** A v2 view frame, including the fields v1 has no notion of (`intent`, a v2-only blocker code). */
const V2_VIEW: AwServerFrame = {
  kind: "aw_view",
  view: {
    protocolVersion: 2,
    runId: "run_abc123abc123",
    revision: 7,
    channelCode: "naver",
    runCopyKey: "actionWindow.run.naverInitialReviewImportSegment",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    intent: "INITIAL_REVIEW_IMPORT_SEGMENT",
    currentStep: {
      stepId: "aw.import_set_start_date",
      stepNumber: 3,
      totalSteps: 8,
      copyKey: "actionWindow.import.setStartDate",
      copyParams: { targetKind: "start_date", requiredStart: "2026-06-01", requiredEnd: "2026-06-30" },
      status: "AWAITING_USER",
    },
    blocker: { code: "SCOPE_MISMATCH", recoverable: true },
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
    progress: { completedSteps: 2, totalSteps: 8 },
    updatedAt: "2026-01-01T00:00:00.000009Z",
  },
} as AwServerFrame;

/**
 * The claim the whole module rests on: the transport can carry v2 payloads because the two contracts frame
 * them identically. Asserted rather than assumed — if the codecs ever diverge, this fails here instead of on a
 * live socket, where the symptom would be a dormant session.
 */
describe("v1 and v2 framing are byte-identical", () => {
  it("round-trips a v2 client frame through the v1 codec without loss", () => {
    expect(v1Serialize(V2_COMMAND as never)).toBe(v2Serialize(V2_COMMAND));
    expect(v2Deserialize(v1Serialize(V2_COMMAND as never))).toEqual(V2_COMMAND);
  });

  it("round-trips a v2 server frame — including v2-only fields — through the v1 codec", () => {
    expect(v1Serialize(V2_VIEW as never)).toBe(v2Serialize(V2_VIEW));
    expect(v1Deserialize(v2Serialize(V2_VIEW))).toEqual(V2_VIEW);
  });
});

describe("connectImportSession", () => {
  it("asks for the IMPORT carrier, so an export or reply agent fails closed", async () => {
    connectAwBridgeSession.mockResolvedValue({ ok: false, reason: "carrier-mismatch", announcedCarrier: "reply" });
    const result = await connectImportSession();

    expect(connectAwBridgeSession).toHaveBeenCalledWith(
      expect.objectContaining({ expectedCarrier: "import" }),
    );
    expect(result).toEqual({ ok: false, reason: "carrier-mismatch" });
  });

  it("derives the ws base from the http base, so one setting configures both", async () => {
    connectAwBridgeSession.mockResolvedValue({ ok: false, reason: "unpaired" });
    await connectImportSession();
    const calls = connectAwBridgeSession.mock.calls;
    const deps = calls[calls.length - 1]?.[0] as { httpBase: string; wsBase: string };
    expect(deps.wsBase).toBe(deps.httpBase.replace(/^http/, "ws"));
  });

  /** A refusal is a reported fact, never a throw: the card turns each cause into its own fix. */
  it.each(["unpaired", "unreachable", "no-announcement", "transport-version-mismatch"] as const)(
    "reports %s rather than throwing",
    async (reason) => {
      connectAwBridgeSession.mockResolvedValue({ ok: false, reason });
      await expect(connectImportSession()).resolves.toEqual({ ok: false, reason });
    },
  );

  it("hands back a v2 transport bound to the announced run and channel", async () => {
    const sent: unknown[] = [];
    const listeners = new Set<(f: unknown) => void>();
    connectAwBridgeSession.mockResolvedValue({
      ok: true,
      session: {
        runId: "run_announce01",
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

    const result = await connectImportSession();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.runId).toBe("run_announce01");
    expect(result.session.channelCode).toBe("naver");

    // v2 frames pass through unchanged in both directions.
    result.session.transport.send(V2_COMMAND);
    expect(sent).toEqual([V2_COMMAND]);
    const received: AwServerFrame[] = [];
    result.session.transport.subscribe((frame) => received.push(frame));
    for (const l of listeners) l(V2_VIEW);
    expect(received).toEqual([V2_VIEW]);
  });
});
