package com.sellerops.telemetry;

import io.sentry.Breadcrumb;
import io.sentry.Hint;
import io.sentry.SentryBaseEvent;
import io.sentry.SentryEvent;
import io.sentry.SentryOptions;
import io.sentry.protocol.Request;
import io.sentry.protocol.SentryException;
import io.sentry.protocol.SentryTransaction;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Sentry PII / secret scrubbing — docs/service_readiness_v1.md §2-1. Applied to every event and transaction
 * before it leaves the JVM (Sentry's Spring starter picks these beans up). Removes: request query strings and
 * bodies, cookies, `Authorization`/`Cookie`/`Set-Cookie` headers, the user (entirely — not even the id),
 * breadcrumb URLs' query parts, and bearer / `code=` / `token=` shaped fragments in messages. Nothing here
 * depends on a DSN being set; with no DSN the callbacks are simply never called.
 */
@Configuration
public class SentryScrub {

    static final Pattern SECRET_SHAPED = Pattern.compile(
            "(?i)(bearer\\s+[A-Za-z0-9._~+/=-]{8,}|([?&]|\\b)(code|token|onboardingToken|access_token|refresh_token|client_secret|password)=[^&\\s]*)");
    private static final List<String> HEADER_DROP = List.of("authorization", "cookie", "set-cookie", "x-api-key");

    @Bean
    public SentryOptions.BeforeSendCallback sentryBeforeSend() {
        return (event, hint) -> scrubEvent(event, hint);
    }

    @Bean
    public SentryOptions.BeforeSendTransactionCallback sentryBeforeSendTransaction() {
        return (transaction, hint) -> scrubTransaction(transaction, hint);
    }

    static SentryEvent scrubEvent(SentryEvent event, Hint hint) {
        scrubBase(event);
        if (event.getMessage() != null && event.getMessage().getFormatted() != null) {
            event.getMessage().setFormatted(scrubText(event.getMessage().getFormatted()));
            event.getMessage().setMessage(scrubText(event.getMessage().getMessage()));
        }
        List<SentryException> exceptions = event.getExceptions();
        if (exceptions != null) {
            for (SentryException ex : exceptions) {
                ex.setValue(scrubText(ex.getValue()));
            }
        }
        return event;
    }

    static SentryTransaction scrubTransaction(SentryTransaction transaction, Hint hint) {
        scrubBase(transaction);
        return transaction;
    }

    private static void scrubBase(SentryBaseEvent event) {
        event.setUser(null);
        Request request = event.getRequest();
        if (request != null) {
            request.setQueryString(null);
            request.setCookies(null);
            request.setData(null);
            request.setUrl(stripQuery(request.getUrl()));
            Map<String, String> headers = request.getHeaders();
            if (headers != null) {
                headers.keySet().removeIf(k -> HEADER_DROP.contains(k.toLowerCase(Locale.ROOT)));
            }
        }
        List<Breadcrumb> crumbs = event.getBreadcrumbs();
        if (crumbs != null) {
            for (Breadcrumb b : new ArrayList<>(crumbs)) {
                Object url = b.getData("url");
                if (url instanceof String s) {
                    b.setData("url", stripQuery(s));
                }
                b.removeData("http.query");
                b.removeData("http.fragment");
                if (b.getMessage() != null) {
                    b.setMessage(scrubText(b.getMessage()));
                }
            }
        }
    }

    static String stripQuery(String url) {
        if (url == null) {
            return null;
        }
        int q = url.indexOf('?');
        int h = url.indexOf('#');
        int cut = q < 0 ? h : (h < 0 ? q : Math.min(q, h));
        return cut < 0 ? url : url.substring(0, cut);
    }

    static String scrubText(String text) {
        if (text == null) {
            return null;
        }
        return SECRET_SHAPED.matcher(text).replaceAll(m -> m.group(1).toLowerCase(Locale.ROOT).startsWith("bearer")
                ? "bearer [redacted]" : (m.group(2) == null ? "" : m.group(2)) + m.group(3) + "=[redacted]");
    }
}
