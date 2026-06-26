package com.sellerops.attention;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.attention.dto.OperatorAttentionSummary;
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
}
