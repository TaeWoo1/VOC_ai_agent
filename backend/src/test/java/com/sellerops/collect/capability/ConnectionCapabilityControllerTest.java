package com.sellerops.collect.capability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.auth.AuthPrincipal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The controller is a thin shell: it must derive orgId from the authenticated principal (never the
 * client) and pass it with the path accountId straight to the service. (Auth enforcement on
 * {@code /api/**} is covered by SecurityConfig; there is no MockMvc style in this project.)
 */
class ConnectionCapabilityControllerTest {

    private final ConnectionCapabilityService service = mock(ConnectionCapabilityService.class);
    private final ConnectionCapabilityController controller = new ConnectionCapabilityController(service);

    @Test
    void delegatesWithPrincipalOrgAndPathAccount() {
        UUID orgId = UUID.randomUUID();
        UUID accountId = UUID.randomUUID();
        AuthPrincipal principal = new AuthPrincipal(UUID.randomUUID(), orgId, "op@example.com");
        ConnectionCapabilityView view = new ConnectionCapabilityView(
                accountId, "NAVER", "CONNECTED", true, true,
                NaverCapabilityEvaluator.SYNC_STATUS_SUCCESS, NaverCapabilityEvaluator.AVAILABLE, null,
                List.of());
        when(service.capability(orgId, accountId)).thenReturn(view);

        ConnectionCapabilityView result = controller.connectionCapability(principal, accountId);

        assertThat(result).isSameAs(view);
        verify(service).capability(orgId, accountId);
    }
}
