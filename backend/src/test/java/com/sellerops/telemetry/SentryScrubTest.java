package com.sellerops.telemetry;

import static org.assertj.core.api.Assertions.assertThat;

import io.sentry.Breadcrumb;
import io.sentry.SentryEvent;
import io.sentry.protocol.Message;
import io.sentry.protocol.Request;
import io.sentry.protocol.SentryException;
import io.sentry.protocol.User;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** docs/service_readiness_v1.md §2-1: nothing that identifies a person or authorizes a call leaves the JVM. */
class SentryScrubTest {

    @Test
    void requestQueryHeadersCookiesBodyAndUserAreRemoved() {
        SentryEvent event = new SentryEvent();
        Request req = new Request();
        req.setUrl("https://app/api/auth/social/exchange?code=abc#frag");
        req.setQueryString("code=abc");
        req.setCookies("JSESSIONID=x");
        req.setData("{\"password\":\"p\"}");
        Map<String, String> headers = new HashMap<>();
        headers.put("Authorization", "Bearer eyJhbGciOi.xxxx.yyyy");
        headers.put("Cookie", "a=b");
        headers.put("Accept", "application/json");
        req.setHeaders(headers);
        event.setRequest(req);
        User user = new User();
        user.setEmail("seller@x.io");
        event.setUser(user);
        Breadcrumb crumb = new Breadcrumb();
        crumb.setData("url", "https://app/reset-password?token=abc");
        crumb.setData("http.query", "token=abc");
        crumb.setData("from", "/reset-password?token=abc");
        crumb.setData("to", "/login?reset=1");
        crumb.setMessage("Bearer abcdefghijkl and token=xyz");
        event.setBreadcrumbs(new ArrayList<>(List.of(crumb)));

        SentryScrub.scrubEvent(event, null);

        assertThat(event.getUser()).isNull();
        assertThat(event.getRequest().getUrl()).isEqualTo("https://app/api/auth/social/exchange");
        assertThat(event.getRequest().getQueryString()).isNull();
        assertThat(event.getRequest().getCookies()).isNull();
        assertThat(event.getRequest().getData()).isNull();
        assertThat(event.getRequest().getHeaders()).containsOnlyKeys("Accept");
        Breadcrumb scrubbed = event.getBreadcrumbs().get(0);
        assertThat(scrubbed.getData("url")).isEqualTo("https://app/reset-password");
        assertThat(scrubbed.getData("http.query")).isNull();
        assertThat(scrubbed.getData("from")).isEqualTo("/reset-password");
        assertThat(scrubbed.getData("to")).isEqualTo("/login");
        assertThat(scrubbed.getMessage()).doesNotContain("abcdefghijkl").doesNotContain("xyz");
    }

    @Test
    void secretShapedTextInMessagesAndExceptionValuesIsRedacted() {
        SentryEvent event = new SentryEvent();
        Message m = new Message();
        m.setFormatted("failed: GET /x?token=SECRET&code=OTHER Bearer AAAAAAAAAAAA");
        event.setMessage(m);
        SentryException ex = new SentryException();
        ex.setValue("bad access_token=abcdef");
        event.setExceptions(new ArrayList<>(List.of(ex)));

        SentryScrub.scrubEvent(event, null);

        assertThat(event.getMessage().getFormatted()).doesNotContain("SECRET").doesNotContain("OTHER").doesNotContain("AAAAAAAAAAAA")
                .contains("token=[redacted]").contains("bearer [redacted]");
        assertThat(event.getExceptions().get(0).getValue()).isEqualTo("bad access_token=[redacted]");
        // A DB unique-key detail carries the seller's email — redacted as well (review S3).
        assertThat(SentryScrub.scrubText("ERROR: duplicate key value violates unique constraint \"users_email_key\" Detail: Key (email)=(Seller.One@Example.co.kr) already exists."))
                .doesNotContain("Seller.One").contains("Key (email)=([email])");
        assertThat(SentryScrub.scrubText("plain 이메일 또는 비밀번호가 올바르지 않습니다")).isEqualTo("plain 이메일 또는 비밀번호가 올바르지 않습니다");
        assertThat(SentryScrub.stripQuery("/a?b=c")).isEqualTo("/a");
        assertThat(SentryScrub.stripQuery(null)).isNull();
    }
}
