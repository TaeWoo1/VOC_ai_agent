// @vitest-environment jsdom
//
// The connection-test IP-failure recovery phases must make the 'API 호출 IP' actionable (show which IP, or
// the honest "not configured yet" note, plus an already-registered acknowledgment), and a completed
// connection must positively close the IP loop — reaching completion means the test's order-access probe
// passed, which requires the call IP to be registered and allowed.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GuidedConnectionWizard, type GuidedConnectionWizardProps } from "./GuidedConnectionWizard";
import { actorFor, CALL_IP_COPY, NAVER_LIKE_TEMPLATE } from "../../lib/guidedConnection";
import type { GuidedConnectionState, GuidedFailureReason, GuidedPhase } from "../../lib/guidedConnection";

function stateAt(phase: GuidedPhase, failureReason: GuidedFailureReason | null = null): GuidedConnectionState {
  return {
    phase,
    actor: actorFor(phase),
    failureReason,
    milestones: { registered: false, tested: false, synced: false },
    path: "unknown",
  };
}

function renderWizard(phase: GuidedPhase, overrides: Partial<GuidedConnectionWizardProps> = {}) {
  const props: GuidedConnectionWizardProps = {
    state: stateAt(phase),
    template: NAVER_LIKE_TEMPLATE,
    busy: false,
    connectionStatus: null,
    capability: null,
    reviewImportReady: false,
    dispatch: vi.fn(),
    onSubmitCredentials: vi.fn(),
    onRetryTest: vi.fn(),
    onRetrySync: vi.fn(),
    onGoToReviewExport: vi.fn(),
    ...overrides,
  };
  return render(<GuidedConnectionWizard {...props} />);
}

describe("GuidedConnectionWizard — IP failure-recovery phases surface the call-IP panel", () => {
  it("call_environment_mismatch with a known advertised IP shows it + the already-registered ack", () => {
    renderWizard("call_environment_mismatch", { advertisedEgressIps: ["203.0.113.10"] });
    expect(screen.getByText(CALL_IP_COPY.registerTitle)).toBeInTheDocument();
    expect(screen.getByText("203.0.113.10")).toBeInTheDocument();
    expect(screen.getByTestId("call-ip-already-registered")).toBeInTheDocument();
  });

  it("order_access_denied with NO advertised IP distinguishes our-side unset AND is not a dead end", () => {
    renderWizard("order_access_denied", { advertisedEgressIps: [] });
    expect(screen.getByText(CALL_IP_COPY.advertisedUnsetTitle)).toBeInTheDocument();
    // Acknowledge → the nag is replaced and the retry (the real gate) is still available.
    fireEvent.click(screen.getByTestId("call-ip-already-registered"));
    expect(screen.getByText(CALL_IP_COPY.acknowledgedNote)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /다시 시도/ })).toBeInTheDocument();
  });
});

describe("GuidedConnectionWizard — completed positively closes the IP loop", () => {
  it("shows the test-passed IP readiness confirmation on the completed phase", () => {
    renderWizard("completed");
    expect(screen.getByText(CALL_IP_COPY.readyConfirmed)).toBeInTheDocument();
  });

  it("does NOT show the readiness confirmation before completion (e.g. during a failure-recovery phase)", () => {
    renderWizard("order_access_denied");
    expect(screen.queryByText(CALL_IP_COPY.readyConfirmed)).toBeNull();
  });
});
