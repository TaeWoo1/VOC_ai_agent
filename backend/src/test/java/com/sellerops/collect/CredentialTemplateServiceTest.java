package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.collect.dto.CredentialTemplateView;
import com.sellerops.common.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class CredentialTemplateServiceTest {

    private final CredentialTemplateService service = new CredentialTemplateService();

    @Test
    void returnsViewForSupportedChannel() {
        CredentialTemplateView view = service.credentialTemplate("NAVER");

        assertThat(view.channelCode()).isEqualTo("NAVER");
        assertThat(view.authType()).isEqualTo("API_KEY");
        assertThat(view.fields()).extracting(CredentialTemplateView.CredentialFieldView::key)
                .containsExactly("client_id", "client_secret");
    }

    @Test
    void unsupportedChannelIsNotFound() {
        assertThatThrownBy(() -> service.credentialTemplate("FILE_UPLOAD"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));

        assertThatThrownBy(() -> service.credentialTemplate("NOPE"))
                .isInstanceOf(ApiException.class);
    }
}
