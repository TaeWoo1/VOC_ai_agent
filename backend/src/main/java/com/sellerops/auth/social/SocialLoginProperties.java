package com.sellerops.auth.social;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Which social providers this deployment offers. A provider exists only when the deployer configured its
 * client id + secret before service start (docs/auth_growth_instrumentation_v1.md §2-4, §8); the seller never
 * sees these values, and the frontend renders a button only for a provider that is here.
 */
@Component
public class SocialLoginProperties {

    public static final String GOOGLE = "google";
    public static final String NAVER = "naver";

    private final String googleClientId;
    private final String googleClientSecret;
    private final String naverClientId;
    private final String naverClientSecret;
    private final String frontendBaseUrl;
    private final int codeTtlSeconds;
    private final int onboardingTtlSeconds;

    public SocialLoginProperties(
            @Value("${sellerops.oauth.google.client-id:}") String googleClientId,
            @Value("${sellerops.oauth.google.client-secret:}") String googleClientSecret,
            @Value("${sellerops.oauth.naver.client-id:}") String naverClientId,
            @Value("${sellerops.oauth.naver.client-secret:}") String naverClientSecret,
            @Value("${sellerops.oauth.frontend-base-url:}") String frontendBaseUrl,
            @Value("${sellerops.oauth.code-ttl-seconds:120}") int codeTtlSeconds,
            @Value("${sellerops.oauth.onboarding-ttl-seconds:1800}") int onboardingTtlSeconds) {
        this.googleClientId = blankToNull(googleClientId);
        this.googleClientSecret = blankToNull(googleClientSecret);
        this.naverClientId = blankToNull(naverClientId);
        this.naverClientSecret = blankToNull(naverClientSecret);
        this.frontendBaseUrl = stripTrailingSlash(frontendBaseUrl == null ? "" : frontendBaseUrl.trim());
        this.codeTtlSeconds = codeTtlSeconds;
        this.onboardingTtlSeconds = onboardingTtlSeconds;
    }

    public boolean googleConfigured() {
        return googleClientId != null && googleClientSecret != null;
    }

    public boolean naverConfigured() {
        return naverClientId != null && naverClientSecret != null;
    }

    public boolean anyConfigured() {
        return googleConfigured() || naverConfigured();
    }

    /** provider → configured, in display order. Public: what the login page asks before drawing buttons. */
    public Map<String, Boolean> availability() {
        Map<String, Boolean> map = new LinkedHashMap<>();
        map.put(GOOGLE, googleConfigured());
        map.put(NAVER, naverConfigured());
        return map;
    }

    public String googleClientId() { return googleClientId; }
    public String googleClientSecret() { return googleClientSecret; }
    public String naverClientId() { return naverClientId; }
    public String naverClientSecret() { return naverClientSecret; }
    public int codeTtlSeconds() { return codeTtlSeconds; }
    public int onboardingTtlSeconds() { return onboardingTtlSeconds; }

    /** Frontend path → absolute or relative redirect target ("" base = same public origin). */
    public String frontendUrl(String path) {
        return frontendBaseUrl + path;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String stripTrailingSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }
}
