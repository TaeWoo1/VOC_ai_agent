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
    path: "unknown",
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
    connectionStatus: null,
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

  it("naver_login_required with DETECTED source → re-check, not attest (detection outranks attestation)", async () => {
    const detectedLogin: GuidedConnectionState = {
      ...stateAt("naver_login_required", "NAVER_LOGIN_REQUIRED"),
      sessionSource: "detected",
    };
    const { props } = renderWizard(detectedLogin);
    expect(screen.queryByRole("button", { name: "로그인했어요" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "로그인 후 다시 확인" }));
    expect(props.onRecheck).toHaveBeenCalledOnce();
    expect(props.onConfirmLogin).not.toHaveBeenCalled();
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
    await userEvent.click(screen.getByRole("button", { name: "과거 리뷰 가져오기로 이동" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "CONTINUE_TO_REVIEW_EXPORT" });
  });

  it("completed → shows the connection health + last successful collection time when a status is read", () => {
    renderWizard(stateAt("completed"), {
      connectionStatus: {
        sellerAccountId: "acc-1",
        state: "CONNECTED",
        lastSuccessAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        consecutiveFailures: 0,
        lastError: null,
        lastSyncedAt: null,
        nextScheduledAt: null,
      },
    });
    expect(screen.getByText("연결 상태")).toBeInTheDocument();
    expect(screen.getByText("정상 수집 중")).toBeInTheDocument(); // HealthBadge for CONNECTED
    expect(screen.getByText(/마지막 성공 수집: .*분 전/)).toBeInTheDocument();
  });

  it("completed with no status read yet → the summary block is omitted, CTA still shows", () => {
    renderWizard(stateAt("completed"), { connectionStatus: null });
    expect(screen.queryByText("연결 상태")).toBeNull();
    expect(screen.getByRole("button", { name: "과거 리뷰 가져오기로 이동" })).toBeInTheDocument();
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

describe("GuidedConnectionWizard — discovery / reuse / recovery phases", () => {
  it("application_path_choice → three explicit paths (have / unknown / new), no auto-issuance", async () => {
    const { props } = renderWizard(stateAt("application_path_choice"));
    await userEvent.click(screen.getByRole("button", { name: "이미 애플리케이션이 있어요" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "APPLICATION_PATH", choice: "have" });
    await userEvent.click(screen.getByRole("button", { name: "있는지 잘 모르겠어요" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "APPLICATION_PATH", choice: "unknown" });
    await userEvent.click(screen.getByRole("button", { name: "처음 발급할게요" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "APPLICATION_PATH", choice: "new" });
  });

  it("application_status_unknown → the seller reports what they found in NAVER's list", async () => {
    const { props } = renderWizard(stateAt("application_status_unknown"));
    await userEvent.click(screen.getByRole("button", { name: /찾았어요/ }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "APPLICATION_LIST_RESULT", found: true });
    await userEvent.click(screen.getByRole("button", { name: "애플리케이션이 없어요" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "APPLICATION_LIST_RESULT", found: false });
  });

  it("existing_credential_entry → the secure form, plus a 'secret not found' exit to recovery", async () => {
    const { props } = renderWizard(stateAt("existing_credential_entry"));
    expect(screen.getByRole("button", { name: "연결 정보 저장" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "시크릿을 찾지 못했어요" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "SECRET_UNAVAILABLE" });
  });

  it("credential_recovery_required → recheck OR opt into last-resort delete-reissue", async () => {
    const { props } = renderWizard(stateAt("credential_recovery_required", "SECRET_UNRECOVERABLE"));
    await userEvent.click(screen.getByRole("button", { name: "시크릿을 다시 확인했어요" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "SECRET_RECHECKED" });
    await userEvent.click(screen.getByRole("button", { name: /삭제 후 재발급/ }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "BEGIN_DELETE_REISSUE" });
  });

  it("delete_reissue_confirm → proceed is GATED behind the 'no other program' confirmation", async () => {
    const { props } = renderWizard(stateAt("delete_reissue_confirm"));
    const proceed = screen.getByRole("button", { name: "확인했고 재발급으로 진행" });
    expect(proceed).toBeDisabled(); // cannot proceed without confirming
    await userEvent.click(proceed);
    expect(props.dispatch).not.toHaveBeenCalledWith({ type: "CONFIRM_NO_OTHER_PROGRAM" });
    await userEvent.click(screen.getByRole("checkbox"));
    expect(proceed).toBeEnabled();
    await userEvent.click(proceed);
    expect(props.dispatch).toHaveBeenCalledWith({ type: "CONFIRM_NO_OTHER_PROGRAM" });
  });

  it("delete_reissue_confirm → cancel returns to recovery (deletion is never automatic)", async () => {
    const { props } = renderWizard(stateAt("delete_reissue_confirm"));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "CANCEL_DELETE_REISSUE" });
  });

  it("delete_reissue_confirm → the confirmation is re-required on re-entry (no stale check)", async () => {
    const base = {
      template: NAVER_LIKE_TEMPLATE, busy: false, connectionStatus: null,
      dispatch: vi.fn(), onRecheck: vi.fn(), onConfirmLogin: vi.fn(), onSubmitCredentials: vi.fn(),
      onRetryTest: vi.fn(), onRetrySync: vi.fn(), onGoToReviewExport: vi.fn(),
    } as const;
    const { rerender } = render(<GuidedConnectionWizard {...base} state={stateAt("delete_reissue_confirm")} />);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "확인했고 재발급으로 진행" })).toBeEnabled();
    // Leave the phase (back to recovery) and re-enter: the mandatory confirmation must NOT persist.
    rerender(<GuidedConnectionWizard {...base} state={stateAt("credential_recovery_required", "SECRET_UNRECOVERABLE")} />);
    rerender(<GuidedConnectionWizard {...base} state={stateAt("delete_reissue_confirm")} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "확인했고 재발급으로 진행" })).toBeDisabled();
  });

  it("permission_review_required / call_environment_mismatch → re-test after the seller fixes it at NAVER", async () => {
    const perm = renderWizard(stateAt("permission_review_required", "PERMISSION_INSUFFICIENT"));
    await userEvent.click(screen.getByRole("button", { name: /권한을 확인했어요/ }));
    expect(perm.props.onRetryTest).toHaveBeenCalledOnce();

    const env = renderWizard(stateAt("call_environment_mismatch", "CALL_ENVIRONMENT_MISMATCH"));
    await userEvent.click(screen.getByRole("button", { name: /호출 환경을 확인했어요/ }));
    expect(env.props.onRetryTest).toHaveBeenCalledOnce();
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
