package com.sellerops.inquiry.workitem.dismissal;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.DismissalCommand;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.DismissalCounts;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.ExecuteResult;
import com.sellerops.inquiry.workitem.dismissal.dto.AdminDismissalRequest;
import com.sellerops.inquiry.workitem.dismissal.dto.AdminDismissalResponse;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Operator-only admin endpoints to preview and execute an audited bulk work-item
 * dismissal from an approved manifest. <b>Disabled by default:</b> the whole
 * controller is registered only when {@code
 * sellerops.admin.inquiry-dismissal.enabled=true}; with the flag off (the default)
 * neither route exists (404), and no SecurityConfig rule is changed.
 *
 * <p><b>Authorization.</b> Both routes fall under the app's {@code
 * anyRequest().authenticated()} rule (missing/invalid JWT ⇒ 401). On top of that this
 * controller requires the caller to hold the strongest existing role — {@code OWNER},
 * resolved from the persisted user within the caller's org. The org and the audit
 * actor are derived <b>only</b> from the authenticated principal; they are never read
 * from the request body or the manifest.
 *
 * <p><b>Limitation (stated honestly):</b> this codebase does not carry roles in the
 * JWT or in Spring Security authorities, and has no method-security. Enforcement is
 * therefore a per-request DB lookup of the persisted {@code users.role} (=OWNER),
 * combined with the disabled-by-default flag and authenticated org ownership — not a
 * declarative {@code hasRole} rule. There is no separate, finer-grained "admin" role
 * to require; {@code OWNER} is the strongest role that exists.
 */
@RestController
@RequestMapping("/api/admin/inquiry-dismissals")
@ConditionalOnProperty(name = "sellerops.admin.inquiry-dismissal.enabled", havingValue = "true")
public class InquiryDismissalAdminController {

    private static final Logger log = LoggerFactory.getLogger(InquiryDismissalAdminController.class);
    private static final String REQUIRED_ROLE = "OWNER";

    private final InquiryWorkItemDismissalService service;
    private final UserRepository users;

    public InquiryDismissalAdminController(InquiryWorkItemDismissalService service, UserRepository users) {
        this.service = service;
        this.users = users;
    }

    @PostMapping("/preview")
    public AdminDismissalResponse preview(@AuthenticationPrincipal AuthPrincipal principal,
                                          @RequestBody AdminDismissalRequest request) {
        String executedBy = authorizeAndActor(principal);
        DismissalCommand command = toCommand(principal, request, executedBy);
        DismissalCounts counts = service.preview(command);
        return new AdminDismissalResponse(counts, null, false, executedBy,
                request.approvedBy(), request.approvedAt());
    }

    @PostMapping("/execute")
    public AdminDismissalResponse execute(@AuthenticationPrincipal AuthPrincipal principal,
                                          @RequestBody AdminDismissalRequest request) {
        String executedBy = authorizeAndActor(principal);
        DismissalCommand command = toCommand(principal, request, executedBy);
        // Approval metadata is recorded distinctly from the authenticated executor: the
        // audit trail + batch ledger carry `executedBy` (authenticated identity), while
        // approved_by/approved_at are the manifest's sign-off — logged here, persisted as
        // ledger metadata, and echoed in the response, but never treated as identity.
        log.info("inquiry-dismissal execute: executedBy={} approvedBy={} approvedAt={} commandId={} count={}",
                executedBy, request.approvedBy(), request.approvedAt(), request.commandId(),
                request.workItemIds() == null ? 0 : request.workItemIds().size());
        ExecuteResult result = service.executeAllOrNothing(
                command, request.confirmation(), request.approvedBy(), request.approvedAt());
        return new AdminDismissalResponse(result.counts(), result.batchId(), result.idempotentReplay(),
                executedBy, request.approvedBy(), request.approvedAt());
    }

    /**
     * Enforce the operator role and derive the audit actor from authentication. Returns
     * the actor tag {@code OPERATOR:<userId>}. Never trusts anything from the request.
     */
    private String authorizeAndActor(AuthPrincipal principal) {
        if (principal == null) {
            throw ApiException.unauthorized("인증이 필요합니다.");
        }
        User user = users.findById(principal.userId())
                .filter(u -> u.getOrgId().equals(principal.orgId()))
                .orElseThrow(() -> ApiException.forbidden("권한이 없습니다."));
        if (!REQUIRED_ROLE.equalsIgnoreCase(user.getRole())) {
            throw ApiException.forbidden("이 작업은 운영자(OWNER) 권한이 필요합니다.");
        }
        return "OPERATOR:" + principal.userId();
    }

    /** Build the service command: org from auth, executedBy from auth, envelope validated. */
    private DismissalCommand toCommand(AuthPrincipal principal, AdminDismissalRequest request,
                                       String executedBy) {
        DismissalManifest manifest = request.toManifest()
                .validated(InquiryWorkItemDismissalService.MAX_CHUNK);
        UUID orgId = principal.orgId();
        return new DismissalCommand(orgId, manifest.sellerAccountId(),
                manifest.resolvedDisposition(), manifest.commandId(), executedBy, manifest.workItemIds());
    }
}
