package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.product.detail.ChannelAccessRefused;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Observed live (2026-09-18, Catalogue KB live read): the token endpoint answered {@code GW.IP_NOT_ALLOWED} and the
 * bootstrap went on to ask for 37 more listings, each minting a token the gateway refused. The refusal is now typed at
 * the source so the caller can stop at the first one.
 */
class NaverProductDetailSourceRefusalTest {

    @Test
    @DisplayName("GW.IP_NOT_ALLOWED at the token endpoint surfaces as ChannelAccessRefused(ENVIRONMENT_NOT_ALLOWED)")
    void ipRefusalIsTyped() {
        NaverHttpClient http = mock(NaverHttpClient.class);
        when(http.postForm(any(), any())).thenReturn(new NaverHttpClient.Response(403,
                "{\"code\":\"GW.IP_NOT_ALLOWED\",\"message\":\"x\"}", Map.of()));
        NaverTokenClient tokens = new NaverTokenClient(http, java.time.Clock.systemUTC(), "https://api.commerce.naver.com");
        CredentialVault vault = mock(CredentialVault.class);
        DecryptedCredential credential = mock(DecryptedCredential.class);
        when(credential.secrets()).thenReturn(Map.of("client_id", "id",
                "client_secret", "$2a$04$abcdefghijklmnopqrstuu"));
        when(vault.open(any(), any())).thenReturn(credential);
        NaverProductDetailSource source = new NaverProductDetailSource(tokens,
                new NaverChannelProductClient(http, "https://api.commerce.naver.com"), vault);

        assertThatThrownBy(() -> source.read(UUID.randomUUID(), UUID.randomUUID(), "123"))
                .isInstanceOfSatisfying(ChannelAccessRefused.class, e ->
                        assertThat(e.reason()).isEqualTo(ChannelAccessRefused.Reason.ENVIRONMENT_NOT_ALLOWED));
    }
}
