package com.sellerops.attention.reply;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sellerops.attention.reply.dto.ReviewReplyWorkRestoreResponse;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.auth.JwtTokenProvider;
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
 * The 복원 route boundary: the colon-bearing ref survives the path, the org and actor come from the
 * token (never the client), an anonymous caller never reaches the service, and a repeat is a 200
 * replay. Behaviour is owned by {@code ReplyWorkWorklistTest} against a real DB; this owns the
 * boundary. The mirror of {@code OperatorReplyWorkDismissalControllerTest}.
 */
@WebMvcTest(OperatorReplyWorkRestoreController.class)
@Import(SecurityConfig.class)
@ActiveProfiles("test")
class OperatorReplyWorkRestoreControllerTest {

    @Autowired MockMvc mockMvc;
    @MockBean ReviewReplyWorkRestoreService service;
    @MockBean JwtTokenProvider tokenProvider;
    /**
     * The token's organization has to exist for the request to be authenticated at all: `JwtAuthFilter` checks,
     * because an org-scoped read against a vanished org succeeds and returns nothing (see that filter).
     */
    @MockBean OrganizationRepository organizations;

    private static final String TOKEN = "test-only-token-never-a-real-jwt";
    private final UUID orgId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final String actionRef = "review:" + UUID.randomUUID();

    @BeforeEach
    void setUp() {
        when(tokenProvider.parse(TOKEN)).thenReturn(new AuthPrincipal(userId, orgId, "op@example.com"));
        when(organizations.existsById(orgId)).thenReturn(true);
    }

    @Test
    void restoresTheRefWithTheOrgAndActorFromTheToken() throws Exception {
        when(service.restore(any(), any(), any(), any(), any()))
                .thenReturn(new ReviewReplyWorkRestoreResponse(actionRef, false));

        mockMvc.perform(restore(actionRef)
                        .header("Authorization", "Bearer " + TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"commandId\":\"cmd-1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.actionRef").value(actionRef))
                .andExpect(jsonPath("$.replayed").value(false));

        // The ref arrives WHOLE, the org is the principal's, and the actor label is derived from the
        // token's user id — a client cannot name the tenant it writes into or spoof the actor.
        verify(service).restore(eq(orgId), eq(accountId), eq(actionRef), eq("cmd-1"),
                eq("SELLER:" + userId));
    }

    @Test
    void aRepeatedRestoreIsA200Replay() throws Exception {
        when(service.restore(any(), any(), any(), any(), any()))
                .thenReturn(new ReviewReplyWorkRestoreResponse(actionRef, true));

        mockMvc.perform(restore(actionRef)
                        .header("Authorization", "Bearer " + TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"commandId\":\"cmd-1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.replayed").value(true));
    }

    @Test
    void anUnauthenticatedRestoreIsRejectedAndNeverReachesTheService() throws Exception {
        mockMvc.perform(restore(actionRef)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"commandId\":\"cmd-1\"}"))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(service);
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder restore(String ref) {
        return post("/api/seller-accounts/{accountId}/attention/items/{actionRef}/reply-work/restore",
                accountId, ref);
    }
}
