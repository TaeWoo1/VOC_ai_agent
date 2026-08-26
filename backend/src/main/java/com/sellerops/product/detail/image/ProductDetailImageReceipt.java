package com.sellerops.product.detail.image;

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
 * "This picture has been through the model, and here is what it said."
 *
 * <p><b>Not a knowledge document.</b> Nothing here is retrievable, quotable or countable as the
 * seller's knowledge — which is exactly why it could not be an empty-bodied
 * {@code ProductKnowledgeSource}: that would have inflated 「등록된 지식 N건」 on the product screen by
 * 26 per product, making a screen say something untrue in order to save a table.
 *
 * <p><b>A zero-result reading is a result.</b> Most of a 상세페이지 states no specification, and the
 * expensive mistake is re-paying for that answer on every restart. So {@code NO_FACTS} and every
 * refusal are recorded exactly as {@code FACTS_EXTRACTED} is.
 *
 * <p><b>Why {@link #extraction} is durable.</b> The dangerous window is: model answers → receipt
 * written → process dies before the facts are published. With counts alone, the restart would skip
 * the call (the receipt says done) and the triples would be gone — paid for and lost. So the closed
 * triples are stored, and finalization is re-runnable from them. What is stored is only
 * {@code {"facts":[{specLabel,attribute,value}]}}: no raw OCR text, no reasoning, no prose.
 */
@Getter
@Setter
@Entity
@Table(name = "product_detail_image_receipt",
        // Declared on the entity as well as in the migration, because the two schemas have different
        // origins: deployments get theirs from Flyway, tests get theirs from the entity. A uniqueness
        // claim that exists in only one of them is a claim no test can fail on.
        uniqueConstraints = @jakarta.persistence.UniqueConstraint(
                name = "uq_image_receipt_identity",
                columnNames = {"org_id", "product_id", "image_sha256", "extractor_version",
                        "model_version"}))
public class ProductDetailImageReceipt extends BaseEntity {

    /** Where the reading is in its life. Distinct from {@link Outcome}, which is what came of it. */
    public enum Status {
        /** Queued and not yet started — the state the screen reads as 「확인 중입니다」. */
        PENDING,
        /**
         * A call was started. <b>On restart this is re-runnable, on purpose.</b> A row left here by a
         * crash cannot tell us whether the vendor was reached, and re-reading one picture costs a
         * fraction of a cent while wrongly skipping one loses a fact the seller's page states.
         */
        RUNNING,
        /** The model answered and the answer was readable. {@link #extraction} is present. */
        COMPLETED,
        /** No usable answer. Nothing is published from this picture. */
        FAILED
    }

    /** What came of the reading. Null until it finishes. */
    public enum Outcome {
        /** The picture states specifications and they were transcribed. */
        FACTS_EXTRACTED,
        /** The picture states no specification. A correct and expected answer for most images. */
        NO_FACTS,
        /** The answer did not match the closed schema. Refused rather than repaired. */
        OFF_SCHEMA,
        /** The vendor refused, timed out, or ran out of output budget. */
        MODEL_FAILED,
        /** The picture could not be fetched under the CDN policy. The model was never called. */
        FETCH_FAILED
    }

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    /**
     * The picture's BYTES, hashed — not its URL.
     *
     * <p>A CDN rewrites query strings while the picture stays the same; identity that moved with the
     * address would re-read the same image whenever the shop's cache key rotated.
     */
    @Column(name = "image_sha256", nullable = false, length = 64)
    private String imageSha256;

    @Column(name = "extractor_version", nullable = false, length = 200)
    private String extractorVersion;

    @Column(name = "model_version", nullable = false, length = 120)
    private String modelVersion;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status;

    @Enumerated(EnumType.STRING)
    @Column(length = 32)
    private Outcome outcome;

    @Column(name = "queued_at", nullable = false)
    private Instant queuedAt;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    /** The closed triples as JSON text. Written by {@code ProductDetailImageKnowledge} only. */
    @Column(columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private String extraction;

    @Column(name = "facts_accepted", nullable = false)
    private int factsAccepted;

    @Column(name = "facts_refused", nullable = false)
    private int factsRefused;

    /** Whether this reading can be reused instead of re-paying for the same picture. */
    public boolean reusable() {
        return status == Status.COMPLETED;
    }
}
