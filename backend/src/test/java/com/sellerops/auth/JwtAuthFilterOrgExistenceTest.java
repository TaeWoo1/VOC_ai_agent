package com.sellerops.auth;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sellerops.config.SecurityConfig;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.selleraccount.SellerAccountController;
import com.sellerops.selleraccount.SellerAccountService;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * **A token whose organization no longer exists is not an authenticated caller.**
 *
 * <p>Pinned because the alternative was measured, live, on 2026-07-26. The dev JWT secret is a fixed default and
 * tokens last twelve hours, so a browser holding a token minted by an earlier disposable database verified fine
 * against a freshly created one. Every read in this service is org-scoped, so nothing failed — each one answered
 * {@code 200 []}, and the review-import screen told the seller
 * "먼저 판매 채널 계정을 연결해 주세요". That sentence was true about an organization that had ceased to exist and
 * completely misleading to the person reading it; it cost the live run its second step.
 *
 * <p>"You have no accounts yet" and "your session belongs to something that is gone" demand opposite actions, and
 * no screen can tell them apart from an empty list. So the distinction is made once, in the filter, and the
 * frontend's existing unauthenticated path takes over — which is the truth.
 *
 * <p>Uses the REAL {@link SecurityConfig} so the 401 is genuinely produced by the chain rather than simulated.
 * The account read stands in for every org-scoped endpoint: what is asserted is the filter's decision, and the
 * controller is only there to be something an authenticated request could have reached.
 */
@WebMvcTest(SellerAccountController.class)
@Import(SecurityConfig.class)
@ActiveProfiles("test")
class JwtAuthFilterOrgExistenceTest {

    @Autowired MockMvc mockMvc;
    @MockBean SellerAccountService sellerAccounts;
    @MockBean JwtTokenProvider tokenProvider;
    @MockBean OrganizationRepository organizations;

    private static final String TOKEN = "test-only-token-never-a-real-jwt";
    private final UUID orgId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();

    private void tokenParsesTo(UUID org) {
        when(tokenProvider.parse(TOKEN)).thenReturn(new AuthPrincipal(userId, org, "seller@example.com"));
    }

    @Test
    void aTokenForAnOrganizationThatNoLongerExistsIsRejectedRatherThanServedEmpty() throws Exception {
        tokenParsesTo(orgId);
        when(organizations.existsById(orgId)).thenReturn(false);

        mockMvc.perform(get("/api/seller-accounts").header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aTokenForAnOrganizationThatExistsIsAuthenticatedAsBefore() throws Exception {
        tokenParsesTo(orgId);
        when(organizations.existsById(orgId)).thenReturn(true);
        when(sellerAccounts.listForOrg(orgId)).thenReturn(List.of());

        mockMvc.perform(get("/api/seller-accounts").header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isOk());
    }

    /**
     * A principal with no tenant cannot be scoped to one, so it is treated as unknown rather than waved through —
     * authenticating it would let a malformed token read whatever an unscoped query happens to return.
     */
    @Test
    void aTokenCarryingNoOrganisationAtAllIsRejected() throws Exception {
        tokenParsesTo(null);

        mockMvc.perform(get("/api/seller-accounts").header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isUnauthorized());
    }
}
