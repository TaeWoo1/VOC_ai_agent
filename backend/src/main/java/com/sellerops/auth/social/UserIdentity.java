package com.sellerops.auth.social;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A social identity bound to a SellerOps user. The identity is {@code (provider, providerSubject)} — never
 * the email (docs/auth_growth_instrumentation_v1.md §2-2). {@code email} is what the provider reported at
 * link time, kept for display only.
 */
@Getter
@Setter
@Entity
@Table(name = "user_identities",
        uniqueConstraints = @UniqueConstraint(name = "uq_user_identities_provider_subject",
                columnNames = {"provider", "provider_subject"}))
public class UserIdentity extends BaseEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 20)
    private String provider;

    @Column(name = "provider_subject", nullable = false)
    private String providerSubject;

    @Column
    private String email;
}
