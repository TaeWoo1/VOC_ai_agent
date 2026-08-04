// @vitest-environment jsdom
// The Action Window guided walkthrough for issuance. It reuses the shared AW surfaces (timeline / controls /
// blocker) from a fixture run view, keeps a persistent text fallback, offers a text affordance when the agent
// cannot guide, and never renders a credential/selector/url/account id. The bridge (useBridge) is mocked so the
// component renders with no live bridge.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
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

  it("renders the FULL per-step instruction under the timeline (self-sufficient — no need to decode the highlight)", () => {
    // createApp step → its complete instruction, not just the terse title.
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />);
    expect(screen.getByText(/스토어당 애플리케이션은 1개만 만들 수 있고 삭제할 수 없/)).toBeInTheDocument();
  });

  it("the credentials step detail states SellerOps never reads the value", () => {
    render(
      <NaverIssuanceGuidedWalkthrough
        dispatch={vi.fn()}
        run={issuanceRun({ currentStep: { stepId: "aw.issuance_credentials", stepNumber: 5, totalSteps: 6, copyKey: "actionWindow.issuance.credentials", status: "AWAITING_USER" } })}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.getByText(/SellerOps는 이 값을 읽지 않습니다/)).toBeInTheDocument();
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

  it("COMPLETED guidance surfaces the common input CTA → ISSUANCE_COMPLETE (never a stored credential)", async () => {
    const dispatch = vi.fn();
    render(
      <NaverIssuanceGuidedWalkthrough
        dispatch={dispatch}
        run={issuanceRun({ status: "COMPLETED", allowedCommands: [] })}
        onCommand={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "SellerOps로 돌아가 연결 정보 입력하기" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "ISSUANCE_COMPLETE" });
  });

  it("new-app completion reads 발급 완료 (default path)", () => {
    render(
      <NaverIssuanceGuidedWalkthrough
        dispatch={vi.fn()}
        run={issuanceRun({ status: "COMPLETED", allowedCommands: [] })}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.getByText("애플리케이션 발급 완료")).toBeInTheDocument();
    // The shared CTA is path-agnostic.
    expect(screen.getByRole("button", { name: "SellerOps로 돌아가 연결 정보 입력하기" })).toBeInTheDocument();
  });

  it("existing/saved completion reads 확인 완료 with NO '발급' anywhere on the completion screen", () => {
    const { container } = render(
      <NaverIssuanceGuidedWalkthrough
        dispatch={vi.fn()}
        run={issuanceRun({ status: "COMPLETED", allowedCommands: [] })}
        onCommand={vi.fn()}
        reuseExistingApp
      />,
    );
    expect(screen.getByText("기존 애플리케이션 확인 완료")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SellerOps로 돌아가 연결 정보 입력하기" })).toBeInTheDocument();
    // The existing-app guided completion never says 발급 (label, CTA, or the container aria-label).
    expect(container.textContent ?? "").not.toContain("발급");
    expect(screen.queryByLabelText("화면 안내 발급")).toBeNull();
    expect(screen.getByLabelText("화면 안내")).toBeInTheDocument();
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

  describe("live host wiring (no run prop → the shared issuance host)", () => {
    it("does NOT attach (START_RUN 0) before the agent is paired", () => {
      h.bridge = { phase: "unpaired", maybeNeedsLocalNetworkAccess: false } as BridgeState;
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      expect(host.ensureCalls()).toBe(0);
    });

    it("attaches exactly once once paired (START_RUN proxy fires once), even across a re-render", () => {
      const host = fakeHost(); // bridge defaults to paired in beforeEach
      const { rerender } = render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      expect(host.ensureCalls()).toBe(1);
      rerender(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      expect(host.ensureCalls()).toBe(1);
    });

    it("a controlled `run` prop bypasses the host entirely (no attach)", () => {
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={issuanceRun()} hostRuntime={host.runtime} />);
      expect(host.ensureCalls()).toBe(0);
    });

    it("renders the AW surfaces from a host-published view, and forwards commands to the host", async () => {
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      // Before any frame: paired, no run yet → the preparing line.
      expect(screen.getByText("도우미가 연결됐어요. NAVER API 센터 안내를 준비하고 있어요.")).toBeInTheDocument();
      // A published view drives the shared timeline + controls.
      act(() => host.publish(issuanceRun()));
      expect(screen.getByText("애플리케이션 만들기 (스토어당 1개)")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "확인 완료" }));
      expect(host.sent).toContain("REQUEST_STEP_RECHECK");
    });

    it("curates the control panel — a barrier's full allowedCommands renders only recheck + cancel", () => {
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      // A real barrier offers six commands; the walkthrough must surface only the two meaningful ones.
      act(() =>
        host.publish(
          issuanceRun({
            allowedCommands: [
              "REQUEST_STEP_RECHECK",
              "PAUSE_RUN",
              "CANCEL_RUN",
              "SWITCH_TO_MANUAL",
              "SET_GUIDANCE_ENABLED",
              "FIND_CURRENT_STEP",
            ],
          }),
        ),
      );
      expect(screen.getByRole("button", { name: "확인 완료" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
      // Inert / dead-ending controls are NOT surfaced (SWITCH_TO_MANUAL has one home: the text button).
      expect(screen.queryByRole("button", { name: "직접 진행" })).toBeNull();
      expect(screen.queryByRole("button", { name: "안내 켜기·끄기" })).toBeNull();
      expect(screen.queryByRole("button", { name: "현재 단계 다시 찾기" })).toBeNull();
      expect(screen.queryByRole("button", { name: "일시정지" })).toBeNull();
    });

    it("the text button aborts a live run via SWITCH_TO_MANUAL (when allowed) AND advances the journey to text", async () => {
      const host = fakeHost();
      const dispatch = vi.fn();
      render(<NaverIssuanceGuidedWalkthrough dispatch={dispatch} hostRuntime={host.runtime} />);
      act(() => host.publish(issuanceRun({ allowedCommands: ["REQUEST_STEP_RECHECK", "SWITCH_TO_MANUAL"] })));
      await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
      // The run is told to stand down (not orphaned), then the FE journey switches to the checklist.
      expect(host.sent).toContain("SWITCH_TO_MANUAL");
      expect(dispatch).toHaveBeenCalledWith({ type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
    });
  });
});
