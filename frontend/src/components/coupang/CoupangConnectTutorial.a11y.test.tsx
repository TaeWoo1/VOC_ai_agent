// @vitest-environment jsdom
// Automated axe-core a11y scans of the Coupang first-connection tutorial across its rendered phases, plus
// the agent-driven WING issuance walkthrough states. The tutorial is CONTROLLED and offline (no api); the
// walkthrough renders from a fixture run view with the bridge (useBridge) mocked inert.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { expectNoAxeViolations } from "../../test/axe";
import type { CoupangState } from "../../lib/coupangTutorial";
import type { ConnectionStatusView, CredentialTemplateView } from "../../lib/types";
import type { BridgeState } from "../../lib/bridge/bridgeClient";
import type { ActionWindowRunView } from "../../lib/actionWindow/contract";

vi.mock("../../hooks/useBridge", () => ({
  useBridge: () => ({
    state: { phase: "paired", maybeNeedsLocalNetworkAccess: false } as BridgeState,
    requestPairing: vi.fn(),
    revoke: vi.fn(),
    retry: vi.fn(),
  }),
}));

import { CoupangConnectTutorial } from "./CoupangConnectTutorial";
import { CoupangIssuanceGuidedWalkthrough } from "./CoupangIssuanceGuidedWalkthrough";

const TEMPLATE: CredentialTemplateView = {
  channelCode: "COUPANG",
  connectorClass: "API",
  authType: "HMAC",
  fields: [
    { key: "access_key", label: "액세스 키", required: true, secret: false, helpText: "" },
    { key: "secret_key", label: "시크릿 키", required: true, secret: true, helpText: "" },
    { key: "vendor_id", label: "업체 코드", required: true, secret: false, helpText: "" },
  ],
  notes: "",
};

const HEALTH: ConnectionStatusView = {
  sellerAccountId: "acc-1",
  state: "CONNECTED",
  lastSuccessAt: "2026-08-06T00:01:00Z",
  consecutiveFailures: 0,
  lastError: null,
  lastSyncedAt: "2026-08-06T00:01:00Z",
  nextScheduledAt: null,
};

function renderPhase(state: CoupangState, extra?: Partial<Parameters<typeof CoupangConnectTutorial>[0]>) {
  return render(
    <CoupangConnectTutorial
      state={state}
      template={TEMPLATE}
      busy={false}
      advertisedEgressIps={["203.0.113.20"]}
      connectionStatus={state.phase === "connected" ? HEALTH : null}
      syncProgress={state.phase === "syncing" ? { elapsedMs: 42_000, stalled: false } : null}
      onSubmitCredentials={() => {}}
      onRetest={() => {}}
      onReenter={() => {}}
      onRunSync={() => {}}
      onRecheckSync={() => {}}
      onGoToOrders={() => {}}
      onViewChannelRuns={() => {}}
      {...extra}
    />,
  );
}

describe("CoupangConnectTutorial — axe a11y scans", () => {
  it("connect stage (prereqs + credential form) has no violations", async () => {
    const { container } = renderPhase({ phase: "connect", reasonCode: null });
    await expectNoAxeViolations(container);
  });

  it("submitting (the waiting screen) has no violations, reads as IN PROGRESS, and carries the current stage", async () => {
    const { container, rerender } = renderPhase({ phase: "submitting", reasonCode: null }, { submitStage: "storing" });
    const status = screen.getByTestId("coupang-verifying");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent("연결 정보를 저장하고 있어요");
    expect(within(status).getByTestId("spinner")).toBeInTheDocument();
    // Nothing on the waiting screen reads as a failure, and the form is gone (no second submit).
    expect(screen.queryByRole("alert")).toBeNull();
    expect(status).not.toHaveTextContent(/실패|오류|못했/);
    expect(screen.queryByRole("button", { name: "연결 정보 저장" })).toBeNull();
    await expectNoAxeViolations(container);
    rerender(
      <CoupangConnectTutorial
        state={{ phase: "submitting", reasonCode: null }}
        template={TEMPLATE}
        busy
        submitStage="verifying"
        advertisedEgressIps={[]}
        connectionStatus={null}
        syncProgress={null}
        onSubmitCredentials={() => {}}
        onRetest={() => {}}
        onReenter={() => {}}
        onRunSync={() => {}}
        onRecheckSync={() => {}}
        onGoToOrders={() => {}}
        onViewChannelRuns={() => {}}
      />,
    );
    expect(screen.getByTestId("coupang-verifying")).toHaveTextContent("쿠팡에 연결을 확인하고 있어요");
    expect(screen.getByTestId("coupang-verifying")).toHaveTextContent("✓ 연결 정보 저장");
  });

  it("the three async faces are visually distinct: in-progress (brand), error (bad/alert), success (good/status)", () => {
    const a = renderPhase({ phase: "syncing", reasonCode: null });
    const syncing = a.getByTestId("coupang-syncing");
    expect(syncing.className).toContain("border-brand");
    expect(syncing).toHaveAttribute("role", "status");
    expect(within(syncing).getByTestId("spinner")).toBeInTheDocument();
    expect(syncing).toHaveTextContent("첫 주문을 불러오고 있어요");
    a.unmount();
    const b = renderPhase({ phase: "sync_error", reasonCode: null });
    const err = b.getByTestId("coupang-sync-error");
    expect(err.className).toContain("border-bad");
    expect(err).toHaveAttribute("role", "alert");
    expect(within(err).queryByTestId("spinner")).toBeNull();
    b.unmount();
    const c = renderPhase({ phase: "connect_error", reasonCode: "INVALID_CREDENTIAL" });
    expect(within(c.getByTestId("coupang-connect-error")).getByRole("alert").className).toContain("border-bad");
    c.unmount();
    const d = renderPhase({ phase: "connected", reasonCode: null });
    expect(d.container.querySelector('[class*="bg-good"]')).not.toBeNull();
  });

  it("connect_error (IP-mismatch recovery + IP panel) has no violations", async () => {
    const { container } = renderPhase({ phase: "connect_error", reasonCode: "CALL_ENVIRONMENT_MISMATCH" });
    await expectNoAxeViolations(container);
  });

  it("preparing (first-sync CTA) has no violations", async () => {
    const { container } = renderPhase({ phase: "preparing", reasonCode: null });
    await expectNoAxeViolations(container);
  });

  it("syncing (progress) has no violations", async () => {
    const { container } = renderPhase({ phase: "syncing", reasonCode: null });
    await expectNoAxeViolations(container);
  });

  it("syncing (stalled re-check) has no violations", async () => {
    const { container } = renderPhase(
      { phase: "syncing", reasonCode: null },
      { syncProgress: { elapsedMs: 800_000, stalled: true } },
    );
    await expectNoAxeViolations(container);
  });

  it("sync_error (retry) has no violations", async () => {
    const { container } = renderPhase({ phase: "sync_error", reasonCode: null });
    await expectNoAxeViolations(container);
  });

  it("connected (completed + health + Operations CTAs) has no violations", async () => {
    const { container } = renderPhase({ phase: "connected", reasonCode: null });
    await expectNoAxeViolations(container);
  });
});

/** A sanitized fixture issuance run view (copy KEYS only) for the walkthrough axe scans. */
function issuanceRun(over: Partial<ActionWindowRunView> = {}): ActionWindowRunView {
  return {
    protocolVersion: 1,
    runId: "run_coup01coup01ab",
    revision: 3,
    channelCode: "coupang",
    runCopyKey: "actionWindow.coupangIssuance.run",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    currentStep: {
      stepId: "aw.coupang_reach_open_api",
      stepNumber: 2,
      totalSteps: 8,
      copyKey: "actionWindow.coupangIssuance.reachOpenApi",
      status: "AWAITING_USER",
    },
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
    progress: { completedSteps: 1, totalSteps: 8 },
    updatedAt: "2026-01-01T00:00:00.000003Z",
    ...over,
  };
}

describe("CoupangIssuanceGuidedWalkthrough — axe a11y scans", () => {
  it("start gate has no violations", async () => {
    const { container } = render(<CoupangIssuanceGuidedWalkthrough onIssued={() => {}} />);
    await expectNoAxeViolations(container);
  });

  it("hosted run (timeline + controls + call-IP advisory) has no violations", async () => {
    const { container } = render(
      <CoupangIssuanceGuidedWalkthrough
        onIssued={() => {}}
        run={issuanceRun()}
        onCommand={() => {}}
        advertisedEgressIps={["203.0.113.20"]}
      />,
    );
    await expectNoAxeViolations(container);
  });

  it("COMPLETED (input hand-off CTA) has no violations", async () => {
    const { container } = render(
      <CoupangIssuanceGuidedWalkthrough
        onIssued={() => {}}
        run={issuanceRun({ status: "COMPLETED", allowedCommands: [] })}
        onCommand={() => {}}
      />,
    );
    await expectNoAxeViolations(container);
  });
});
