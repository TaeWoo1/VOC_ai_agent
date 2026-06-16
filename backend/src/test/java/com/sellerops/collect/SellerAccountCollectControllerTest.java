package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.collect.dto.ConnectionTestResultView;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The controller is a thin shell: it must derive orgId from the authenticated
 * principal (never the client) and pass it with the path accountId straight to
 * the service. (The project has no MockMvc style; auth enforcement on /api/** is
 * covered by SecurityConfig.)
 */
class SellerAccountCollectControllerTest {

    private final CollectControlService service = mock(CollectControlService.class);
    private final SellerAccountCollectController controller = new SellerAccountCollectController(service);

    @Test
    void testConnectionDelegatesWithPrincipalOrgAndPathAccount() {
        UUID orgId = UUID.randomUUID();
        UUID accountId = UUID.randomUUID();
        AuthPrincipal principal = new AuthPrincipal(UUID.randomUUID(), orgId, "op@example.com");
        ConnectionTestResultView view = new ConnectionTestResultView(
                accountId, "UNSUPPORTED", Instant.parse("2026-06-16T00:00:00Z"),
                "이 채널의 연결 확인은 아직 제공되지 않습니다.", "VERIFY_NOT_IMPLEMENTED");
        when(service.testConnection(orgId, accountId)).thenReturn(view);

        ConnectionTestResultView result = controller.testConnection(principal, accountId);

        assertThat(result).isSameAs(view);
        verify(service).testConnection(orgId, accountId);
    }
}
