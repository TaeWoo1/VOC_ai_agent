package com.sellerops.attention.triage;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * The CURRENT triage decision on one ingested review — the first per-review operator state
 * to exist. Until now {@code reviews} was write-once at ingest with no companion state
 * table, so an operator could see a low-rating review on the attention surface and had
 * nowhere to record what they concluded about it.
 *
 * <p><b>Mutable current state, with the history beside it.</b> This row is updated in place
 * as an operator changes their mind; every transition is appended to
 * {@link ReviewTriageAudit}, which is never updated. Same split as
 * {@code InquiryWorkItem} / {@code InquiryWorkItemAudit}: one row answers "where does this
 * stand", the trail answers "how did it get there".
 *
 * <p><b>Keyed on the review, not on the signal.</b> {@code review_id} is UNIQUE, so a
 * review has exactly one decision no matter which attention lens surfaced it. This is
 * load-bearing rather than incidental: the signal types overlap by construction — a 2★
 * review matches both {@code LOW_RATING_REVIEW} (1–3★) and {@code NEW_REVIEW} (all) — so
 * keying on {@code (review, signalType)} would let one review carry two contradictory
 * decisions, and which one an operator saw would depend on the card they happened to click.
 * The decision is about the review; the signal is only how they found it.
 *
 * <p><b>No {@code seller_account_id}, deliberately.</b> {@code reviews} carries no account
 * (a file upload resolves none — {@code FileUploadConnector} passes null), so org+channel
 * is the finest identity this store actually has, and
 * {@code IngestedReviewVocItemSource} already refuses to answer per-account when an org
 * holds more than one account on a channel. Stamping an account here would record an
 * attribution the underlying data cannot support — inventing the very fact the read side
 * declines to guess. The account in the request path is how the caller is authorized and
 * how the channel is resolved; it is not a property of the decision. If account-scoped
 * ingest ever lands, this column can be added from real data instead of from a guess.
 *
 * <p>{@code channel_id} IS stored: it is the review's own channel, copied at decision time,
 * and it is what the read side scopes by.
 */
@Getter
@Setter
@Entity
@Table(name = "review_triage",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_review_triage_review",
                columnNames = {"review_id"}))
public class ReviewTriage extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    /** The reviewed row this decision is about; UNIQUE — one decision per review. */
    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    /** The review's channel, copied at decision time — the finest scope this store has. */
    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    @Enumerated(EnumType.STRING)
    @Column(name = "disposition", nullable = false, length = 32)
    private TriageDisposition disposition;

    /** Actor tag of whoever set the current disposition (e.g. {@code SELLER:<userId>}) — no PII. */
    @Column(name = "decided_by", nullable = false, length = 120)
    private String decidedBy;

    /**
     * When the CURRENT disposition was set — not when the row was last written.
     *
     * <p>Kept explicit rather than reusing {@code BaseEntity.updatedAt}, which is a
     * persistence mechanic: it moves on any write to this row, including one that has
     * nothing to do with the decision (a future column, a backfill). The two agree today
     * and would silently diverge later, so the meaning is stated rather than inferred.
     * Same reason {@code InquiryWorkItemDismissalBatch} carries {@code executed_at}
     * alongside the inherited timestamps.
     */
    @Column(name = "decided_at", nullable = false)
    private Instant decidedAt;
}
