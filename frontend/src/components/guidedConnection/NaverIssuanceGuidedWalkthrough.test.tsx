// @vitest-environment jsdom
// The Action Window guided walkthrough for issuance. It reuses the shared AW surfaces (timeline / controls /
// blocker) from a fixture run view, keeps a persistent text fallback, offers a text affordance when the agent
// cannot guide, and never renders a credential/selector/url/account id. The bridge (useBridge) is mocked so the
// component renders with no live bridge.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import { expectNoAxeViolations } from "../../test/axe";
import type { BridgeState } from "../../lib/bridge/bridgeClient";
import type { ActionWindowRunView, BlockerCode } from "../../lib/actionWindow/contract";

const h = vi.hoisted(() => ({
  bridge: { phase: "paired", maybeNeedsLocalNetworkAccess: false } as BridgeState,
  requestPairing: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("../../hooks/useBridge", () => ({
  useBridge: () => ({ state: h.bridge, requestPairing: h.requestPairing, revoke: vi.fn(), retry: h.retry }),
}));

import { NaverIssuanceGuidedWalkthrough } from "./NaverIssuanceGuidedWalkthrough";

/** A sanitized issuance run view — copy KEYS only, no prose/selector/url/credential/account id. */
function issuanceRun(over: Partial<ActionWindowRunView> = {}): ActionWindowRunView {
  return {
    protocolVersion: 1,
    runId: "run_issue01issue01",
    revision: 3,
    channelCode: "naver",
    runCopyKey: "actionWindow.issuance.run",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
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
    ...over,
  };
}

const blocked = (code: BlockerCode) => issuanceRun({ blocker: { code, recoverable: true } });

beforeEach(() => {
  h.bridge = { phase: "paired", maybeNeedsLocalNetworkAccess: false };
  h.requestPairing.mockClear();
  h.retry.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("NaverIssuanceGuidedWalkthrough", () => {
  it("renders the AW timeline + controls from a fixture issuance run view (step copy by key)", () => {
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />);
    expect(screen.getByRole("region", { name: "진행 단계" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "가능한 동작" })).toBeInTheDocument();
    // Step 2's copy resolved from its key (FE-owned), not runtime prose.
    expect(screen.getByText("애플리케이션 만들기 (스토어당 1개)")).toBeInTheDocument();
    expect(screen.getByText("1 / 6")).toBeInTheDocument();
  });

  it("shows the abort (CANCEL_RUN) control when allowed, and the recheck control", () => {
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확인 완료" })).toBeInTheDocument();
  });

  it("commands come ONLY from allowedCommands — a view without CANCEL_RUN shows no abort", () => {
    render(
      <NaverIssuanceGuidedWalkthrough
        dispatch={vi.fn()}
        run={issuanceRun({ allowedCommands: ["REQUEST_STEP_RECHECK"] })}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
    expect(screen.getByRole("button", { name: "확인 완료" })).toBeInTheDocument();
  });

  it("forwards a command from the control panel to onCommand", async () => {
    const onCommand = vi.fn();
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={issuanceRun()} onCommand={onCommand} />);
    await userEvent.click(screen.getByRole("button", { name: "확인 완료" }));
    expect(onCommand).toHaveBeenCalledWith("REQUEST_STEP_RECHECK");
  });

  it("renders a blocker notice for a LOGIN_REQUIRED fixture view (FE copy by code)", () => {
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={blocked("LOGIN_REQUIRED")} onCommand={vi.fn()} />);
    expect(screen.getByText("다시 로그인이 필요해요")).toBeInTheDocument();
  });

  it("COMPLETED guidance surfaces the input CTA → ISSUANCE_COMPLETE (never a stored credential)", async () => {
    const dispatch = vi.fn();
    render(
      <NaverIssuanceGuidedWalkthrough
        dispatch={dispatch}
        run={issuanceRun({ status: "COMPLETED", allowedCommands: [] })}
        onCommand={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "발급 안내가 끝났어요, 이제 입력할게요" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "ISSUANCE_COMPLETE" });
  });

  it("the persistent text-fallback button dispatches APPLICATION_ISSUANCE_MODE{mode:'text'} (with a live run)", async () => {
    const dispatch = vi.fn();
    render(<NaverIssuanceGuidedWalkthrough dispatch={dispatch} run={issuanceRun()} onCommand={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
  });

  it("agent incompatible (pairing won't help) → text affordance + persistent text fallback", async () => {
    h.bridge = { phase: "incompatible_version", maybeNeedsLocalNetworkAccess: false } as BridgeState;
    const dispatch = vi.fn();
    render(<NaverIssuanceGuidedWalkthrough dispatch={dispatch} run={null} onCommand={vi.fn()} />);
    expect(screen.getByText("화면 안내를 사용할 수 없어요. 텍스트로 진행해 주세요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
  });

  it("agent not paired → the pairing panel is shown (guided path only)", () => {
    h.bridge = { phase: "unpaired", maybeNeedsLocalNetworkAccess: false } as BridgeState;
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={null} onCommand={vi.fn()} />);
    expect(screen.getByTestId("agent-pairing")).toBeInTheDocument();
    // Text fallback is still available while unpaired.
    expect(screen.getByRole("button", { name: "텍스트로 직접 진행하기" })).toBeInTheDocument();
  });

  it("never renders a selector, url, secret, or account id (sanitized copy keys/codes only)", () => {
    const { container } = render(
      <NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={blocked("LOGIN_REQUIRED")} onCommand={vi.fn()} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/client_secret|clientSecret|acc-|run_issue01/);
    // The opaque runId/stepId are never surfaced.
    expect(text).not.toContain("aw.issuance_create_app");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />,
    );
    await expectNoAxeViolations(container);
  });
});
