package com.sellerops.agentrun;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agentrun.dto.AgentRunClaimResponse;
import com.sellerops.agentrun.dto.AgentRunStateResponse;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.auth.JwtTokenProvider;
import com.sellerops.common.ApiException;
import com.sellerops.config.SecurityConfig;
import com.sellerops.organization.OrganizationRepository;
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
 * The route boundary: the org comes from the token (never the body), an anonymous caller never reaches
 * the service, and a service-side conflict/absence surfaces as the right HTTP status. The store's
 * behaviour is owned by {@link AgentRunStoreServiceTest} against a real DB; this owns the wiring.
 *
 * <p>Convention mirrors {@code OperatorReviewReplyControllerTest}: {@code @WebMvcTest} with the REAL
 * {@link SecurityConfig} so the 401 is exercised, only {@link JwtTokenProvider} + the service +
 * {@link OrganizationRepository} mocked, a fixed literal bearer whose parse result is stubbed.
 */
@WebMvcTest(AgentRunStoreController.class)
@Import(SecurityConfig.class)
@ActiveProfiles("test")
class AgentRunStoreControllerTest {

    private static final String TOKEN = "test-only-token-never-a-real-jwt";

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @MockBean AgentRunStoreService service;
    @MockBean JwtTokenProvider tokenProvider;
    @MockBean OrganizationRepository organizations;

    private final UUID orgId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        UUID userId = UUID.randomUUID();
        when(tokenProvider.parse(TOKEN)).thenReturn(new AuthPrincipal(userId, orgId, "op@example.com"));
        when(organizations.existsById(orgId)).thenReturn(true);
    }

    private String bearer() {
        return "Bearer " + TOKEN;
    }

    @Test
    void anonymousCallerNeverReachesTheService() throws Exception {
        mockMvc.perform(get("/api/agent-run-store/t1")).andExpect(status().isUnauthorized());
        mockMvc.perform(put("/api/agent-run-store/t1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"domain\":\"INQUIRY\",\"status\":\"AWAITING_APPROVAL\",\"snapshot\":{}}"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(service);
    }

    @Test
    void getReadsTheOrgFromTheTokenAndReturnsTheRun() throws Exception {
        when(service.get(eq(orgId), eq("t1")))
                .thenReturn(new AgentRunStateResponse("t1", "INQUIRY", "AWAITING_APPROVAL", 1L,
                        objectMapper.readTree("{\"phase\":\"await\"}")));

        mockMvc.perform(get("/api/agent-run-store/t1").header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.domain").value("INQUIRY"))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.snapshot.phase").value("await"));
        verify(service).get(orgId, "t1");
    }

    @Test
    void putForwardsTheOrgAndBody() throws Exception {
        when(service.upsert(eq(orgId), eq("t1"), any()))
                .thenReturn(new AgentRunStateResponse("t1", "INQUIRY", "AWAITING_APPROVAL", 1L,
                        objectMapper.readTree("{}")));

        mockMvc.perform(put("/api/agent-run-store/t1")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"domain\":\"INQUIRY\",\"status\":\"AWAITING_APPROVAL\",\"snapshot\":{}}"))
                .andExpect(status().isOk());
        verify(service).upsert(eq(orgId), eq("t1"), any());
    }

    @Test
    void claimDerivesOrgFromTokenAndTakesNoBody() throws Exception {
        when(service.claim(eq(orgId), eq("t1")))
                .thenReturn(new AgentRunClaimResponse("CLAIMED", 2L, objectMapper.readTree("{}")));

        mockMvc.perform(post("/api/agent-run-store/t1/claim").header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("CLAIMED"))
                .andExpect(jsonPath("$.version").value(2));
        verify(service).claim(orgId, "t1");
    }

    @Test
    void deleteReturnsNoContent() throws Exception {
        mockMvc.perform(delete("/api/agent-run-store/t1").header("Authorization", bearer()))
                .andExpect(status().isNoContent());
        verify(service).delete(orgId, "t1");
    }

    @Test
    void aServiceConflictSurfacesAs409() throws Exception {
        when(service.claim(eq(orgId), eq("t1"))).thenThrow(ApiException.conflict("stale"));
        mockMvc.perform(post("/api/agent-run-store/t1/claim").header("Authorization", bearer()))
                .andExpect(status().isConflict());
    }
}
