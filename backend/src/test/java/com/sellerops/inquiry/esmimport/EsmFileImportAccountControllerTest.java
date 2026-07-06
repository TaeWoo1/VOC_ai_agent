package com.sellerops.inquiry.esmimport;

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
import com.sellerops.inquiry.esmimport.dto.EsmFileImportAccountRequest;
import com.sellerops.inquiry.esmimport.dto.EsmFileImportIdentityRequest;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The provisioning controller as a thin shell: only an OWNER of the authenticated org
 * may act, and org + actor are always taken from the principal, never the request.
 */
class EsmFileImportAccountControllerTest {

    private final EsmFileImportAccountService service = mock(EsmFileImportAccountService.class);
    private final UserRepository users = mock(UserRepository.class);
    private final EsmFileImportAccountController controller =
            new EsmFileImportAccountController(service, users);

    private final UUID orgId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final AuthPrincipal principal = new AuthPrincipal(userId, orgId, "owner@sellerops.ai");

    private User user(UUID org, String role) {
        User u = new User();
        u.setId(userId);
        u.setOrgId(org);
        u.setEmail("u@x");
        u.setPasswordHash("h");
        u.setName("n");
        u.setRole(role);
        return u;
    }

    private EsmFileImportAccountRequest createReq() {
        return new EsmFileImportAccountRequest(EsmMarketplace.GMARKET, "alias", "1234567890");
    }

    @Test
    void nullPrincipalIsUnauthenticated() {
        assertThatThrownBy(() -> controller.create(null, createReq())).isInstanceOf(ApiException.class);
        verifyNoInteractions(service);
    }

    @Test
    void nonOwnerIsForbidden() {
        when(users.findById(userId)).thenReturn(Optional.of(user(orgId, "MEMBER")));
        assertThatThrownBy(() -> controller.create(principal, createReq())).isInstanceOf(ApiException.class);
        verifyNoInteractions(service);
    }

    @Test
    void userFromAnotherOrgIsForbidden() {
        when(users.findById(userId)).thenReturn(Optional.of(user(UUID.randomUUID(), "OWNER")));
        assertThatThrownBy(() -> controller.create(principal, createReq())).isInstanceOf(ApiException.class);
        verifyNoInteractions(service);
    }

    @Test
    void ownerCreateDerivesOrgAndActorFromPrincipal() {
        when(users.findById(userId)).thenReturn(Optional.of(user(orgId, "OWNER")));
        controller.create(principal, createReq());
        verify(service).create(eq(orgId), eq(userId), eq(EsmMarketplace.GMARKET), eq("alias"), eq("1234567890"));
    }

    @Test
    void ownerUpdateIdentityUsesPathIdAndPrincipal() {
        when(users.findById(userId)).thenReturn(Optional.of(user(orgId, "OWNER")));
        UUID accountId = UUID.randomUUID();
        controller.updateIdentity(principal, accountId,
                new EsmFileImportIdentityRequest(EsmMarketplace.AUCTION, "9876543210"));
        verify(service).updateIdentity(eq(orgId), eq(userId), eq(accountId),
                eq(EsmMarketplace.AUCTION), eq("9876543210"));
    }

    @Test
    void approvalMetadataOrRequestOrgCannotBypassOwnerCheck() {
        // Even a well-formed request from a non-OWNER is denied before the service is touched.
        when(users.findById(userId)).thenReturn(Optional.of(user(orgId, "OPERATOR")));
        assertThatThrownBy(() -> controller.updateIdentity(principal, UUID.randomUUID(),
                new EsmFileImportIdentityRequest(EsmMarketplace.GMARKET, "1234567890")))
                .isInstanceOf(ApiException.class);
        verify(service, org.mockito.Mockito.never()).updateIdentity(any(), any(), any(), any(), any());
    }
}
