package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.collect.dto.AccountDashboardSummary;
import com.sellerops.collect.dto.ArticleListResponse;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The operations controller is a thin shell: it derives orgId from the
 * authenticated principal (never the client) and passes it with the path
 * accountId and query params straight to the service.
 */
class SellerAccountOperationsControllerTest {

    private final ChannelOperationsService service = mock(ChannelOperationsService.class);
    private final SellerAccountOperationsController controller = new SellerAccountOperationsController(service);

    @Test
    void dashboardDelegatesWithPrincipalOrgPathAccountAndWindow() {
        UUID orgId = UUID.randomUUID();
        UUID accountId = UUID.randomUUID();
        LocalDate from = LocalDate.parse("2026-05-01");
        LocalDate to = LocalDate.parse("2026-05-31");
        AuthPrincipal principal = new AuthPrincipal(UUID.randomUUID(), orgId, "op@example.com");
        AccountDashboardSummary view = new AccountDashboardSummary(
                accountId, UUID.randomUUID(), "카페24", from, to, 0, 0, 0, 0, 0, "NOT_COLLECTED", null);
        when(service.accountDashboard(orgId, accountId, from, to)).thenReturn(view);

        AccountDashboardSummary result = controller.dashboard(principal, accountId, from, to);

        assertThat(result).isSameAs(view);
        verify(service).accountDashboard(orgId, accountId, from, to);
    }

    @Test
    void articlesDelegatesWithPrincipalOrgPathAccountTypeAndPaging() {
        UUID orgId = UUID.randomUUID();
        UUID accountId = UUID.randomUUID();
        AuthPrincipal principal = new AuthPrincipal(UUID.randomUUID(), orgId, "op@example.com");
        ArticleListResponse view = new ArticleListResponse("REVIEW", 0, 20, 0, List.of());
        when(service.accountArticles(orgId, accountId, "REVIEW", 0, 20)).thenReturn(view);

        ArticleListResponse result = controller.articles(principal, accountId, "REVIEW", 0, 20);

        assertThat(result).isSameAs(view);
        verify(service).accountArticles(orgId, accountId, "REVIEW", 0, 20);
    }
}
