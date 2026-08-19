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

    /** Free-form role string (e.g. OWNER, OPERATOR). */
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
