package com.sellerops.user;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "users")
public class User extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(nullable = false, unique = true)
    private String email;

    /** Null for a social-only user (Google/NAVER sign-up) — password login is then refused. */
    @Column(name = "password_hash")
    private String passwordHash;

    @Column(nullable = false)
    private String name;

    /**
     * The account's role. <b>Every account this product creates is {@code OWNER}</b> — the two sign-up
     * paths and the demo seeder are the only writers and all three set that one value, so any other
     * value exists only if a row was inserted by hand (measured on the local database: 64 users, one
     * distinct role). It is a free-form string rather than an enum because no role model has been designed yet;
     * naming a second value here would read as one that exists (multi-user roles are out of v1 scope,
     * `docs/product-scope-v1.md`).
     */
    @Column(nullable = false)
    private String role;

    // Account consent record (docs/service_readiness_v1.md §2-4): 필수 이용약관·개인정보처리방침 동의 시각 + 문서
    // 버전, 선택 마케팅 수신 동의 시각 (null = 동의 안 함). Null on rows created before the record existed.
    @Column(name = "terms_accepted_at")
    private Instant termsAcceptedAt;

    @Column(name = "terms_version", length = 40)
    private String termsVersion;

    @Column(name = "marketing_consent_at")
    private Instant marketingConsentAt;
}
