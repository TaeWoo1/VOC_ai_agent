// @vitest-environment jsdom
// The Action Window guided walkthrough for issuance. It reuses the shared AW surfaces (timeline / controls /
// blocker) from a fixture run view, keeps a persistent text fallback, offers a text affordance when the agent
// cannot guide, and never renders a credential/selector/url/account id. The bridge (useBridge) is mocked so the
// component renders with no live bridge.
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

/** A sanitized issuance run view — copy KEYS only, no prose/selector/url/credential/account id. `appBranch`
 *  is the v2 issuance-only signal the runtime publishes once it has observed the application list. */
function issuanceRun(over: Partial<ActionWindowRunView> & { appBranch?: "existing" | "new" } = {}): ActionWindowRunView {
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
      totalSteps: 7,
      copyKey: "actionWindow.issuance.createApp",
      status: "AWAITING_USER",
    },
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
    progress: { completedSteps: 1, totalSteps: 7 },
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
  it("**shows STATUS, not the walk** — the step-by-step guidance is on the window the seller is in", () => {
    // The step prose, the step counter as a timeline, and the per-step 다음 all used to live here, which meant
    // every step of this walk ended with "now go to the other window". They are on the API-centre panel now —
    // channel name, step counter, what to do next, and one CTA — and this screen reports progress.
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />);
    expect(screen.getByRole("status", { name: "화면 안내 진행 상태" })).toBeInTheDocument();
    expect(screen.getByText("네이버 창에서 화면 안내를 따라 진행하세요")).toBeInTheDocument();
    expect(screen.getByText("1 / 7 단계 완료")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "진행 단계" })).toBeNull();
  });

  it("shows a persistent call-IP advisory with the advertised IP (M2: guided path, not only the text checklist)", () => {
    render(
      <NaverIssuanceGuidedWalkthrough
        dispatch={vi.fn()}
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
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />);
    expect(screen.getByText(/아직 설정되지 않았습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)).toBeNull();
  });

  /**
   * The per-step instruction, the secret-step privacy claim and the two step-3 advisories were asserted here
   * while this screen rendered them. They are the PANEL's copy now — and they are still the same strings: the
   * runtime's tables are pinned to this file's `ISSUANCE_STEP_DETAIL` character for character by
   * `collector/test/crossstack/naver-issuance-fe-copy-parity.test.ts`, which is where those claims are asserted.
   */

  it("**offers no per-step control at a healthy barrier** — one 다음, and it is on the NAVER window", () => {
    // Two screens offering the same press is how a seller ends up pressing it twice, and only one of them is
    // the screen they are working on. 취소 stays: leaving is always this screen's to offer.
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "확인 완료" })).toBeNull();
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
  });

  it("**at a recoverable blocker the recovery control IS here** — that part is this screen's job", async () => {
    const onCommand = vi.fn();
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={blocked("LOGIN_REQUIRED")} onCommand={onCommand} />);
    await userEvent.click(screen.getByRole("button", { name: "다시 확인" }));
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
    await userEvent.click(screen.getByRole("button", { name: "연결 정보 입력하기" }));
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
    expect(screen.getByRole("button", { name: "연결 정보 입력하기" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "연결 정보 입력하기" })).toBeInTheDocument();
    // The existing-app guided completion never says 발급 (label, CTA, or the container aria-label).
    expect(container.textContent ?? "").not.toContain("발급");
    expect(screen.queryByLabelText("화면 안내 발급")).toBeNull();
    expect(screen.getByLabelText("화면 안내")).toBeInTheDocument();
  });

  it("guided is the default: a HEALTHY run shows NO text button (text is failure-only, not co-equal)", () => {
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={issuanceRun()} onCommand={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "직접 진행하기" })).toBeNull();
  });

  it("agent incompatible (pairing won't help) → the text FALLBACK appears and dispatches mode:'text'", async () => {
    h.bridge = { phase: "incompatible_version", maybeNeedsLocalNetworkAccess: false } as BridgeState;
    const dispatch = vi.fn();
    render(<NaverIssuanceGuidedWalkthrough dispatch={dispatch} run={null} onCommand={vi.fn()} />);
    expect(screen.getByText("화면 안내를 사용할 수 없어요. 텍스트로 진행해 주세요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "직접 진행하기" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
  });

  it("agent unreachable (not installed / off) → pairing panel retry PLUS a text fallback", () => {
    h.bridge = { phase: "unreachable", maybeNeedsLocalNetworkAccess: false } as BridgeState;
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={null} onCommand={vi.fn()} />);
    expect(screen.getByTestId("agent-pairing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "직접 진행하기" })).toBeInTheDocument();
  });

  it("agent not paired (handshake in progress) → the pairing panel is shown, NO text button yet", () => {
    h.bridge = { phase: "unpaired", maybeNeedsLocalNetworkAccess: false } as BridgeState;
    render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={null} onCommand={vi.fn()} />);
    expect(screen.getByTestId("agent-pairing")).toBeInTheDocument();
    // Plain unpaired is not a failure — no co-equal text button.
    expect(screen.queryByRole("button", { name: "직접 진행하기" })).toBeNull();
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

  describe("guided-first start gate", () => {
    it("the start gate has no accessibility violations", async () => {
      const { container } = render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} />);
      expect(screen.getByRole("button", { name: "화면 안내로 진행하기 (도우미 필요)" })).toBeInTheDocument();
      await expectNoAxeViolations(container);
    });

    it("offers both paths and pairs/attaches for neither until the seller starts", () => {
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      // Pilot Readiness Gate v1 §3: the manual path is on the gate and it is the filled control.
      // The guided CTA is unchanged and one press away for a seller running the 도우미.
      expect(screen.getByRole("button", { name: "직접 진행하기" }).className).toContain("btn-primary");
      expect(
        screen.getByRole("button", { name: "화면 안내로 진행하기 (도우미 필요)" }).className,
      ).toContain("btn-ghost");
      // The property this test was written for is untouched: nothing pairs, nothing attaches, and no
      // bridge is opened until the seller chooses the guided walk.
      expect(screen.queryByTestId("agent-pairing")).toBeNull();
      expect(host.ensureCalls()).toBe(0);
    });
  });

  describe("live host wiring (no run prop → the shared issuance host)", () => {
    // Guided-first: the live host only begins after the seller clicks the start CTA.
    const start = () => act(() => fireEvent.click(screen.getByRole("button", { name: "화면 안내로 진행하기 (도우미 필요)" })));

    it("does NOT attach (START_RUN 0) before the agent is paired", () => {
      h.bridge = { phase: "unpaired", maybeNeedsLocalNetworkAccess: false } as BridgeState;
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      start();
      expect(host.ensureCalls()).toBe(0);
    });

    it("attaches exactly once once started AND paired (START_RUN proxy fires once), even across a re-render", () => {
      const host = fakeHost(); // bridge defaults to paired in beforeEach
      const { rerender } = render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      start();
      expect(host.ensureCalls()).toBe(1);
      rerender(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      expect(host.ensureCalls()).toBe(1);
    });

    it("a controlled `run` prop bypasses the start gate + host entirely (no attach)", () => {
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} run={issuanceRun()} hostRuntime={host.runtime} />);
      expect(host.ensureCalls()).toBe(0);
    });

    it("renders the AW surfaces from a host-published view, and forwards commands to the host", async () => {
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      start();
      // After start: paired, no run yet → the preparing line.
      expect(screen.getByText("도우미가 연결됐어요. NAVER API 센터 안내를 준비하고 있어요.")).toBeInTheDocument();
      // A published view drives the status surface; the step-by-step guidance is on the NAVER window.
      act(() => host.publish(issuanceRun()));
      expect(screen.getByText("네이버 창에서 화면 안내를 따라 진행하세요")).toBeInTheDocument();
      // …and at a blocker, the recovery control forwards to the host.
      act(() => host.publish(blocked("LOGIN_REQUIRED")));
      await userEvent.click(screen.getByRole("button", { name: "다시 확인" }));
      expect(host.sent).toContain("REQUEST_STEP_RECHECK");
    });

    it("the branch is observed from the run view's appBranch → dispatches ISSUANCE_APP_BRANCH_OBSERVED", () => {
      const dispatch = vi.fn();
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={dispatch} hostRuntime={host.runtime} />);
      start();
      // Existing app: the runtime published appBranch:"existing" → the FE routes on it (not the copy key).
      act(() => host.publish(issuanceRun({ appBranch: "existing" })));
      expect(dispatch).toHaveBeenCalledWith({ type: "ISSUANCE_APP_BRANCH_OBSERVED", branch: "existing" });
    });

    it("an empty store is observed as branch 'new' (once)", () => {
      const dispatch = vi.fn();
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={dispatch} hostRuntime={host.runtime} />);
      start();
      act(() => host.publish(issuanceRun({ appBranch: "new" })));
      expect(dispatch).toHaveBeenCalledWith({ type: "ISSUANCE_APP_BRANCH_OBSERVED", branch: "new" });
      // Latched: a later same-branch frame does not re-dispatch.
      act(() => host.publish(issuanceRun({ appBranch: "new" })));
      expect(dispatch.mock.calls.filter((c) => c[0]?.type === "ISSUANCE_APP_BRANCH_OBSERVED")).toHaveLength(1);
    });

    it("branch comes from appBranch, NOT the copy key — a view with no appBranch dispatches nothing", () => {
      const dispatch = vi.fn();
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={dispatch} hostRuntime={host.runtime} />);
      start();
      // A step-2 view whose copy key would once have implied a branch, but with NO appBranch yet → no dispatch
      // (the runtime has not observed the list; the journey stays path-unknown, fail-safe).
      act(() =>
        host.publish(
          issuanceRun({
            currentStep: { stepId: "aw.issuance_open_or_create_app", stepNumber: 2, totalSteps: 7, copyKey: "actionWindow.issuance.openApp", status: "AWAITING_USER" },
          }),
        ),
      );
      expect(dispatch.mock.calls.filter((c) => c[0]?.type === "ISSUANCE_APP_BRANCH_OBSERVED")).toHaveLength(0);
    });

    it("appBranch wins over a contradictory copy key (copy-key inference is fully removed)", () => {
      const dispatch = vi.fn();
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={dispatch} hostRuntime={host.runtime} />);
      start();
      // Deliberately mismatched: appBranch says "existing" while the copy key is create-app. The FE must follow
      // the explicit signal, proving it no longer decodes the copy key.
      act(() =>
        host.publish(
          issuanceRun({
            appBranch: "existing",
            currentStep: { stepId: "aw.issuance_open_or_create_app", stepNumber: 2, totalSteps: 7, copyKey: "actionWindow.issuance.createApp", status: "AWAITING_USER" },
          }),
        ),
      );
      expect(dispatch).toHaveBeenCalledWith({ type: "ISSUANCE_APP_BRANCH_OBSERVED", branch: "existing" });
    });

    it("curates the control panel — a healthy barrier's full allowedCommands renders only 취소", () => {
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      start();
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
      // The 다음 is on the NAVER panel now, so a healthy barrier surfaces the ESCAPE and nothing else.
      expect(screen.queryByRole("button", { name: "확인 완료" })).toBeNull();
      expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
      // Inert / dead-ending controls are NOT surfaced; SWITCH_TO_MANUAL is reached only via the failure-only text fallback.
      expect(screen.queryByRole("button", { name: "직접 진행" })).toBeNull();
      expect(screen.queryByRole("button", { name: "안내 켜기·끄기" })).toBeNull();
      expect(screen.queryByRole("button", { name: "현재 단계 다시 찾기" })).toBeNull();
      expect(screen.queryByRole("button", { name: "일시정지" })).toBeNull();
    });

    it("a HEALTHY hosted run shows NO text button (text is failure-only)", () => {
      const host = fakeHost();
      render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} hostRuntime={host.runtime} />);
      start();
      act(() => host.publish(issuanceRun()));
      expect(screen.queryByRole("button", { name: "직접 진행하기" })).toBeNull();
    });
  });
});

describe("NaverIssuanceGuidedWalkthrough — an ENDED walk is never a dead end (2026-08-19)", () => {
  it("CANCELLED / FAILED hand over to the text checklist; COMPLETED keeps its own hand-off", async () => {
    // Before this, a cancelled walk left the timeline on screen ("1 / 7") beside an EMPTY control panel: a step
    // count with nothing to press. The Coupang sibling had the identical dead end.
    for (const status of ["CANCELLED", "FAILED"] as const) {
      const dispatch = vi.fn();
      const { unmount } = render(
        <NaverIssuanceGuidedWalkthrough
          dispatch={dispatch}
          run={issuanceRun({ status, allowedCommands: [] })}
          onCommand={vi.fn()}
        />,
      );
      const fallback = screen.getByRole("button", { name: "직접 진행하기" });
      expect(fallback).toBeInTheDocument();
      await userEvent.click(fallback);
      expect(dispatch).toHaveBeenCalledWith({ type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
      unmount();
    }

    // A COMPLETED walk is NOT an ended-without-completing walk: it keeps its credential hand-off and offers no
    // text fallback — guided stays the primary path right through to the end.
    render(
      <NaverIssuanceGuidedWalkthrough
        dispatch={vi.fn()}
        run={issuanceRun({ status: "COMPLETED", allowedCommands: [] })}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "연결 정보 입력하기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "직접 진행하기" })).toBeNull();
  });
});
