package com.sellerops.auth.social;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Deletes expired {@code auth_handoffs}. A spent or expired row is useless to anyone, but it still carries the
 * provider email + display name of every social sign-in; nothing keeps that around past its TTL.
 * Runs in every deployment (no flag): it touches only rows whose {@code expires_at} has passed.
 */
@Component
@EnableScheduling
public class AuthHandoffJanitor {

    private static final Logger log = LoggerFactory.getLogger(AuthHandoffJanitor.class);

    private final SocialAuthService socialAuth;

    public AuthHandoffJanitor(SocialAuthService socialAuth) {
        this.socialAuth = socialAuth;
    }

    @Scheduled(initialDelayString = "${sellerops.oauth.purge-initial-delay-ms:300000}",
            fixedDelayString = "${sellerops.oauth.purge-interval-ms:900000}")
    public void purge() {
        int removed = socialAuth.purgeExpired();
        if (removed > 0) {
            log.info("auth handoffs purged: {}", removed);
        }
    }
}
