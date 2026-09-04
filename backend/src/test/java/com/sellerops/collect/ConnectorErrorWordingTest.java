package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ConnectorErrorWordingTest {

    @Test
    @DisplayName("the one documented NAVER code names the IP, and never asks for a credential")
    void ipNotAllowedIsAboutTheIp() {
        String s = ConnectorErrorWording.sellerSentence("NAVER token endpoint refused: GW.IP_NOT_ALLOWED (HTTP 403)");
        assertThat(s).contains("호출 IP").doesNotContain("다시 연결").doesNotContain("GW.");
    }

    @Test
    void noCodeEverReachesTheSentence() {
        for (String raw : new String[] {"GW.AUTHN", "HTTP 403", "HTTP 429 GW.RATE_LIMIT", "GW.TIMEOUT.01",
                "java.net.ConnectException: Connection refused", "something nobody mapped"}) {
            String s = ConnectorErrorWording.sellerSentence(raw);
            assertThat(s).isNotBlank().doesNotContain("GW.").doesNotContain("HTTP").doesNotContain("Exception");
        }
        assertThat(ConnectorErrorWording.sellerSentence(null)).isNull();
        assertThat(ConnectorErrorWording.sellerSentence(" ")).isNull();
    }
}
