package com.sellerops.customermemory;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One indexed customer utterance — an inquiry or a review — described ONLY in closed vocabulary.
 *
 * <p><b>No customer text lives on this entity and none can.</b> There is no body column, no title
 * column, and no answer column. {@link #topic} is an {@code item_analyses.category} value and
 * {@link #signatureKey} is an {@code aspect|problem} pair from the existing
 * {@code IssueSignatureExtractor} — both are vocabularies the product already prints on screen. The
 * customer's own words stay in {@code inquiries}/{@code reviews} and are read only on the authorized
 * detail surfaces; the past ANSWER is re-resolved at read time from {@code inquiry_reply_drafts}
 * rather than copied here. This mirrors the rule {@code IssueSignature} states for the issue memory:
 * extraction is where customer text stops.
 *
 * <p>{@link #productId} being null is <b>information, not absence</b>: it means the source row was
 * never linked to a product (Cafe24 promoted reviews carry no product; Coupang review rows are on an
 * option-id axis). Callers must report that as unlinked coverage instead of folding it away — the
 * same discipline {@code IssueEvidenceSummaryView.unattributedEvidence} already keeps.
 */
@Getter
@Setter
@Entity
@Table(name = "customer_memory_entries")
public class CustomerMemoryEntry extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Enumerated(EnumType.STRING)
    @Column(name = "entry_kind", nullable = false, length = 16)
    private CustomerMemoryKind entryKind;

    /** {@code inquiries.id} or {@code reviews.id}. Not a FK — see V47's header. */
    @Column(name = "source_id", nullable = false)
    private UUID sourceId;

    @Column(name = "channel_id")
    private UUID channelId;

    /** {@code products.id}, or null when the source row was never linked to a product. */
    @Column(name = "product_id")
    private UUID productId;

    /** {@code item_analyses.category} (closed vocabulary), or null when no analysis row exists. */
    @Column(name = "topic", length = 32)
    private String topic;

    /** {@code aspect|problem} (closed vocabulary), or null when no signature matched. */
    @Column(name = "signature_key", length = 96)
    private String signatureKey;

    /** Severity the problem vocabulary fixes for {@link #signatureKey}, or null. */
    @Column(name = "severity", length = 16)
    private String severity;

    @Column(name = "occurred_on", nullable = false)
    private LocalDate occurredOn;

    /** INQUIRY only: whether the inquiry is already answered. Reviews store false. */
    @Column(name = "answered", nullable = false)
    private boolean answered;

    /**
     * Which extractor produced {@link #signatureKey} — {@code RULE_BASED} or {@code SEMANTIC}.
     *
     * <p>Carried for the reason {@code review_issues.extractor_kind} is (V31): a later extractor emits
     * different keys for the same utterance, and its rows must be able to coexist with the earlier
     * ones rather than silently redefining what a signature means. Null on rows written before
     * provenance existed, which is itself the honest statement about them.
     */
    @Column(name = "extractor_kind", length = 24)
    private String extractorKind;

    @Column(name = "extractor_version", length = 32)
    private String extractorVersion;
}
