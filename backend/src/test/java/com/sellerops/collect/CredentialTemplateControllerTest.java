package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.collect.dto.CredentialTemplateView;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The controller is a thin shell: it must pass the path code straight through to
 * the service and return its result unchanged. (The project has no MockMvc style;
 * auth enforcement on /api/** is covered by SecurityConfig.)
 */
class CredentialTemplateControllerTest {

    private final CredentialTemplateService service = mock(CredentialTemplateService.class);
    private final CredentialTemplateController controller = new CredentialTemplateController(service);

    @Test
    void delegatesToServiceWithPathCode() {
        CredentialTemplateView view =
                new CredentialTemplateView("NAVER", "API", "API_KEY", List.of(), "notes");
        when(service.credentialTemplate("NAVER")).thenReturn(view);

        CredentialTemplateView result = controller.credentialTemplate("NAVER");

        assertThat(result).isSameAs(view);
        verify(service).credentialTemplate("NAVER");
    }
}
