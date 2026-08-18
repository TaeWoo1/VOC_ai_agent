package com.sellerops.auth.social;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A one-time handoff minted by the OAuth success handler. The browser only ever carries the random code;
 * the row stores its SHA-256 and is spent by {@code consumed_at} — a JWT is never in a URL
 * (docs/auth_growth_instrumentation_v1.md §2-1, §2-3).
 */
@Getter
@Setter
@Entity
@Table(name = "auth_handoffs")
public class AuthHandoff extends BaseEntity {

    public enum Purpose {
        /** Identity already linked: the code exchanges for the existing JWT. */
        SESSION,
        /** First-time identity: the URL-borne code exchanges for an ONBOARDING_TOKEN. */
        ONBOARDING,
        /** Body-only token the onboarding form spends: complete → org + user + identity. */
        ONBOARDING_TOKEN
    }

    @Column(name = "code_hash", nullable = false, unique = true, length = 64)
    private String codeHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Purpose purpose;

    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false, length = 20)
    private String provider;

    @Column(name = "provider_subject", nullable = false)
    private String providerSubject;

    @Column
    private String email;

    @Column(name = "display_name", length = 120)
    private String displayName;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;
}
