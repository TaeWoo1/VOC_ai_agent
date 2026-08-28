package com.sellerops.review.channel;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * An opaque, single-use, short-lived token binding one {@code REVIEW_ACQUISITION} Action Window run to
 * one seller account — V85, the acquisition twin of {@link ChannelReviewLocateRef}.
 *
 * <p>The seller's browser carries only this token into {@code START_RUN}; the Local Agent spends it over
 * its own JWT and learns which account's WING 상품평 screen to read. The reviews themselves still arrive
 * through the existing handoff ({@code POST /api/agent/review-handoff}, method {@code SELLER_CENTER_READ});
 * nothing here carries a review.
 *
 * <p>Append-only, so it does NOT extend {@code BaseEntity}; the one mutation it admits is being spent
 * ({@link #consumedAt}), by a conditional UPDATE so two resolves cannot both win.
 */
@Getter
@Setter
@Entity
@Table(name = "channel_review_acquisition_ref",
        uniqueConstraints = @UniqueConstraint(name = "uq_channel_review_acquisition_ref_ref",
                columnNames = {"acquisition_ref"}))
public class ChannelReviewAcquisitionRef {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    /** Opaque 16-hex token; UNIQUE. */
    @Column(name = "acquisition_ref", nullable = false, length = 16)
    private String acquisitionRef;

    /** Actor tag ({@code SELLER:<userId>}) — no PII. */
    @Column(name = "created_by", nullable = false, length = 120)
    private String createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    /** Null until resolved. Set exactly once. */
    @Column(name = "consumed_at")
    private Instant consumedAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
