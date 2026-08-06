// @vitest-environment jsdom
// The Action Window guided walkthrough for Coupang WING key RENEWAL. It reuses the shared AW surfaces from a
// fixture run view (renewal copy KEYS only), offers a text fallback when the agent cannot guide (and an
// "이미 새 키가 있어요" skip on the start gate), and never renders a credential/selector/url/account id. The
// bridge (useBridge) is mocked so the component renders with no live bridge.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import { expectNoAxeViolations } from "../../test/axe";
import type { BridgeState } from "../../lib/bridge/bridgeClient";
import type { ActionWindowRunView } from "../../lib/actionWindow/contract";

const h = vi.hoisted(() => ({
  bridge: { phase: "paired", maybeNeedsLocalNetworkAccess: false } as BridgeState,
  requestPairing: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("../../hooks/useBridge", () => ({
  useBridge: () => ({ state: h.bridge, requestPairing: h.requestPairing, revoke: vi.fn(), retry: h.retry }),
}));

import { CoupangRenewalGuidedWalkthrough } from "./CoupangRenewalGuidedWalkthrough";
import type { GuidedIssuanceRuntime } from "../../lib/actionWindow/issuance/issuanceRuntime";

function fakeHost() {
  const listeners = new Set<(v: ActionWindowRunView | null) => void>();
  let latest: ActionWindowRunView | null = null;
  let ensureCalls = 0;
  const sent: string[] = [];
  const runtime = {
    view: () => latest,
    subscribe(l: (v: ActionWindowRunView | null) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    ensureStarted() {
      ensureCalls += 1;
    },
    send(t: string) {
      sent.push(t);
    },
    resync() {},
    dispose() {},
  } as unknown as GuidedIssuanceRuntime;
  return {
    runtime,
    ensureCalls: () => ensureCalls,
    sent,
    publish(v: ActionWindowRunView | null) {
      latest = v;
      for (const l of [...listeners]) l(v);
    },
  };
}

/** A sanitized Coupang RENEWAL run view — renewal copy KEYS only, no prose/selector/url/credential. */
function renewalRun(over: Partial<ActionWindowRunView> = {}): ActionWindowRunView {
  return {
    protocolVersion: 1,
    runId: "run_coupren01ab",
    revision: 3,
    channelCode: "coupang",
    runCopyKey: "actionWindow.coupangRenewal.run",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    currentStep: {
      stepId: "aw.coupang_check_expiry",
      stepNumber: 3,
      totalSteps: 6,
      copyKey: "actionWindow.coupangRenewal.checkExpiry",
      status: "AWAITING_USER",
    },
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
    progress: { completedSteps: 2, totalSteps: 6 },
    updatedAt: "2026-01-01T00:00:00.000003Z",
    ...over,
  };
}

beforeEach(() => {
  h.bridge = { phase: "paired", maybeNeedsLocalNetworkAccess: false };
  h.requestPairing.mockClear();
  h.retry.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("CoupangRenewalGuidedWalkthrough", () => {
  it("renders the AW timeline + controls from a fixture renewal run view (step copy by key)", () => {
    render(<CoupangRenewalGuidedWalkthrough onComplete={vi.fn()} run={renewalRun()} onCommand={vi.fn()} />);
    expect(screen.getByRole("region", { name: "진행 단계" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "가능한 동작" })).toBeInTheDocument();
    // Step 3's renewal copy resolved from its key (FE-owned).
    expect(screen.getByText("현재 키의 유효기간 확인")).toBeInTheDocument();
    expect(screen.getByText("2 / 6")).toBeInTheDocument();
  });

  it("renders the FULL per-step renewal instruction (self-sufficient) at the reissue checkpoint", () => {
    render(
      <CoupangRenewalGuidedWalkthrough
        onComplete={vi.fn()}
        run={renewalRun({
          currentStep: { stepId: "aw.coupang_reissue", stepNumber: 4, totalSteps: 6, copyKey: "actionWindow.coupangRenewal.reissueCheckpoint", status: "AWAITING_USER" },
        })}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.getByText(/재발급 버튼은 반드시 직접 눌러 주세요/)).toBeInTheDocument();
    expect(screen.getByText(/SellerOps는 대신 재발급하지 않습니다/)).toBeInTheDocument();
  });

  it("commands come ONLY from allowedCommands, and recheck reports intent (never completes)", async () => {
    const onCommand = vi.fn();
    render(<CoupangRenewalGuidedWalkthrough onComplete={vi.fn()} run={renewalRun()} onCommand={onCommand} />);
    expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "확인 완료" }));
    expect(onCommand).toHaveBeenCalledWith("REQUEST_STEP_RECHECK");
  });

  it("COMPLETED guidance surfaces the new-key input CTA → onComplete (never a stored credential)", async () => {
    const onComplete = vi.fn();
    render(
      <CoupangRenewalGuidedWalkthrough
        onComplete={onComplete}
        run={renewalRun({ status: "COMPLETED", allowedCommands: [] })}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.getByText("새 API 키 재발급 완료")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "SellerOps로 돌아가 새 키 입력하기" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("guided is the default: a HEALTHY run shows NO text button", () => {
    render(<CoupangRenewalGuidedWalkthrough onComplete={vi.fn()} run={renewalRun()} onCommand={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "텍스트로 직접 진행하기" })).toBeNull();
  });

  it("agent unavailable (incompatible) → the text FALLBACK shows the WING RENEWAL checklist → onComplete", async () => {
    h.bridge = { phase: "incompatible_version", maybeNeedsLocalNetworkAccess: false } as BridgeState;
    const onComplete = vi.fn();
    render(<CoupangRenewalGuidedWalkthrough onComplete={onComplete} run={null} onCommand={vi.fn()} />);
    expect(screen.getByText("화면 안내를 사용할 수 없어요. 텍스트로 진행해 주세요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    expect(screen.getByLabelText("쿠팡 Open API 키 갱신 안내")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "재발급을 완료했어요" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("start gate: one CTA + a skip; no pair/attach until started", () => {
    const host = fakeHost();
    render(<CoupangRenewalGuidedWalkthrough onComplete={vi.fn()} hostRuntime={host.runtime} />);
    expect(screen.getByRole("button", { name: "쿠팡 API 키 갱신 안내 시작" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이미 새 키가 있어요" })).toBeInTheDocument();
    expect(host.ensureCalls()).toBe(0);
  });

  it("the 'already have a new key' skip fires onComplete and never attaches the host", async () => {
    const onComplete = vi.fn();
    const host = fakeHost();
    render(<CoupangRenewalGuidedWalkthrough onComplete={onComplete} hostRuntime={host.runtime} />);
    await userEvent.click(screen.getByRole("button", { name: "이미 새 키가 있어요" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(host.ensureCalls()).toBe(0);
  });

  it("live host: attaches once started AND paired, renders host view, forwards commands", async () => {
    const host = fakeHost();
    render(<CoupangRenewalGuidedWalkthrough onComplete={vi.fn()} hostRuntime={host.runtime} />);
    act(() => fireEvent.click(screen.getByRole("button", { name: "쿠팡 API 키 갱신 안내 시작" })));
    expect(host.ensureCalls()).toBe(1);
    act(() => host.publish(renewalRun()));
    expect(screen.getByText("현재 키의 유효기간 확인")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "확인 완료" }));
    expect(host.sent).toContain("REQUEST_STEP_RECHECK");
  });

  it("never renders a selector, url, secret, or account id (sanitized copy keys/codes only)", () => {
    const { container } = render(
      <CoupangRenewalGuidedWalkthrough onComplete={vi.fn()} run={renewalRun()} onCommand={vi.fn()} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/client_secret|clientSecret|acc-|run_coupren01/);
    expect(text).not.toContain("aw.coupang_check_expiry");
  });

  it("has no accessibility violations (hosted renewal run)", async () => {
    const { container } = render(
      <CoupangRenewalGuidedWalkthrough onComplete={vi.fn()} run={renewalRun()} onCommand={vi.fn()} />,
    );
    await expectNoAxeViolations(container);
  });

  it("has no accessibility violations (start gate)", async () => {
    const { container } = render(<CoupangRenewalGuidedWalkthrough onComplete={vi.fn()} />);
    await expectNoAxeViolations(container);
  });
});
