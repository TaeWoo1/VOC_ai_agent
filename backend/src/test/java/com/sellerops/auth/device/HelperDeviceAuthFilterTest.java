package com.sellerops.auth.device;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sellerops.selleraccount.SellerAccountController;
import com.sellerops.selleraccount.SellerAccountService;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.auth.JwtTokenProvider;
import com.sellerops.config.SecurityConfig;
import com.sellerops.organization.OrganizationRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The filter's three rules through the REAL {@link SecurityConfig}: a device token is admitted on the helper's
 * routes, refused everywhere else, and never handed to the JWT parser — in either direction.
 */
@WebMvcTest(SellerAccountController.class)
@Import(SecurityConfig.class)
@ActiveProfiles("test")
class HelperDeviceAuthFilterTest {

    @Autowired MockMvc mockMvc;
    @MockBean SellerAccountService sellerAccounts;
    @MockBean com.sellerops.credential.CredentialVault credentialVault;
    @MockBean JwtTokenProvider tokenProvider;
    @MockBean OrganizationRepository organizations;
    @MockBean HelperDeviceService deviceService;

    private static final String DEVICE = HelperDeviceTokens.PREFIX + "test-only-device-token";
    private final UUID orgId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();

    private void deviceAuthenticates() {
        when(deviceService.authenticate(DEVICE)).thenReturn(Optional.of(new HelperDeviceService.Authenticated(
                new AuthPrincipal(userId, orgId, "seller@example.invalid"), UUID.randomUUID())));
        when(organizations.existsById(orgId)).thenReturn(true);
        when(sellerAccounts.listForOrg(orgId)).thenReturn(List.of());
    }

    @Test
    void aLinkedHelperReachesTheHelpersRoutesWithoutTheJwtParserEverSeeingItsToken() throws Exception {
        deviceAuthenticates();
        mockMvc.perform(get("/api/seller-accounts").header("Authorization", "Bearer " + DEVICE))
                .andExpect(status().isOk());
        verify(tokenProvider, never()).parse(any());
    }

    @Test
    void aDeviceTokenOnARouteOutsideTheAllowListIs401EvenWhenItIsValid() throws Exception {
        deviceAuthenticates();
        // The seller's own profile, the device list, and the approve endpoint are the seller's, not the helper's.
        for (String path : List.of("/api/users/me", "/api/helper-devices", "/api/inquiries", "/api/products")) {
            mockMvc.perform(get(path).header("Authorization", "Bearer " + DEVICE))
                    .andExpect(status().isUnauthorized());
        }
        verify(deviceService, never()).authenticate(any());
        verify(tokenProvider, never()).parse(any());
    }

    @Test
    void aRevokedOrUnknownDeviceTokenEndsTheRequestWithoutFallingThroughToTheJwtFilter() throws Exception {
        when(deviceService.authenticate(DEVICE)).thenReturn(Optional.empty());
        mockMvc.perform(get("/api/seller-accounts").header("Authorization", "Bearer " + DEVICE))
                .andExpect(status().isUnauthorized());
        verify(tokenProvider, never()).parse(any());
    }

    @Test
    void aSellerJwtIsNeverLookedUpAsADeviceToken() throws Exception {
        String jwt = "eyJ-test-only-token";
        when(tokenProvider.parse(jwt)).thenReturn(new AuthPrincipal(userId, orgId, "seller@example.invalid"));
        when(organizations.existsById(orgId)).thenReturn(true);
        when(sellerAccounts.listForOrg(orgId)).thenReturn(List.of());
        mockMvc.perform(get("/api/seller-accounts").header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk());
        verify(deviceService, never()).authenticate(any());
    }
}
