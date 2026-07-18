package com.sellerops.attention.reply;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sellerops.attention.reply.dto.ReviewReplyApprovalResponse;
import com.sellerops.attention.reply.dto.ReviewReplyApprovalView;
import com.sellerops.attention.reply.dto.ReviewReplyCapabilities;
import com.sellerops.attention.reply.dto.ReviewReplyDraftView;
import com.sellerops.attention.reply.dto.ReviewReplyPrepView;
import com.sellerops.attention.reply.dto.ReviewReplySuggestionView;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.auth.JwtAuthFilter;
import com.sellerops.auth.JwtTokenProvider;
import com.sellerops.config.SecurityConfig;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * The routes themselves: that a colon-bearing ref survives the path, that the org comes from
 * the token, and that an anonymous caller never reaches the service.
 *
 * <p>Convention follows {@code OperatorReviewTriageControllerTest}: {@code @WebMvcTest} with
 * the REAL {@link SecurityConfig}, so the 401 is exercised rather than simulated, and the real
 * {@link JwtAuthFilter}. Only {@link JwtTokenProvider} and {@link ReviewReplyService} are
 * mocked — the behaviour is owned by {@code ReviewReplyServiceTest} against a real DB; what
 * this owns is the boundary. Hermetic: no datasource, no network, no credentials; the bearer
 * token is a fixed literal whose parse result is stubbed.
 */
@WebMvcTest(OperatorReviewReplyController.class)
@Import(SecurityConfig.class)
@ActiveProfiles("test")
class OperatorReviewReplyControllerTest {

    @Autowired MockMvc mockMvc;
    @MockBean ReviewReplyService service;
    @MockBean JwtTokenProvider tokenProvider;

    private static final String TOKEN = "test-only-token-never-a-real-jwt";
    private final UUID orgId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final UUID reviewId = UUID.randomUUID();
    private final String actionRef = "review:" + reviewId;

    private String base() {
        return "/api/seller-accounts/" + accountId + "/attention/items/" + actionRef + "/reply";
    }

    @BeforeEach
    void setUp() {
        when(tokenProvider.parse(TOKEN))
                .thenReturn(new AuthPrincipal(userId, orgId, "op@example.com"));
    }

    private static ReviewReplyPrepView prepView(String ref) {
        return new ReviewReplyPrepView(ref, "합성-리뷰-본문", false, "RESPONSE_NEEDED",
                new ReviewReplySuggestionView("합성-추천", "general_reply", "RULE_BASED",
                        "review-reply-template", "templates-v1"),
                new ReviewReplyDraftView(1, "합성-초안", "f".repeat(64), "review-reply-v1",
                        Instant.parse("2026-07-17T00:00:00Z")),
                new ReviewReplyApprovalView("APPROVED", 1, "f".repeat(64), "합성-초안",
                        Instant.parse("2026-07-17T00:00:00Z")),
                null,
                new ReviewReplyCapabilities(false, false, true, true, false));
    }

    @Test
    void theColonBearingRefSurvivesThePathAndTheOrgComesFromTheTokenNotTheClient() throws Exception {
        when(service.view(any(), any(), any())).thenReturn(prepView(actionRef));

        mockMvc.perform(get(base()).header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.actionRef").value(actionRef))
                .andExpect(jsonPath("$.capabilities.canCopy").value(true))
                .andExpect(jsonPath("$.suggestion.providerKind").value("RULE_BASED"));

        // The org is the token's, never the client's; the ref arrives intact, colon and all.
        verify(service).view(eq(orgId), eq(accountId), eq(actionRef));
    }

    @Test
    void draftSaveReachesTheServiceWithTheTokensOrgAndUser() throws Exception {
        when(service.saveDraft(any(), any(), any(), any(), any(), any()))
                .thenReturn(new ReviewReplyDraftView(2, "합성-초안", "a".repeat(64), "review-reply-v1",
                        Instant.parse("2026-07-17T00:00:00Z")));

        mockMvc.perform(put(base() + "/draft")
                        .header("Authorization", "Bearer " + TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"합성-초안\",\"baseVersion\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2));

        verify(service).saveDraft(eq(orgId), eq(accountId), eq(actionRef), eq("합성-초안"), eq(1),
                eq(userId));
    }

    @Test
    void approvalReachesTheServiceWithTheTokensOrgAndUser() throws Exception {
        when(service.decideApproval(any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new ReviewReplyApprovalResponse(actionRef, "APPROVED", false));

        mockMvc.perform(post(base() + "/approval")
                        .header("Authorization", "Bearer " + TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"commandId\":\"cmd-1\",\"state\":\"APPROVED\",\"baseVersion\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("APPROVED"))
                .andExpect(jsonPath("$.replayed").value(false));

        verify(service).decideApproval(eq(orgId), eq(accountId), eq(actionRef), eq("APPROVED"),
                eq(1), eq("cmd-1"), eq(userId));
    }

    @Test
    void anAnonymousCallerNeverReachesTheService() throws Exception {
        mockMvc.perform(get(base())).andExpect(status().isUnauthorized());
        mockMvc.perform(put(base() + "/draft")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"합성-초안\",\"baseVersion\":0}"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post(base() + "/approval")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"commandId\":\"cmd-1\",\"state\":\"APPROVED\",\"baseVersion\":1}"))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(service);
    }

    /**
     * There is no send route on this surface, and there must not be one. Asserted rather than
     * assumed: a publish endpoint is exactly the thing someone would add here "while they were
     * in the file", and the whole slice's honesty rests on it not existing (Frontend Spec §10.2
     * — 발송처럼 보이는 버튼 금지).
     *
     * <p>Asserted structurally, over the controller's own mappings, rather than by requesting
     * {@code /publish} and expecting a 404. That request does fail — but with a 500, because
     * {@code GlobalExceptionHandler}'s {@code @ExceptionHandler(Exception.class)} catch-all
     * swallows the unmapped-route exception. That is pre-existing behaviour on every route in
     * the application and is not this slice's to change; the point is that a status assertion
     * would have been testing the app's generic error handling, not whether a publish route
     * exists. This reads the mappings.
     */
    @Test
    void theControllerMapsNoSendOrPublishRoute() {
        RequestMapping classMapping =
                OperatorReviewReplyController.class.getAnnotation(RequestMapping.class);
        assertThat(classMapping.value()).allSatisfy(OperatorReviewReplyControllerTest::assertNotOutbound);

        List<String> mapped = new ArrayList<>();
        for (Method m : OperatorReviewReplyController.class.getDeclaredMethods()) {
            for (GetMapping a : m.getAnnotationsByType(GetMapping.class)) {
                mapped.addAll(List.of(a.value()));
            }
            for (PutMapping a : m.getAnnotationsByType(PutMapping.class)) {
                mapped.addAll(List.of(a.value()));
            }
            for (PostMapping a : m.getAnnotationsByType(PostMapping.class)) {
                mapped.addAll(List.of(a.value()));
            }
            for (RequestMapping a : m.getAnnotationsByType(RequestMapping.class)) {
                mapped.addAll(List.of(a.value()));
            }
        }
        assertThat(mapped).isNotEmpty();
        assertThat(mapped).allSatisfy(OperatorReviewReplyControllerTest::assertNotOutbound);
        // The whole surface, enumerated: read, save a version, decide an approval, and (v1.6) start a
        // GUIDED submission run + record the operator's UNVERIFIED report. Still nothing that sends:
        // /submission-run mints an opaque binding and /outcome records a local operator report — the
        // operator posts the reply themselves; no route here calls a marketplace.
        assertThat(mapped).containsExactlyInAnyOrder("/draft", "/approval", "/submission-run", "/outcome");
    }

    private static void assertNotOutbound(String path) {
        assertThat(path.toLowerCase())
                .as("no route on this surface may publish or send: %s", path)
                .doesNotContain("publish").doesNotContain("send").doesNotContain("dispatch")
                .doesNotContain("submit");
    }
}
