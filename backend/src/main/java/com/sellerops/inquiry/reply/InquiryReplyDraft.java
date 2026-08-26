package com.sellerops.inquiry.reply;

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
import org.hibernate.annotations.Check;

/**
 * One immutable version of a seller's ESM answer reply-draft for a work item.
 *
 * <p><b>Append-only:</b> a draft is never updated in place — an edit inserts the
 * next {@code version}, so a prior version can never change and (later) an approval
 * can bind immutably to one version's {@link #contentFingerprint}. Consequently
 * this entity has NO {@code updated_at} and does NOT extend {@code BaseEntity}.
 *
 * <p><b>Minimal identity:</b> only {@code org_id} + {@code work_item_id} + {@code
 * version}; the inquiry/proposal are reachable via the work item, so there is no
 * redundant {@code inquiry_id}/{@code proposal_id}. It stores ONLY the seller-owned
 * answer fields — never a token, {@code messageNo}, author, or buyer data.
 * {@code answer_status} is backend-fixed to {@code 2} (the check allows the ESM
 * reply set {@code 1,2}).
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_reply_draft",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_inquiry_reply_draft_work_item_version",
                columnNames = {"work_item_id", "version"}))
@Check(name = "chk_inquiry_reply_draft_version", constraints = "version > 0")
@Check(name = "chk_inquiry_reply_draft_answer_status", constraints = "answer_status in (1, 2)")
public class InquiryReplyDraft {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    @Column(name = "version", nullable = false)
    private int version;

    /** Backend-fixed to {@code 2} (EsmCsReplyAnswerStatus); the seller never sets it. */
    @Column(name = "answer_status", nullable = false)
    private int answerStatus;

    @Column(name = "title", nullable = false, columnDefinition = "text")
    private String title;

    @Column(name = "comments", nullable = false, columnDefinition = "text")
    private String comments;

    @Column(name = "content_fingerprint", nullable = false, length = 64)
    private String contentFingerprint;

    @Column(name = "fingerprint_algorithm", nullable = false, length = 40)
    private String fingerprintAlgorithm;

    /**
     * Who wrote this version — {@link com.sellerops.inquiry.draft.DraftAuthorKind}. Null on rows
     * written before Inquiry Draft v1, which were all seller-authored; read as SELLER by the view
     * rather than backfilled, since a guessed provenance is worse than a dated one.
     */
    @Column(name = "author_kind", length = 24)
    private String authorKind;

    /**
     * The exact model+prompt version behind a MODEL draft; null for SELLER and RULE.
     *
     * <p>Since Organization Answer Style v1 it also carries which wording produced the version —
     * {@code …+style/v3@8f1c0a2b4d6e}, a counter and a digest of the profile. 200 rather than 120
     * because the measured stamp reaches ~115 on the shipped configuration and past 120 on a longer
     * vendor model id, and the repair for an overflowing provenance string must never be to cut it.
     */
    @Column(name = "model_version", length = 200)
    private String modelVersion;

    /**
     * What the product-knowledge library could offer this version
     * ({@link com.sellerops.inquiry.draft.DraftKnowledgeState}). Present on generated versions only.
     */
    @Column(name = "knowledge_state", length = 24)
    private String knowledgeState;

    /**
     * What this version WAS, at the moment it was written
     * ({@link com.sellerops.inquiry.draft.AnswerBasisState}).
     *
     * <p>Not derivable from {@link #knowledgeState} alone: the same library verdict yields
     * {@code GROUNDED} or {@code NEEDS_CLARIFICATION} depending on whether the customer settled their
     * 규격, and that is a fact about the QUESTION which this table does not otherwise hold. Without it
     * a reload could show a reply that asks the customer something as though it answered them.
     *
     * <p>Null on every version written before 2026-08-27, and never backfilled — a state invented by
     * a migration cannot afterwards be told apart from one that was observed.
     */
    @Column(name = "answer_basis", length = 24)
    private String answerBasis;

    /** The canonical product this draft was written about, when one resolved. */
    @Column(name = "product_id")
    private UUID productId;

    /** System/actor tag of who saved this version (e.g. {@code SELLER:<userId>}) — no PII. */
    @Column(name = "created_by", nullable = false, length = 120)
    private String createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
