package com.sellerops.itemanalysis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.itemanalysis.dto.ItemAnalysisView;
import com.sellerops.itemanalysis.dto.RunResult;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The controller is a thin shell: it must pass the JWT principal's orgId straight
 * through to the service and return its result unchanged. (The project has no
 * MockMvc style; auth enforcement on /api/** is covered by SecurityConfig.)
 */
class ItemAnalysisControllerTest {

    private final ItemAnalysisService service = mock(ItemAnalysisService.class);
    private final ItemAnalysisController controller = new ItemAnalysisController(service);
    private final UUID orgId = UUID.randomUUID();
    private final AuthPrincipal principal = new AuthPrincipal(UUID.randomUUID(), orgId, "op@example.com");

    @Test
    void runDelegatesWithPrincipalOrgId() {
        when(service.run(orgId)).thenReturn(new RunResult(3, 1));

        RunResult result = controller.run(principal);

        assertThat(result.analyzed()).isEqualTo(3);
        assertThat(result.skipped()).isEqualTo(1);
        verify(service).run(orgId);
    }

    @Test
    void listDelegatesWithPrincipalOrgId() {
        when(service.list(orgId)).thenReturn(List.<ItemAnalysisView>of());

        List<ItemAnalysisView> result = controller.list(principal);

        assertThat(result).isEmpty();
        verify(service).list(orgId);
    }
}
