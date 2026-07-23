package com.sellerops.attention;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.attention.dto.CategoryCount;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.auth.AuthPrincipal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The attention controller is a thin shell: it derives orgId from the authenticated
 * principal (never the client) and passes it with the path accountId and window
 * straight to the service.
 */
class OperatorAttentionControllerTest {

    private final OperatorAttentionService service = mock(OperatorAttentionService.class);
    private final OperatorAttentionController controller = new OperatorAttentionController(service);

    @Test
    void attentionDelegatesWithPrincipalOrgPathAccountAndWindow() {
        UUID orgId = UUID.randomUUID();
        UUID accountId = UUID.randomUUID();
        LocalDate from = LocalDate.parse("2026-05-01");
        LocalDate to = LocalDate.parse("2026-05-31");
        AuthPrincipal principal = new AuthPrincipal(UUID.randomUUID(), orgId, "op@example.com");
        OperatorAttentionSummary view = new OperatorAttentionSummary(accountId, "카페24", from, to, List.of());
        when(service.attention(orgId, accountId, from, to)).thenReturn(view);

        OperatorAttentionSummary result = controller.attention(principal, accountId, from, to);

        assertThat(result).isSameAs(view);
        verify(service).attention(orgId, accountId, from, to);
    }

    @Test
    void attentionItemsDelegatesWithPrincipalOrgPathAccountTypeWindowAndPaging() {
        UUID orgId = UUID.randomUUID();
        UUID accountId = UUID.randomUUID();
        LocalDate from = LocalDate.parse("2026-05-01");
        LocalDate to = LocalDate.parse("2026-05-31");
        AuthPrincipal principal = new AuthPrincipal(UUID.randomUUID(), orgId, "op@example.com");
        OperatorVocItemPage view = new OperatorVocItemPage("NEW_REVIEW", from, to, 0, 20, 0, 0, List.of(), 0L, List.of());
        when(service.attentionItems(orgId, accountId, "NEW_REVIEW", from, to, null, 0, 20)).thenReturn(view);

        OperatorVocItemPage result = controller.attentionItems(principal, accountId, "NEW_REVIEW", from, to, null, 0, 20);

        assertThat(result).isSameAs(view);
        verify(service).attentionItems(orgId, accountId, "NEW_REVIEW", from, to, null, 0, 20);
    }

    @Test
    void attentionItemsPassesTheCategoryFacetThroughUntouched() {
        // The controller must not interpret the facet — validation (and the 400 for an unrecognised
        // value) belongs to the service, so a raw value reaching it unaltered is the contract.
        UUID orgId = UUID.randomUUID();
        UUID accountId = UUID.randomUUID();
        LocalDate from = LocalDate.parse("2026-05-01");
        LocalDate to = LocalDate.parse("2026-05-31");
        AuthPrincipal principal = new AuthPrincipal(UUID.randomUUID(), orgId, "op@example.com");
        OperatorVocItemPage view = new OperatorVocItemPage(
                "LOW_RATING_REVIEW", from, to, 0, 20, 1, 3, List.of(new CategoryCount("배송", 1L)), 2L, List.of());
        when(service.attentionItems(orgId, accountId, "LOW_RATING_REVIEW", from, to, "배송", 0, 20))
                .thenReturn(view);

        OperatorVocItemPage result = controller.attentionItems(
                principal, accountId, "LOW_RATING_REVIEW", from, to, "배송", 0, 20);

        assertThat(result).isSameAs(view);
        verify(service).attentionItems(orgId, accountId, "LOW_RATING_REVIEW", from, to, "배송", 0, 20);
    }
}
