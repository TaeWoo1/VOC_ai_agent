package com.sellerops.attention;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.auth.JwtAuthFilter;
import com.sellerops.auth.JwtTokenProvider;
import com.sellerops.config.SecurityConfig;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Pins the JSON the attention drill-down actually puts on the wire
 * ({@code GET /api/seller-accounts/{accountId}/attention/items}).
 *
 * <p>{@link OperatorVocItem} carries a product rule that only holds if it survives
 * serialization: {@code productName} is a display name and never an identifier, and no
 * product identifier field exists on the surface at all. Until now that rule was tested
 * only where it is decided — in the source, over {@code Product} rows
 * ({@code IngestedReviewVocItemSource.hasDisplayableName}) — and
 * {@link OperatorAttentionControllerTest} asserts delegation on the Java object, stopping
 * short of JSON. Nothing looked at the bytes, so the wire-level half of the rule was
 * unowned: adding an identifier to the record, or configuring Jackson's
 * {@code default-property-inclusion}, would have broken it with every existing test green.
 *
 * <p>The service is mocked on purpose. Where {@code productName} comes from is the source's
 * contract and is covered there; what this test owns is the serialization boundary — given
 * a resolved name, or a deliberate null, what does the operator's client receive.
 *
 * <p>Convention follows {@code UploadControllerContractTest}: {@code @WebMvcTest} with the
 * REAL {@link SecurityConfig}, so the 401 is exercised rather than simulated, and the real
 * {@link JwtAuthFilter} (a {@code jakarta.servlet.Filter}, component-scanned by default —
 * no import needed). Only {@link JwtTokenProvider} (token cryptography, not this contract)
 * and {@link OperatorAttentionService} are mocked. Hermetic: no datasource, no network, no
 * credentials; the bearer token is a fixed literal whose parse result is stubbed, and every
 * product name below is synthetic.
 */
@WebMvcTest(OperatorAttentionController.class)
@Import(SecurityConfig.class)
@ActiveProfiles("test")
class OperatorAttentionItemsJsonContractTest {

    @Autowired MockMvc mockMvc;
    @MockBean OperatorAttentionService service;
    @MockBean JwtTokenProvider tokenProvider;

    private static final String TOKEN = "test-only-token-never-a-real-jwt";
    private final UUID orgId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final LocalDate from = LocalDate.parse("2026-05-01");
    private final LocalDate to = LocalDate.parse("2026-05-31");

    @BeforeEach
    void setUp() {
        // The filter is real; only the token→principal step is stubbed.
        when(tokenProvider.parse(TOKEN)).thenReturn(new AuthPrincipal(userId, orgId, "op@example.com"));
    }

    @Test
    void aSafeLinkedNameSerializesAsProductNameAndEveryOtherItemFieldSurvives() throws Exception {
        // A product the source judged displayable: a real 상품명, not equal to its SKU.
        stubItems(item("가을 니트 가디건 CHARCOAL"));

        mockMvc.perform(itemsRequest().header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isOk())
                // The page envelope.
                .andExpect(jsonPath("$.signalType").value("LOW_RATING_REVIEW"))
                .andExpect(jsonPath("$.fromDate").value("2026-05-01"))
                .andExpect(jsonPath("$.toDate").value("2026-05-31"))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items.length()").value(1))
                // The linked name reaches the operator intact — not truncated, not redacted.
                // (OperatorVocItem's note: productName is deliberately NOT run through
                // VocPreviewSanitizer; it is seller-authored catalog text.)
                .andExpect(jsonPath("$.items[0].productName").value("가을 니트 가디건 CHARCOAL"))
                // The existing fields, pinned so a product-shaped change cannot quietly
                // reshape the rest of the row.
                .andExpect(jsonPath("$.items[0].channelCode").value("CAFE24"))
                .andExpect(jsonPath("$.items[0].channelNameKo").value("카페24"))
                .andExpect(jsonPath("$.items[0].sourceType").value("REVIEW"))
                .andExpect(jsonPath("$.items[0].rating").value(2))
                .andExpect(jsonPath("$.items[0].replyStatus").value("UNANSWERED"))
                .andExpect(jsonPath("$.items[0].sourceCreatedDate").value("2026-05-14"))
                .andExpect(jsonPath("$.items[0].collectedDate").value("2026-05-15"))
                .andExpect(jsonPath("$.items[0].signalType").value("LOW_RATING_REVIEW"))
                .andExpect(jsonPath("$.items[0].safePreview").value("배송은 빨랐는데 색이 생각과 달라요"));
    }

    /**
     * The null is a VALUE, not an omission. {@link OperatorVocItem} states that a null
     * productName means "no name is available", NOT "this row has no product" — a client
     * can only honour that distinction if the key is on the wire. An absent key is
     * indistinguishable from a field the client does not know about, which is how "no name"
     * silently becomes "no product".
     *
     * <p>Asserted on the raw body because jsonPath cannot see the difference: MockMvc's
     * {@code exists()} fails on a null value and {@code doesNotExist()} passes for one, so
     * neither separates "key present, value null" from "key absent". Only the bytes do.
     * This is what would break under {@code spring.jackson.default-property-inclusion:
     * non_null} — today unset, and this test is what makes setting it a visible decision.
     */
    @Test
    void missingProductContextSerializesAsAnExplicitNullProductNameRatherThanAnAbsentKey() throws Exception {
        // What the source emits when no name can be resolved honestly — no product link, or
        // a product that is absent, cross-org, blank-named, placeholder-named, or SKU-named.
        stubItems(item(null));

        String body = mockMvc.perform(itemsRequest().header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("\"productName\":null");
    }

    /**
     * The excluded identifiers, checked against the whole serialized page rather than the
     * record's field list: nothing on this surface may carry productId, sku, productNo
     * (상품번호 — the SKU under the channel's name), or a productRef. Scanning the bytes is
     * what makes this survive a nested DTO or a future field added to the page envelope,
     * neither of which a per-field assertion would notice.
     */
    @Test
    void noProductIdentifierAppearsAnywhereInTheSerializedPage() throws Exception {
        stubItems(item("가을 니트 가디건 CHARCOAL"));

        String body = mockMvc.perform(itemsRequest().header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // Case-insensitive: productId / product_id / productID are the same leak.
        String haystack = body.toLowerCase(Locale.ROOT);
        assertThat(haystack).doesNotContain("productid");
        assertThat(haystack).doesNotContain("product_id");
        assertThat(haystack).doesNotContain("sku");
        assertThat(haystack).doesNotContain("productno");
        assertThat(haystack).doesNotContain("product_no");
        assertThat(haystack).doesNotContain("productref");
        assertThat(haystack).doesNotContain("product_ref");
        // "productName" is the ONLY product-shaped key that may appear.
        assertThat(body).contains("\"productName\"");
    }

    /**
     * Pins today's unauthenticated behaviour on the drill-down. The header matcher
     * attributes the 401 to THIS project's entry point (SecurityConfig:48-50, a bare
     * sendError(401)); Boot's default chain would also 401 here, but via
     * BasicAuthenticationEntryPoint, which sets WWW-Authenticate — the status alone cannot
     * tell the two apart. The service is never consulted, so no row is even read for a
     * caller whose orgId is unknown.
     */
    @Test
    void anUnauthenticatedDrillDownIsRejectedWith401AndNeverReachesTheService() throws Exception {
        mockMvc.perform(itemsRequest())
                .andExpect(status().isUnauthorized())
                .andExpect(header().doesNotExist("WWW-Authenticate"));

        verifyNoInteractions(service);
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder itemsRequest() {
        return get("/api/seller-accounts/{accountId}/attention/items", accountId)
                .param("type", "LOW_RATING_REVIEW")
                .param("from", from.toString())
                .param("to", to.toString());
    }

    private void stubItems(OperatorVocItem... items) {
        when(service.attentionItems(any(), any(), anyString(), any(), any(), anyInt(), anyInt()))
                .thenReturn(new OperatorVocItemPage(
                        "LOW_RATING_REVIEW", from, to, 0, 20, items.length, List.of(items)));
    }

    /** One synthetic drill-down row; {@code productName} is the variable under test. */
    private static OperatorVocItem item(String productName) {
        return new OperatorVocItem(
                "CAFE24", "카페24", "REVIEW", productName, 2, "UNANSWERED",
                "2026-05-14", "2026-05-15", "LOW_RATING_REVIEW",
                "배송은 빨랐는데 색이 생각과 달라요");
    }
}
