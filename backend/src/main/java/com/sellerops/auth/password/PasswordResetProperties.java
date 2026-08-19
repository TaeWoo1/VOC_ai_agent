package com.sellerops.auth.password;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** `sellerops.password-reset.*` + the public base URL the mailed link is built from (docs/service_readiness_v1.md §5). */
@Component
public class PasswordResetProperties {

    private final Duration ttl;
    private final String publicBaseUrl;

    public PasswordResetProperties(@Value("${sellerops.password-reset.ttl-seconds:1800}") long ttlSeconds,
                                   @Value("${sellerops.public-base-url:http://localhost:5173}") String publicBaseUrl) {
        this.ttl = Duration.ofSeconds(ttlSeconds);
        this.publicBaseUrl = publicBaseUrl == null ? "" : publicBaseUrl.trim().replaceAll("/+$", "");
    }

    public Duration ttl() {
        return ttl;
    }

    /** Absolute URL of a frontend path, e.g. {@code /reset-password?token=…}. */
    public String publicUrl(String path) {
        return publicBaseUrl + path;
    }
}
