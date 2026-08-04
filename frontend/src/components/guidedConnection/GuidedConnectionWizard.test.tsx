// @vitest-environment jsdom
// Wizard rendering + intent-dispatch tests. The wizard is controlled: given a phase it renders one
// step and emits sanitized events. Logic (which phase follows which) is covered by state.test.ts.
// The order connection is Local-Agent-free — there are NO agent/renderer/NAVER-login phases to render.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import { expectNoAxeViolations } from "../../test/axe";
import { GuidedConnectionWizard, type GuidedConnectionWizardProps } from "./GuidedConnectionWizard";
import { actorFor, DISCONNECT_GUARDRAIL_COPY, NAVER_LIKE_TEMPLATE, REVIEW_SETUP_COPY } from "../../lib/guidedConnection";
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

function renderWizard(
  state: GuidedConnectionState,
  overrides: Partial<GuidedConnectionWizardProps> = {},
) {
  const props: GuidedConnectionWizardProps = {
    state,
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
  return { props, ...render(<GuidedConnectionWizard {...props} />) };
}

describe("GuidedConnectionWizard — status panel", () => {
  it("shows the phase title, the actor, and a safe failure reason when present", () => {
    renderWizard(stateAt("permission_review_required", "PERMISSION_INSUFFICIENT"));
    expect(screen.getByRole("heading", { name: "권한 확인 필요" })).toBeInTheDocument();
    expect(screen.getByText("고객님이 진행")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/권한이 부족/);
  });

  it("renders NO Local-Agent / NAVER-login gate phase (they no longer exist in the order flow)", () => {
    // The order connection carries no agent/login step; the fork is reached directly.
    renderWizard(stateAt("application_path_choice"));
    expect(screen.queryByRole("button", { name: "로그인했어요" })).toBeNull();
    expect(screen.queryByText(/로컬 에이전트/)).toBeNull();
  });
});

describe("GuidedConnectionWizard — per-phase actions dispatch sanitized events", () => {
  it("account_store_choice_required → dispatches ACCOUNT_STORE_RESOLVED", async () => {
    const { props } = renderWizard(stateAt("account_store_choice_required"));
    await userEvent.click(screen.getByRole("button", { name: /계정·스토어를 선택/ }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "ACCOUNT_STORE_RESOLVED" });
  });

  it("application_issuance → mode fork; guided choice dispatches APPLICATION_ISSUANCE_MODE{guided}", async () => {
    const { props } = renderWizard(stateAt("application_issuance"));
    await userEvent.click(screen.getByRole("button", { name: "화면을 보며 안내받기" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
  });

  it("application_issuance → text choice reveals the static checklist in place and dispatches ISSUANCE_COMPLETE", async () => {
    const { props } = renderWizard(stateAt("application_issuance"));
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    // Each step exposes a "어디를 눌러야 하나요?" help and a checkbox; the center opens in a new tab.
    expect(screen.getAllByText("어디를 눌러야 하나요?").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("button", { name: /API 센터 열기/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "발급을 완료했어요" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "ISSUANCE_COMPLETE" });
  });

  it("application_issuance_guided → renders the Action Window walkthrough with a persistent text fallback", async () => {
    const { props } = renderWizard(stateAt("application_issuance_guided"));
    // The walkthrough's persistent text fallback returns to the checklist path (works even with no agent).
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
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

  it("connection_testing (idle) → shows a user CTA '연결 확인' that calls onRetryTest (no auto-run)", async () => {
    const { props } = renderWizard(stateAt("connection_testing", "TEMPORARY_PROVIDER_ERROR"));
    await userEvent.click(screen.getByRole("button", { name: "연결 확인" }));
    expect(props.onRetryTest).toHaveBeenCalledOnce();
  });

  it("connection_testing while BUSY → progress only, NO CTA (the in-session test is actually running)", () => {
    renderWizard(stateAt("connection_testing"), { busy: true });
    expect(screen.queryByRole("button", { name: "연결 확인" })).toBeNull();
  });

  it("first_order_sync failure → 다시 시도 calls onRetrySync", async () => {
    const { props } = renderWizard(stateAt("first_order_sync", "SYNC_FAILED"));
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(props.onRetrySync).toHaveBeenCalledOnce();
  });

  it("first_order_sync in progress → shows elapsed + resume reassurance, NO retry (never a percentage)", () => {
    renderWizard(stateAt("first_order_sync"), { syncProgress: { elapsedMs: 42_000, stalled: false } });
    expect(screen.getByText(/경과 시간: 0:42/)).toBeInTheDocument();
    expect(screen.getByText(/새로고침해도 같은 수집이 이어집니다/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
    // While actively running, there is no retry button (a second trigger would only duplicate work).
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
  });

  it("first_order_sync in progress past the soft threshold → adds a 'taking longer' note", () => {
    renderWizard(stateAt("first_order_sync"), { syncProgress: { elapsedMs: 4 * 60_000, stalled: false } });
    expect(screen.getByText(/예상보다 오래 걸리고 있어요/)).toBeInTheDocument();
  });

  it("first_order_sync stalled → offers a re-check that only polls (onRecheckSync), never a new sync", async () => {
    const onRecheckSync = vi.fn();
    renderWizard(stateAt("first_order_sync"), { syncProgress: { elapsedMs: 12 * 60_000, stalled: true }, onRecheckSync });
    expect(screen.getByText(/새 수집을 만들지 않고/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "진행 상태 다시 확인" }));
    expect(onRecheckSync).toHaveBeenCalledOnce();
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

describe("GuidedConnectionWizard — completed screen (order done, review import is a separate step)", () => {
  it("shows the connection health + last successful collection time when a status is read", () => {
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

  it("with no status read yet → the summary block is omitted, the review-setup CTA still shows", () => {
    renderWizard(stateAt("completed"), { connectionStatus: null });
    expect(screen.queryByText("연결 상태")).toBeNull();
    expect(screen.getByRole("button", { name: REVIEW_SETUP_COPY.cta })).toBeInTheDocument();
  });

  it("review-setup card: NOT paired → SETUP_REQUIRED copy (local agent needed) + CTA dispatches the handoff", async () => {
    const { props } = renderWizard(stateAt("completed"), { reviewImportReady: false });
    const card = screen.getByRole("note", { name: "리뷰 가져오기 설정" });
    expect(card).toHaveTextContent(/로컬 에이전트/); // the review step is the only place the agent appears
    await userEvent.click(screen.getByRole("button", { name: REVIEW_SETUP_COPY.cta }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "CONTINUE_TO_REVIEW_EXPORT" });
  });

  it("review-setup card: paired → GUIDED_CONFIRMATION 'ready' copy (no setup-required framing)", () => {
    renderWizard(stateAt("completed"), { reviewImportReady: true });
    const card = screen.getByRole("note", { name: "리뷰 가져오기 설정" });
    expect(card).toHaveTextContent(REVIEW_SETUP_COPY.readyBody.slice(0, 12));
  });

  it("surfaces the disconnect≠NAVER-deactivation guardrail (remove SellerOps credential, not the NAVER app)", () => {
    renderWizard(stateAt("completed"));
    const notes = screen.getAllByRole("note");
    const guardrail = notes.find((n) => n.textContent?.includes(DISCONNECT_GUARDRAIL_COPY.title));
    expect(guardrail).toBeTruthy();
    expect(guardrail?.textContent ?? "").toMatch(/비활성화/);
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

  it("existing_credential_entry → the secure form, existing-app guidance, and a 'secret not found' exit", async () => {
    const { props } = renderWizard(stateAt("existing_credential_entry"));
    expect(screen.getByRole("button", { name: "연결 정보 저장" })).toBeInTheDocument();
    // Existing-app guidance: check the existing app's API group (never nudged to create a second app).
    expect(screen.getByText("기존 앱에서 어디를 확인하나요?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "시크릿을 찾지 못했어요" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "SECRET_UNAVAILABLE" });
  });

  it("credential_recovery_required → recover by re-viewing/reissuing the Secret; NO app-delete option is offered", async () => {
    const { props } = renderWizard(stateAt("credential_recovery_required", "SECRET_UNRECOVERABLE"));
    await userEvent.click(screen.getByRole("button", { name: "시크릿을 다시 확인했거나 재발급했어요" }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: "SECRET_RECHECKED" });
    // The delete-then-reissue path is gone — no delete affordance should exist (NAVER offers no app delete).
    expect(screen.queryByRole("button", { name: /삭제/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
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

  it("has no violations at the issuance-tutorial step", async () => {
    const { container } = renderWizard(stateAt("application_issuance"));
    await expectNoAxeViolations(container);
  });

  it("has no violations at the completed step", async () => {
    const { container } = renderWizard(stateAt("completed"));
    await expectNoAxeViolations(container);
  });

  it("has no violations on the in-progress sync screen", async () => {
    const { container } = renderWizard(stateAt("first_order_sync"), {
      syncProgress: { elapsedMs: 90_000, stalled: false },
    });
    await expectNoAxeViolations(container);
  });

  it("has no violations on the stalled sync screen", async () => {
    const { container } = renderWizard(stateAt("first_order_sync"), {
      syncProgress: { elapsedMs: 12 * 60_000, stalled: true },
      onRecheckSync: () => {},
    });
    await expectNoAxeViolations(container);
  });
});
