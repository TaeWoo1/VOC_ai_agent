package com.sellerops.organization.profile;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One row per organization, keyed BY the organization — the same shape as
 * {@code OrganizationAnswerStyle}, for the same reason: "a company has one profile" is a property of
 * the table, not a constraint somebody can drop.
 *
 * <p><b>Seller-authored only.</b> No model writes or rewrites this text; it exists because a person
 * typed it into the 회사 정보 screen. {@code SellerProfileFenceTest} pins the writer set by name.
 *
 * <p><b>No row is a real state.</b> Nothing creates one on signup and nothing backfills existing
 * companies; an org without one simply has no company context, and every reader treats that as
 * "nothing to say", never as an error.
 */
@Getter
@Setter
@Entity
@Table(name = "organization_profile")
public class OrganizationProfile {

    @Id
    @Column(name = "org_id", nullable = false, updatable = false)
    private UUID orgId;

    /** The seller's description of the company. Null when cleared; never blank. */
    @Column(name = "business_summary")
    private String businessSummary;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by")
    private UUID updatedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
