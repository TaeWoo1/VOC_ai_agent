package com.sellerops.inquiry.workitem.dismissal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.DismissalCommand;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.DismissalCounts;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.ExecuteResult;
import com.sellerops.inquiry.workitem.dismissal.dto.AdminDismissalRequest;
import com.sellerops.inquiry.workitem.dismissal.dto.AdminDismissalResponse;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * The admin dismissal controller as a thin shell (the project has no MockMvc style;
 * SecurityConfig's {@code anyRequest().authenticated()} enforces 401 for unauthed
 * calls to /api/**, and {@code @ConditionalOnProperty} governs endpoint existence —
 * see {@link InquiryDismissalAdminControllerRegistrationTest}). These tests prove the
 * substance: only an OWNER of the authenticated org may act, the org and audit actor
 * are taken from the principal (never the request), and approval metadata is retained
 * but can never authorize.
 */
class InquiryDismissalAdminControllerTest {

    private final InquiryWorkItemDismissalService service = mock(InquiryWorkItemDismissalService.class);
    private final UserRepository users = mock(UserRepository.class);
    private final InquiryDismissalAdminController controller =
            new InquiryDismissalAdminController(service, users);

    private final UUID orgId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final AuthPrincipal principal = new AuthPrincipal(userId, orgId, "owner@sellerops.ai");

    private static final DismissalCounts OK = new DismissalCounts(false, 1, 1, 0, 0, 0, 0, 0, 0);
    private static final ExecuteResult EXECUTED =
            new ExecuteResult(new DismissalCounts(true, 1, 1, 1, 0, 0, 0, 0, 0), UUID.randomUUID(), false);

    private User user(UUID uid, UUID org, String role) {
        User u = new User();
        u.setId(uid);
        u.setOrgId(org);
        u.setEmail("u@x");
        u.setPasswordHash("h");
        u.setName("n");
        u.setRole(role);
        return u;
    }

    /** A well-formed approved request; {@code approvedBy} is deliberately a foreign identity. */
    private AdminDismissalRequest request(String confirmation) {
        return new AdminDismissalRequest(true, "someone-else@evil.example", "2026-07-06T00:00:00Z",
                account, "SPAM", "cmd-1", List.of(UUID.randomUUID()), confirmation);
    }

    // ---- authorization ---------------------------------------------------------

    @Test
    void nullPrincipalIsRejectedUnauthenticated() {
        assertThatThrownBy(() -> controller.preview(null, request(null)))
                .isInstanceOf(ApiException.class);
        verifyNoInteractions(service);
    }

    @Test
    void nonOwnerIsForbidden() {
        when(users.findById(userId)).thenReturn(Optional.of(user(userId, orgId, "MEMBER")));

        assertThatThrownBy(() -> controller.preview(principal, request(null)))
                .isInstanceOf(ApiException.class);
        verifyNoInteractions(service);
    }

    @Test
    void userFromAnotherOrgIsForbidden() {
        // The persisted user's org must match the token's org, else no lookup succeeds.
        when(users.findById(userId)).thenReturn(Optional.of(user(userId, UUID.randomUUID(), "OWNER")));

        assertThatThrownBy(() -> controller.preview(principal, request(null)))
                .isInstanceOf(ApiException.class);
        verifyNoInteractions(service);
    }

    @Test
    void approvalMetadataCannotAuthorizeANonOwner() {
        // approved=true and an approved_by are present, yet a non-OWNER is still denied —
        // proving approval metadata is not authorization.
        when(users.findById(userId)).thenReturn(Optional.of(user(userId, orgId, "MEMBER")));

        assertThatThrownBy(() -> controller.execute(principal, request("CONFIRM_DISMISS")))
                .isInstanceOf(ApiException.class);
        verifyNoInteractions(service);
    }

    // ---- actor & org derivation (from auth, never the request) -----------------

    @Test
    void previewDerivesOrgAndActorFromAuthNotRequest() {
        when(users.findById(userId)).thenReturn(Optional.of(user(userId, orgId, "OWNER")));
        when(service.preview(any())).thenReturn(OK);

        AdminDismissalResponse resp = controller.preview(principal, request(null));

        ArgumentCaptor<DismissalCommand> cap = ArgumentCaptor.forClass(DismissalCommand.class);
        verify(service).preview(cap.capture());
        DismissalCommand cmd = cap.getValue();
        assertThat(cmd.orgId()).isEqualTo(orgId);                      // from principal
        assertThat(cmd.executedBy()).isEqualTo("OPERATOR:" + userId);  // from principal
        assertThat(cmd.executedBy()).doesNotContain("evil.example");   // NOT approved_by
        assertThat(cmd.sellerAccountId()).isEqualTo(account);
        assertThat(cmd.disposition()).isEqualTo(InquiryWorkItemDisposition.SPAM);
        // Response retains approval metadata, distinct from the authenticated executor.
        assertThat(resp.executedBy()).isEqualTo("OPERATOR:" + userId);
        assertThat(resp.approvedBy()).isEqualTo("someone-else@evil.example");
    }

    @Test
    void executeDelegatesAllOrNothingWithConfirmationApprovalMetadataAndAuthExecutor() {
        when(users.findById(userId)).thenReturn(Optional.of(user(userId, orgId, "OWNER")));
        when(service.executeAllOrNothing(any(), eq("CONFIRM_DISMISS"),
                eq("someone-else@evil.example"), eq("2026-07-06T00:00:00Z"))).thenReturn(EXECUTED);

        controller.execute(principal, request("CONFIRM_DISMISS"));

        ArgumentCaptor<DismissalCommand> cap = ArgumentCaptor.forClass(DismissalCommand.class);
        // approvedBy/approvedAt flow through as metadata; executedBy comes from auth.
        verify(service).executeAllOrNothing(cap.capture(), eq("CONFIRM_DISMISS"),
                eq("someone-else@evil.example"), eq("2026-07-06T00:00:00Z"));
        assertThat(cap.getValue().executedBy()).isEqualTo("OPERATOR:" + userId);
        assertThat(cap.getValue().orgId()).isEqualTo(orgId);
    }

    // ---- envelope validation fails closed before touching the service ----------

    @Test
    void missingApprovalFailsClosed() {
        when(users.findById(userId)).thenReturn(Optional.of(user(userId, orgId, "OWNER")));
        AdminDismissalRequest notApproved = new AdminDismissalRequest(false, "op", "t",
                account, "SPAM", "cmd-1", List.of(UUID.randomUUID()), "CONFIRM_DISMISS");

        assertThatThrownBy(() -> controller.execute(principal, notApproved))
                .isInstanceOf(ApiException.class);
        verifyNoInteractions(service);
    }

    @Test
    void duplicateIdsFailClosed() {
        when(users.findById(userId)).thenReturn(Optional.of(user(userId, orgId, "OWNER")));
        UUID dup = UUID.randomUUID();
        AdminDismissalRequest dupes = new AdminDismissalRequest(true, "op", "t",
                account, "SPAM", "cmd-1", List.of(dup, dup), "CONFIRM_DISMISS");

        assertThatThrownBy(() -> controller.execute(principal, dupes))
                .isInstanceOf(ApiException.class);
        verifyNoInteractions(service);
    }
}
