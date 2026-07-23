package com.sellerops.itemanalysis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.itemanalysis.dto.ItemAnalysisView;
import com.sellerops.itemanalysis.dto.LookupRequest;
import com.sellerops.itemanalysis.dto.LookupRequest.SourceRef;
import com.sellerops.itemanalysis.dto.ReanalysisResult;
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

    @Test
    void lookupDelegatesWithPrincipalOrgIdAndBodyItems() {
        List<SourceRef> items = List.of(new SourceRef("REVIEW", UUID.randomUUID()));
        when(service.lookup(orgId, items)).thenReturn(List.<ItemAnalysisView>of());

        List<ItemAnalysisView> result = controller.lookup(principal, new LookupRequest(items));

        assertThat(result).isEmpty();
        verify(service).lookup(orgId, items);
    }

    @Test
    void reanalyzeDefaultsToADryRunSoTheForgetfulCallIsTheHarmlessOne() {
        // The parameter an operator omits must be the one that writes nothing. Reversed, a curious
        // GET-turned-POST would rewrite an org's whole analysis corpus.
        ReanalysisResult preview = preview();
        when(service.previewReanalysis(orgId, 500)).thenReturn(preview);

        assertThat(controller.reanalyze(principal, 500, true)).isSameAs(preview);
        verify(service).previewReanalysis(orgId, 500);
        verify(service, never()).reanalyzeOutdated(any(), anyInt());
    }

    @Test
    void reanalyzeAppliesOnlyWhenDryRunIsExplicitlyFalse() {
        ReanalysisResult applied = new ReanalysisResult(false, 1, 1, 0, 0, 0L, 0L,
                new ReanalysisResult.FieldChanges(1, 0, 0, 0), List.of());
        when(service.reanalyzeOutdated(orgId, 10)).thenReturn(applied);

        assertThat(controller.reanalyze(principal, 10, false)).isSameAs(applied);
        verify(service).reanalyzeOutdated(orgId, 10);
        verify(service, never()).previewReanalysis(any(), anyInt());
    }

    private static ReanalysisResult preview() {
        return new ReanalysisResult(true, 2, 1, 1, 0, 2L, 0L,
                new ReanalysisResult.FieldChanges(1, 0, 0, 0), List.of());
    }

    @Test
    void lookupToleratesNullBody() {
        when(service.lookup(orgId, null)).thenReturn(List.<ItemAnalysisView>of());

        List<ItemAnalysisView> result = controller.lookup(principal, null);

        assertThat(result).isEmpty();
        verify(service).lookup(orgId, null);
    }
}
