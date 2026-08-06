// @vitest-environment jsdom
// Automated axe-core a11y scans of the Coupang first-connection tutorial across its rendered phases.
// The component is CONTROLLED and offline (no api), so each phase renders straight from a state prop.
import { describe, it } from "vitest";
import { render } from "@testing-library/react";
import { CoupangConnectTutorial } from "./CoupangConnectTutorial";
import { expectNoAxeViolations } from "../../test/axe";
import type { CoupangState } from "../../lib/coupangTutorial";
import type { ConnectionStatusView, CredentialTemplateView } from "../../lib/types";

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
