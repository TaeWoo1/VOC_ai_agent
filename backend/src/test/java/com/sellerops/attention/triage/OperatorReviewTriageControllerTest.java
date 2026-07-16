package com.sellerops.attention.triage;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sellerops.attention.triage.dto.TriageDecisionResponse;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.auth.JwtAuthFilter;
import com.sellerops.auth.JwtTokenProvider;
import com.sellerops.config.SecurityConfig;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The route itself: that a ref survives HTTP, that the org comes from the token, and that an
 * anonymous caller never reaches the service.
 *
 * <p>The ref-in-the-path case is the reason this test exists rather than being folded into
 * the service test. {@code review:<uuid>} contains a colon, and a path variable is the one
 * place that is not obviously safe: colons are legal in a path segment per RFC 3986, but
 * Spring Security's {@code StrictHttpFirewall} rejects several characters outright
 * (semicolons among them) and Spring's own path matching has a history of mangling
 * separators. "It should be fine" is not a contract — a ref the transport reshapes is a ref
 * that will not parse on arrival, and no service-level test would ever notice.
 *
 * <p>Convention follows {@code OperatorAttentionItemsJsonContractTest}: {@code @WebMvcTest}
 * with the REAL {@link SecurityConfig}, so the 401 is exercised rather than simulated, and
 * the real {@link JwtAuthFilter} (a {@code jakarta.servlet.Filter}, component-scanned by
 * default). Only {@link JwtTokenProvider} and {@link ReviewTriageService} are mocked — the
 * decision's behaviour is owned by {@code ReviewTriageServiceTest} against a real DB; what
 * this owns is the boundary. Hermetic: no datasource, no network, no credentials; the
 * bearer token is a fixed literal whose parse result is stubbed.
 */
@WebMvcTest(OperatorReviewTriageController.class)
@Import(SecurityConfig.class)
@ActiveProfiles("test")
class OperatorReviewTriageControllerTest {

    @Autowired MockMvc mockMvc;
    @MockBean ReviewTriageService service;
    @MockBean JwtTokenProvider tokenProvider;

    private static final String TOKEN = "test-only-token-never-a-real-jwt";
    private final UUID orgId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final UUID reviewId = UUID.randomUUID();
    private final String actionRef = "review:" + reviewId;

    @BeforeEach
    void setUp() {
        // The filter is real; only the token→principal step is stubbed.
        when(tokenProvider.parse(TOKEN)).thenReturn(new AuthPrincipal(userId, orgId, "op@example.com"));
    }

    @Test
    void theColonBearingRefSurvivesThePathAndTheOrgComesFromTheTokenNotTheClient() throws Exception {
        when(service.decide(any(), any(), any(), any(), any(), any()))
                .thenReturn(new TriageDecisionResponse(actionRef, "RESPONSE_NEEDED", false));

        mockMvc.perform(triageRequest(actionRef)
                        .header("Authorization", "Bearer " + TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"commandId\":\"cmd-1\",\"disposition\":\"RESPONSE_NEEDED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.actionRef").value(actionRef))
                .andExpect(jsonPath("$.disposition").value("RESPONSE_NEEDED"))
                .andExpect(jsonPath("$.replayed").value(false));

        // The ref arrives WHOLE — not truncated at the colon, not URL-mangled. And the org
        // is the principal's: a client cannot name the tenant it writes into, and the user
        // id travels as the actor rather than anything from the body.
        verify(service).decide(eq(orgId), eq(accountId), eq(actionRef),
                eq("RESPONSE_NEEDED"), eq("cmd-1"), eq(userId));
    }

    @Test
    void aReplayIsA200NotAConflict() throws Exception {
        // A retried decision succeeded already; the caller's intent is satisfied, so the
        // status says success and `replayed` carries the nuance. Surfacing a replay as 4xx
        // would push clients to treat their own retries as failures.
        when(service.decide(any(), any(), any(), any(), any(), any()))
                .thenReturn(new TriageDecisionResponse(actionRef, "MONITOR", true));

        mockMvc.perform(triageRequest(actionRef)
                        .header("Authorization", "Bearer " + TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"commandId\":\"cmd-1\",\"disposition\":\"MONITOR\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.replayed").value(true));
    }

    /**
     * Pins today's unauthenticated behaviour on the decision route. The header matcher
     * attributes the 401 to THIS project's entry point (a bare {@code sendError(401)});
     * Boot's default chain would also 401 here but via {@code BasicAuthenticationEntryPoint},
     * which sets {@code WWW-Authenticate} — the status alone cannot tell the two apart.
     */
    @Test
    void anUnauthenticatedDecisionIsRejectedWith401AndNeverReachesTheService() throws Exception {
        mockMvc.perform(triageRequest(actionRef)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"commandId\":\"cmd-1\",\"disposition\":\"MONITOR\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().doesNotExist("WWW-Authenticate"));

        // Nothing is written, and no row is even looked at, for a caller whose org is
        // unknown — the write is behind the same gate as the read.
        verifyNoInteractions(service);
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder triageRequest(String ref) {
        // The ref is passed as a single pre-built path segment on purpose: this is the
        // shape a client sends after round-tripping the value it was handed.
        return post("/api/seller-accounts/{accountId}/attention/items/{actionRef}/triage", accountId, ref);
    }
}
