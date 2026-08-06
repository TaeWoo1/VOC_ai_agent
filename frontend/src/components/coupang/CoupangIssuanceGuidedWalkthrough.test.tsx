// @vitest-environment jsdom
// The Action Window guided walkthrough for Coupang WING Open API key issuance. It reuses the shared AW
// surfaces (timeline / controls / blocker) from a fixture run view, offers a text fallback when the agent
// cannot guide (and an "이미 키가 있어요" skip on the start gate), and never renders a credential/selector/
// url/account id. The bridge (useBridge) is mocked so the component renders with no live bridge.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
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

import { CoupangIssuanceGuidedWalkthrough } from "./CoupangIssuanceGuidedWalkthrough";
import type { GuidedIssuanceRuntime } from "../../lib/actionWindow/issuance/issuanceRuntime";

/** A fake issuance host runtime — records ensureStarted() (the START_RUN proxy) and lets a test publish views. */
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

/** A sanitized Coupang issuance run view — copy KEYS only, no prose/selector/url/credential/account id.
 *  The `channelCode` is "coupang" (the agent's own announcement — never hard-coded by the FE). */
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

const blocked = (code: BlockerCode) => issuanceRun({ blocker: { code, recoverable: true } });

beforeEach(() => {
  h.bridge = { phase: "paired", maybeNeedsLocalNetworkAccess: false };
  h.requestPairing.mockClear();
  h.retry.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("CoupangIssuanceGuidedWalkthrough", () => {
  it("renders the AW timeline + controls from a fixture issuance run view (step copy by key)", () => {
    render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />);
    expect(screen.getByRole("region", { name: "진행 단계" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "가능한 동작" })).toBeInTheDocument();
    // Step 2's copy resolved from its key (FE-owned), not runtime prose.
    expect(screen.getByText("판매자정보 › 오픈API 키 발급으로 이동")).toBeInTheDocument();
    expect(screen.getByText("1 / 8")).toBeInTheDocument();
  });

  it("renders the FULL per-step instruction under the timeline (self-sufficient — no need to decode the highlight)", () => {
    // copyKeys step → its complete instruction stating SellerOps reads none of the values.
    render(
      <CoupangIssuanceGuidedWalkthrough
        onIssued={vi.fn()}
        run={issuanceRun({
          currentStep: { stepId: "aw.coupang_copy_keys", stepNumber: 7, totalSteps: 8, copyKey: "actionWindow.coupangIssuance.copyKeys", status: "AWAITING_USER" },
        })}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.getByText(/SellerOps는 이 값들을 읽지 않습니다/)).toBeInTheDocument();
  });

  it("the issue-checkpoint step detail states the seller clicks 발급 (the agent never issues)", () => {
    render(
      <CoupangIssuanceGuidedWalkthrough
        onIssued={vi.fn()}
        run={issuanceRun({
          currentStep: { stepId: "aw.coupang_issue", stepNumber: 6, totalSteps: 8, copyKey: "actionWindow.coupangIssuance.issueCheckpoint", status: "AWAITING_USER" },
        })}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.getByText(/발급 버튼은 반드시 직접 눌러 주세요/)).toBeInTheDocument();
    expect(screen.getByText(/SellerOps는 대신 발급하지 않습니다/)).toBeInTheDocument();
  });

  it("shows a persistent call-IP advisory with the advertised IP (guided path, not only the text checklist)", () => {
    render(
      <CoupangIssuanceGuidedWalkthrough
        onIssued={vi.fn()}
        run={issuanceRun()}
        onCommand={vi.fn()}
        advertisedEgressIps={["203.0.113.10"]}
      />,
    );
    expect(screen.getByRole("region", { name: "API 호출 IP 등록 안내" })).toBeInTheDocument();
    expect(screen.getByText("203.0.113.10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "복사" })).toBeInTheDocument();
  });

  it("call-IP advisory fails safe with no advertised IP: generic note, never a fabricated IP", () => {
    render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />);
    expect(screen.getByText(/아직 설정되지 않았습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)).toBeNull();
  });

  it("shows the abort (CANCEL_RUN) and recheck controls when allowed", () => {
    render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확인 완료" })).toBeInTheDocument();
  });

  it("commands come ONLY from allowedCommands — a view without CANCEL_RUN shows no abort", () => {
    render(
      <CoupangIssuanceGuidedWalkthrough
        onIssued={vi.fn()}
        run={issuanceRun({ allowedCommands: ["REQUEST_STEP_RECHECK"] })}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
    expect(screen.getByRole("button", { name: "확인 완료" })).toBeInTheDocument();
  });

  it("forwards a command from the control panel to onCommand (recheck reports intent, never completes)", async () => {
    const onCommand = vi.fn();
    render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} run={issuanceRun()} onCommand={onCommand} />);
    await userEvent.click(screen.getByRole("button", { name: "확인 완료" }));
    expect(onCommand).toHaveBeenCalledWith("REQUEST_STEP_RECHECK");
  });

  it("renders a blocker notice for a LOGIN_REQUIRED fixture view (FE copy by code)", () => {
    render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} run={blocked("LOGIN_REQUIRED")} onCommand={vi.fn()} />);
    expect(screen.getByText("다시 로그인이 필요해요")).toBeInTheDocument();
  });

  it("COMPLETED guidance surfaces the input CTA → onIssued (never a stored credential)", async () => {
    const onIssued = vi.fn();
    render(
      <CoupangIssuanceGuidedWalkthrough
        onIssued={onIssued}
        run={issuanceRun({ status: "COMPLETED", allowedCommands: [] })}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.getByText("Open API 키 발급 완료")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "SellerOps로 돌아가 연결 정보 입력하기" }));
    expect(onIssued).toHaveBeenCalledTimes(1);
  });

  it("guided is the default: a HEALTHY run shows NO text button (text is failure-only, not co-equal)", () => {
    render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "텍스트로 직접 진행하기" })).toBeNull();
  });

  it("agent incompatible (pairing won't help) → the text FALLBACK appears and shows the WING checklist", async () => {
    h.bridge = { phase: "incompatible_version", maybeNeedsLocalNetworkAccess: false } as BridgeState;
    const onIssued = vi.fn();
    render(<CoupangIssuanceGuidedWalkthrough onIssued={onIssued} run={null} onCommand={vi.fn()} />);
    expect(screen.getByText("화면 안내를 사용할 수 없어요. 텍스트로 진행해 주세요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    // The static WING checklist takes over; completing it hands off to credential entry.
    expect(screen.getByLabelText("쿠팡 Open API 키 발급 안내")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "발급을 완료했어요" }));
    expect(onIssued).toHaveBeenCalledTimes(1);
  });

  it("agent unreachable (not installed / off) → pairing panel retry PLUS a text fallback", () => {
    h.bridge = { phase: "unreachable", maybeNeedsLocalNetworkAccess: false } as BridgeState;
    render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} run={null} onCommand={vi.fn()} />);
    expect(screen.getByTestId("agent-pairing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "텍스트로 직접 진행하기" })).toBeInTheDocument();
  });

  it("never renders a selector, url, secret, or account id (sanitized copy keys/codes only)", () => {
    const { container } = render(
      <CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} run={blocked("LOGIN_REQUIRED")} onCommand={vi.fn()} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/client_secret|clientSecret|acc-|run_coup01/);
    // The opaque runId/stepId are never surfaced.
    expect(text).not.toContain("aw.coupang_reach_open_api");
  });

  it("has no accessibility violations (hosted run)", async () => {
    const { container } = render(
      <CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} advertisedEgressIps={["203.0.113.10"]} />,
    );
    await expectNoAxeViolations(container);
  });

  it("has no accessibility violations (blocker state)", async () => {
    const { container } = render(
      <CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} run={blocked("LOGIN_REQUIRED")} onCommand={vi.fn()} />,
    );
    await expectNoAxeViolations(container);
  });

  describe("guided-first start gate", () => {
    it("shows a single start CTA plus an 'already have the key' skip, and does NOT pair/attach until started", () => {
      const host = fakeHost();
      render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} hostRuntime={host.runtime} />);
      expect(screen.getByRole("button", { name: "쿠팡 연결 안내 시작" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "이미 키가 있어요" })).toBeInTheDocument();
      expect(screen.queryByTestId("agent-pairing")).toBeNull();
      expect(host.ensureCalls()).toBe(0);
      expect(screen.queryByRole("button", { name: "텍스트로 직접 진행하기" })).toBeNull();
    });

    it("the 'already have the key' skip fires onIssued and never attaches the host", async () => {
      const onIssued = vi.fn();
      const host = fakeHost();
      render(<CoupangIssuanceGuidedWalkthrough onIssued={onIssued} hostRuntime={host.runtime} />);
      await userEvent.click(screen.getByRole("button", { name: "이미 키가 있어요" }));
      expect(onIssued).toHaveBeenCalledTimes(1);
      expect(host.ensureCalls()).toBe(0);
    });

    it("the start gate has no accessibility violations", async () => {
      const { container } = render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} />);
      await expectNoAxeViolations(container);
    });
  });

  describe("live host wiring (no run prop → the shared issuance host)", () => {
    const start = () => act(() => fireEvent.click(screen.getByRole("button", { name: "쿠팡 연결 안내 시작" })));

    it("does NOT attach (START_RUN 0) before the agent is paired", () => {
      h.bridge = { phase: "unpaired", maybeNeedsLocalNetworkAccess: false } as BridgeState;
      const host = fakeHost();
      render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} hostRuntime={host.runtime} />);
      start();
      expect(host.ensureCalls()).toBe(0);
    });

    it("attaches exactly once once started AND paired (START_RUN proxy fires once), even across a re-render", () => {
      const host = fakeHost(); // bridge defaults to paired in beforeEach
      const { rerender } = render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} hostRuntime={host.runtime} />);
      start();
      expect(host.ensureCalls()).toBe(1);
      rerender(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} hostRuntime={host.runtime} />);
      expect(host.ensureCalls()).toBe(1);
    });

    it("a controlled `run` prop bypasses the start gate + host entirely (no attach)", () => {
      const host = fakeHost();
      render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} run={issuanceRun()} hostRuntime={host.runtime} />);
      expect(host.ensureCalls()).toBe(0);
    });

    it("renders the AW surfaces from a host-published view, and forwards commands to the host", async () => {
      const host = fakeHost();
      render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} hostRuntime={host.runtime} />);
      start();
      // After start: paired, no run yet → the preparing line.
      expect(screen.getByText("도우미가 연결됐어요. 쿠팡 윙 안내를 준비하고 있어요.")).toBeInTheDocument();
      act(() => host.publish(issuanceRun()));
      expect(screen.getByText("판매자정보 › 오픈API 키 발급으로 이동")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "확인 완료" }));
      expect(host.sent).toContain("REQUEST_STEP_RECHECK");
    });

    it("a HEALTHY hosted run shows NO text button (text is failure-only)", () => {
      const host = fakeHost();
      render(<CoupangIssuanceGuidedWalkthrough onIssued={vi.fn()} hostRuntime={host.runtime} />);
      start();
      act(() => host.publish(issuanceRun()));
      expect(screen.queryByRole("button", { name: "텍스트로 직접 진행하기" })).toBeNull();
    });
  });
});
