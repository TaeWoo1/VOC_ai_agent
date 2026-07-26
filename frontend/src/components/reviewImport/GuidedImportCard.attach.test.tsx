// @vitest-environment jsdom
/**
 * **A card that loads over a live run must pick it up.**
 *
 * The runtime always knew how to: `ensureRuntime` resyncs the moment it attaches. Nothing called it except the CTA,
 * so a page LOAD during a run built a fresh card — no step, no blocker, no `다시 확인`.
 *
 * Measured live on 2026-07-26. A run was parked on a recoverable `LOGIN_REQUIRED`. The operator logged into NAVER
 * as the run asked, came back to SellerOps, and found a card offering to START something instead of the control
 * that would have resumed what was already running. Pressing the CTA again could not help: the ticket is idempotent
 * and the agent ignores a replayed `START_RUN` for the run it already hosts, so the press did nothing.
 *
 * The socket is stubbed at the module boundary, so these assert WHEN an attach is attempted — no bridge, no agent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AwServerFrame } from "../../../../contracts/action-window/v2/transport";
import type { ReviewImportPlanDetailView, ReviewImportSegmentView, SellerAccountResponse } from "../../lib/types";

const connectImportSession = vi.fn();
vi.mock("../../lib/actionWindow/import/importSession", () => ({
  connectImportSession: (...args: unknown[]) => connectImportSession(...args),
}));

const { GuidedImportCard } = await import("./GuidedImportCard");
const { api } = await import("../../lib/apiClient");

const account: SellerAccountResponse = {
  id: "acc-1",
  channelId: "chan-1",
  channelNameKo: "네이버 스마트스토어",
  alias: "내 스토어",
  connectionStatus: "CONNECTED",
  lastSyncedAt: null,
  fileUpload: true,
};

const segment: ReviewImportSegmentView = {
  id: "s1",
  ordinal: 0,
  segmentStart: "2026-07-01",
  segmentEnd: "2026-07-26",
  executionState: "PENDING",
  coverageState: "UNVERIFIED",
  coveredRows: null,
  rowsReconciled: false,
  superseded: false,
  parentSegmentId: null,
};

const plan: ReviewImportPlanDetailView = {
  plan: {
    id: "plan-1",
    sellerAccountId: account.id,
    channelId: account.channelId,
    requestedStart: "2026-06-01",
    requestedEnd: "2026-07-26",
    status: "ACTIVE",
    createdAt: "2026-07-26T00:00:00Z",
  } as ReviewImportPlanDetailView["plan"],
  segments: [segment],
  coverage: {
    covered: [],
    missing: [],
    remaining: [],
    lastCoveredDate: null,
    coveredRows: 0,
    coveredSegments: 0,
    remainingSegments: 1,
    missingSegments: 0,
  },
};

/**
 * A session whose resync answers with a live, BLOCKED run — the state the live agent was actually parked in.
 * Returned as the frame the runtime subscribes to, so the card renders from a real view rather than a stub object.
 */
function blockedSession() {
  const listeners = new Set<(frame: AwServerFrame) => void>();
  const sent: unknown[] = [];
  const view = {
    protocolVersion: 2,
    runId: "run_live0000001",
    revision: 7,
    channelCode: "naver",
    runCopyKey: "actionWindow.run.naverInitialReviewImportSegment",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    intent: "INITIAL_REVIEW_IMPORT_SEGMENT",
    currentStep: {
      stepId: "aw.import_open_surface",
      stepNumber: 1,
      totalSteps: 8,
      copyKey: "actionWindow.import.openReviewSurface",
      copyParams: {},
      status: "AWAITING_USER",
    },
    blocker: { code: "LOGIN_REQUIRED", recoverable: true },
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
    progress: { completedSteps: 0, totalSteps: 8 },
    updatedAt: "2026-07-26T06:02:16.000001Z",
  };
  return {
    ok: true as const,
    session: {
      runId: "run_live0000001",
      channelCode: "naver",
      close: vi.fn(),
      transport: {
        send: (frame: unknown) => {
          sent.push(frame);
          // The agent answers a resync with the run it is hosting — which is the whole point of attaching.
          if ((frame as { kind?: string }).kind === "aw_resync") {
            for (const l of [...listeners]) l({ kind: "aw_resync_result", view, events: [] } as AwServerFrame);
          }
        },
        subscribe: (l: (frame: AwServerFrame) => void) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
    },
    sent,
  };
}

beforeEach(() => {
  connectImportSession.mockReset();
  vi.spyOn(api, "getReviewImportPlan").mockRejectedValue(new Error("not stubbed"));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GuidedImportCard — recovering a run that is already in flight", () => {
  it("attaches on mount, without waiting for the seller to press anything", async () => {
    connectImportSession.mockResolvedValue(blockedSession());

    await act(async () => {
      render(<GuidedImportCard account={account} plan={plan} agent="ready" />);
    });

    await waitFor(() => expect(connectImportSession).toHaveBeenCalledTimes(1));
  });

  /** The regression, in the state the live run was actually in: the blocker and its repair must be on screen. */
  it("shows the live run's blocker and its recovery control after a page load", async () => {
    connectImportSession.mockResolvedValue(blockedSession());

    await act(async () => {
      render(<GuidedImportCard account={account} plan={plan} agent="ready" />);
    });

    await waitFor(() => expect(screen.getByTestId("guided-run-blocker")).toBeInTheDocument());
    expect(screen.getByTestId("guided-command-REQUEST_STEP_RECHECK")).toBeInTheDocument();
    // And it does NOT offer to start a second run over the one already going.
    expect(screen.queryByTestId("guided-import-cta")).toBeNull();
  });

  /** No helper reachable ⇒ no socket. The status channel already explains that case on the card. */
  it("does not attach when the agent is not available", async () => {
    await act(async () => {
      render(<GuidedImportCard account={account} plan={plan} agent="not_running" />);
    });
    expect(connectImportSession).not.toHaveBeenCalled();
  });

  it("attaches once, not once per render", async () => {
    connectImportSession.mockResolvedValue(blockedSession());
    let rerender: (ui: React.ReactElement) => void = () => {};
    await act(async () => {
      ({ rerender } = render(<GuidedImportCard account={account} plan={plan} agent="ready" />));
    });
    await waitFor(() => expect(connectImportSession).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(<GuidedImportCard account={account} plan={plan} agent="ready" />);
    });
    expect(connectImportSession).toHaveBeenCalledTimes(1);
  });

  /** With nothing hosted, attaching must leave the card exactly as it was — an offer to start. */
  it("still offers to start when the agent is hosting nothing", async () => {
    const idle = blockedSession();
    idle.session.transport.send = (frame: unknown) => {
      if ((frame as { kind?: string }).kind === "aw_resync") {
        // An idle agent answers with no view at all.
      }
      void frame;
    };
    connectImportSession.mockResolvedValue(idle);

    await act(async () => {
      render(<GuidedImportCard account={account} plan={plan} agent="ready" />);
    });

    await waitFor(() => expect(connectImportSession).toHaveBeenCalled());
    expect(screen.getByTestId("guided-import-cta")).toBeInTheDocument();
    expect(screen.queryByTestId("guided-run-blocker")).toBeNull();
  });
});
