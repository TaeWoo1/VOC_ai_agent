package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * The shape check is the safety property here, not the parsing. A gateway code is safe to put in a
 * log line because it is one of a closed, documented set of constants; a value that merely happens to
 * sit under a key named {@code code} is not, and this class is what keeps the two apart.
 */
class NaverGatewayCodeTest {

    @Test
    void readsTheDocumentedEnvelopeShape() {
        // Verbatim shape from docs/vendor/naver-commerce-api/intro-troubleshooting.md.
        String body = "{\"timestamp\":\"2022-01-26T14:32:19.983+09:00\",\"code\":\"GW.TIMEOUT.01\","
                + "\"message\":\"요청 대기 시간이 초과되었습니다.\","
                + "\"traceId\":\"ar2-55f4fd5f54-mwk8w^1643182339983^366577\"}";

        assertThat(NaverGatewayCode.of(body)).isEqualTo("GW.TIMEOUT.01");
    }

    @Test
    void refusesAnythingNotShapedLikeACode() {
        // Free text, a lower-case sentence, and an over-long value are all things that could carry
        // content rather than a constant — none of them may travel out of here.
        assertThat(NaverGatewayCode.of("{\"code\":\"주문자 홍길동 님의 요청\"}")).isNull();
        assertThat(NaverGatewayCode.of("{\"code\":\"not a code\"}")).isNull();
        assertThat(NaverGatewayCode.of("{\"code\":\"" + "A".repeat(49) + "\"}")).isNull();
        assertThat(NaverGatewayCode.of("{\"code\":{\"nested\":\"x\"}}")).isNull();
        assertThat(NaverGatewayCode.of("{\"code\":\"\"}")).isNull();
    }

    @Test
    void returnsNullRatherThanThrowingOnAnythingUnreadable() {
        assertThat(NaverGatewayCode.of(null)).isNull();
        assertThat(NaverGatewayCode.of("")).isNull();
        assertThat(NaverGatewayCode.of("<html>gateway</html>")).isNull();
        assertThat(NaverGatewayCode.of("{\"message\":\"no code field\"}")).isNull();
    }
}
