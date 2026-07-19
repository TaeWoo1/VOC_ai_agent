// @vitest-environment jsdom
// Wizard rendering + intent-dispatch tests. The wizard is controlled: given a phase it renders one
// step and emits sanitized events. Logic (which phase follows which) is covered by state.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import { expectNoAxeViolations } from "../../test/axe";
import { GuidedConnectionWizard, type GuidedConnectionWizardProps } from "./GuidedConnectionWizard";
import { actorFor, NAVER_LIKE_TEMPLATE } from "../../lib/guidedConnection";
import type { GuidedConnectionState, GuidedFailureReason, GuidedPhase } from "../../lib/guidedConnection";

function stateAt(phase: GuidedPhase, failureReason: GuidedFailureReason | null = null): GuidedConnectionState {
  return {
    phase,
    actor: actorFor(phase),
    failureReason,
    milestones: { registered: false, tested: false, synced: false },
    sessionSource: "none",
  };
}

function renderWizard(
  state: GuidedConnectionState,
  overrides: Partial<GuidedConnectionWizardProps> = {},
) {
  const props: GuidedConnectionWizardProps = {
    state,
    template: NAVER_LIKE_TEMPLATE,
    busy: false,
    dispatch: vi.fn(),
    onRecheck: vi.fn(),
    onConfirmLogin: vi.fn(),
    onSubmitCredentials: vi.fn(),
    onRetryTest: vi.fn(),
    onRetrySync: vi.fn(),
    onGoToReviewExport: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<GuidedConnectionWizard {...props} />) };
}

describe("GuidedConnectionWizard — status panel", () => {
  it("shows the phase title, the actor, and a safe failure reason when present", () => {
    renderWizard(stateAt("naver_login_required", "NAVER_LOGIN_REQUIRED"));
    expect(screen.getByRole("heading", { name: "NAVER 로그인 필요" })).toBeInTheDocument();
    expect(screen.getByText("고객님이 진행")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/NAVER 로그인이 필요/);
  });
});

describe("GuidedConnectionWizard — per-phase actions dispatch sanitized events", () => {
  it("agent_unavailable → 다시 확인 calls onRecheck", async () => {
    const { props } = renderWizard(stateAt("agent_unavailable", "AGENT_UNAVAILABLE"));
    await userEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    expect(props.onRecheck).toHaveBeenCalledOnce();
  });

  it("naver_login_required → 로그인했어요 attests login (onConfirmLogin), not a bypass", async () => {
    const { props } = renderWizard(stateAt("naver_login_required", "NAVER_LOGIN_REQUIRED"));
    await userEvent.click(screen.getByRole("button", { name: "로그인했어요" }));
    expect(props.onConfirmLogin).toHaveBeenCalledOnce();
  });

  it("naver_reconnect_required → tells the seller to re-login inside the dedicated window; recheck re-detects", async () => {
    const { props } = renderWizard(stateAt("naver_reconnect_required", "RECONNECT_REQUIRED"));
    // Copy must direct the seller to the DEDICATED window (B4 profile-mismatch explanation).
    expect(screen.getAllByText(/전용 작업 창/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "로그인 후 다시 확인" }));
    // A detected reconnect is cleared by re-detection (onRecheck), NOT by bare attestation.
    expect(props.onRecheck).toHaveBeenCalledOnce();
    expect(props.onConfirmLogin).not.toHaveBeenCalled();
  });

  it("account_store_choice_required → dispatches ACCOUNT_STORE_RESOLVED", async () => {
    const { props } = renderWizard(stateAt("account_store_choice_required"));
    await userEvent.click(screen.getByRole("button", { name: /계정·스토어를 선택/ }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "ACCOUNT_STORE_RESOLVED" });
  });

  it("application_issuance → lists guidance steps and dispatches ISSUANCE_COMPLETE", async () => {
    const { props } = renderWizard(stateAt("application_issuance"));
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    await userEvent.click(screen.getByRole("button", { name: "발급을 완료했어요" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "ISSUANCE_COMPLETE" });
  });

  it("credential_issued → dispatches BEGIN_CREDENTIAL_ENTRY", async () => {
    const { props } = renderWizard(stateAt("credential_issued"));
    await userEvent.click(screen.getByRole("button", { name: /발급된 정보를 입력/ }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "BEGIN_CREDENTIAL_ENTRY" });
  });

  it("sellerops_credential_entry → renders the secure form; forwards secrets to onSubmitCredentials", async () => {
    const { props } = renderWizard(stateAt("sellerops_credential_entry"));
    expect(screen.getByRole("heading", { name: "애플리케이션 ID·시크릿 입력" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Client ID/), "app-id");
    await userEvent.type(screen.getByLabelText(/Client Secret/), "the-secret");
    await userEvent.click(screen.getByRole("button", { name: "연결 정보 저장" }));
    expect(props.onSubmitCredentials).toHaveBeenCalledWith({ client_id: "app-id", client_secret: "the-secret" });
    // The secret never reached the reducer/dispatch.
    expect(props.dispatch).not.toHaveBeenCalled();
  });

  it("sellerops_credential_entry without a template → a calm loading message, no form", () => {
    renderWizard(stateAt("sellerops_credential_entry"), { template: null });
    expect(screen.queryByRole("button", { name: "연결 정보 저장" })).toBeNull();
    expect(screen.getByText(/불러오는 중/)).toBeInTheDocument();
  });

  it("connection_testing failure → 다시 확인 calls onRetryTest", async () => {
    const { props } = renderWizard(stateAt("connection_testing", "TEMPORARY_PROVIDER_ERROR"));
    await userEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    expect(props.onRetryTest).toHaveBeenCalledOnce();
  });

  it("first_order_sync failure → 다시 시도 calls onRetrySync", async () => {
    const { props } = renderWizard(stateAt("first_order_sync", "SYNC_FAILED"));
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(props.onRetrySync).toHaveBeenCalledOnce();
  });

  it("completed → dispatches CONTINUE_TO_REVIEW_EXPORT (the review handoff)", async () => {
    const { props } = renderWizard(stateAt("completed"));
    await userEvent.click(screen.getByRole("button", { name: "리뷰 수집 준비로 이동" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "CONTINUE_TO_REVIEW_EXPORT" });
  });

  it("review_export_readiness → navigates via onGoToReviewExport (handoff, not in-wizard collection)", async () => {
    const { props } = renderWizard(stateAt("review_export_readiness"));
    await userEvent.click(screen.getByRole("button", { name: "리뷰 내보내기로 이동" }));
    expect(props.onGoToReviewExport).toHaveBeenCalledOnce();
  });

  it("unsupported_state → dispatches RESUME (recover to the safe phase)", async () => {
    const { props } = renderWizard(stateAt("unsupported_state", "UNKNOWN_STATE"));
    await userEvent.click(screen.getByRole("button", { name: /화면을 확인했어요/ }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "RESUME" });
  });
});

describe("GuidedConnectionWizard — accessibility", () => {
  it("has no violations at the credential-entry step", async () => {
    const { container } = renderWizard(stateAt("sellerops_credential_entry"));
    await expectNoAxeViolations(container);
  });

  it("has no violations at the completed step", async () => {
    const { container } = renderWizard(stateAt("completed"));
    await expectNoAxeViolations(container);
  });
});
