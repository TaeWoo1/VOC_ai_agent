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
 * An opaque, single-use, short-lived token binding one {@code REVIEW_LOCATE} Action Window run to one
 * stored review.
 *
 * <p><b>Why a ref for a run that only draws a ring.</b> Coupang publishes no review id, so a stored
 * review is re-found on the live screen by everything that agrees — 노출상품ID, 옵션ID, 등록일, 별점, and a
 * one-way fingerprint of the body. Those fields together describe one buyer's review, which is precisely
 * what the Action Window contract forbids on the wire. The frontend therefore carries only this token
 * into {@code START_RUN}, and the Local Agent resolves it over its own authenticated backend session.
 *
 * <p><b>Single-use, and spent on resolve.</b> The run holds the resolved target for its lifetime, so the
 * seller re-checking after they turn a page needs no second resolve. A token that outlived its run would
 * be a re-usable handle to one buyer's review; {@link #consumedAt} closes it the first time it is used and
 * {@link #expiresAt} closes it even if nobody ever does.
 *
 * <p><b>Append-only, so it does NOT extend {@code BaseEntity}</b> and carries no {@code updated_at} — the
 * one mutation it admits is being spent. Same shape and reasoning as {@code ReviewReplySubmissionRef}; no
 * {@code seller_account_id} / {@code channel_id}, per V19/V20 (the channel is checked at mint time
 * instead of stored).
 */
@Getter
@Setter
@Entity
@Table(name = "channel_review_locate_ref",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_channel_review_locate_ref_ref",
                columnNames = {"locate_ref"}))
public class ChannelReviewLocateRef {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    /** Opaque 16-hex token; UNIQUE. Never a review id or any reversible value. */
    @Column(name = "locate_ref", nullable = false, length = 16)
    private String locateRef;

    /** Actor tag of whoever pressed 쿠팡에서 보기 (e.g. {@code SELLER:<userId>}) — no PII. */
    @Column(name = "created_by", nullable = false, length = 120)
    private String createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** The window between the press and the agent asking. Seconds in practice; minutes at the outside. */
    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    /** Null until resolved. Set exactly once — a second resolve finds it non-null and refuses. */
    @Column(name = "consumed_at")
    private Instant consumedAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
