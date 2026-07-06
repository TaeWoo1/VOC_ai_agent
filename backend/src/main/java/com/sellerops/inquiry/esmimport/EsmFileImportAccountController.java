package com.sellerops.inquiry.esmimport;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.inquiry.esmimport.dto.EsmFileImportAccountRequest;
import com.sellerops.inquiry.esmimport.dto.EsmFileImportAccountResponse;
import com.sellerops.inquiry.esmimport.dto.EsmFileImportIdentityRequest;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Operator endpoints to provision file-import-only ESM SellerAccounts. Registered only
 * when ESM import <b>and</b> account provisioning are enabled, and additionally requires
 * the caller to hold the strongest existing role — {@code OWNER} — verified by a
 * per-request DB lookup of the persisted {@code users.role} within the authenticated org.
 * Org and actor come solely from the authenticated principal; a request-supplied org or
 * actor is never trusted.
 */
@RestController
@RequestMapping("/api/inquiry-imports/esm/file-import-accounts")
@ConditionalOnProperty(name = {"sellerops.inquiry-import.esm.enabled",
        "sellerops.inquiry-import.esm.account-provisioning.enabled"}, havingValue = "true")
public class EsmFileImportAccountController {

    private static final String REQUIRED_ROLE = "OWNER";

    private final EsmFileImportAccountService service;
    private final UserRepository users;

    public EsmFileImportAccountController(EsmFileImportAccountService service, UserRepository users) {
        this.service = service;
        this.users = users;
    }

    @PostMapping
    public EsmFileImportAccountResponse create(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestBody EsmFileImportAccountRequest request) {
        UUID actor = authorizeOwner(principal);
        return service.create(principal.orgId(), actor,
                request.marketplace(), request.alias(), request.sellerId());
    }

    @PutMapping("/{sellerAccountId}/identity")
    public EsmFileImportAccountResponse updateIdentity(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID sellerAccountId,
            @RequestBody EsmFileImportIdentityRequest request) {
        UUID actor = authorizeOwner(principal);
        return service.updateIdentity(principal.orgId(), actor, sellerAccountId,
                request.marketplace(), request.sellerId());
    }

    /** Require an authenticated OWNER of the token's org; returns the actor (userId). */
    private UUID authorizeOwner(AuthPrincipal principal) {
        if (principal == null) {
            throw ApiException.unauthorized("인증이 필요합니다.");
        }
        User user = users.findById(principal.userId())
                .filter(u -> u.getOrgId().equals(principal.orgId()))
                .orElseThrow(() -> ApiException.forbidden("권한이 없습니다."));
        if (!REQUIRED_ROLE.equalsIgnoreCase(user.getRole())) {
            throw ApiException.forbidden("이 작업은 운영자(OWNER) 권한이 필요합니다.");
        }
        return principal.userId();
    }
}
