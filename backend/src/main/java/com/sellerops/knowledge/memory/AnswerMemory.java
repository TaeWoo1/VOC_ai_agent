package com.sellerops.knowledge.memory;

import com.sellerops.common.BaseEntity;
import com.sellerops.common.DataOrigin;
import com.sellerops.common.RealDataOnly;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

/**
 * One answer the seller actually gave, kept so the next one can be consistent with it.
 *
 * <p><b>The customer's question is not here.</b> {@link #topicSignature} is what survives of it —
 * the words of the question that the seller's own writing also uses, digits removed
 * ({@code TopicSignature}). The body is the SELLER's text, which is the half of the exchange this
 * company authored and is about to author again.
 *
 * <p><b>{@link #originRef} is the identity.</b> One collected answer, one approval, one verified
 * send — each is a single fact, and re-running any of them must update the row rather than add a
 * second. Unique per org, so a re-import is idempotent and a re-collection cannot double the memory.
 */
@Getter
@Setter
@Entity
@Table(name = "answer_memory")
@Filter(name = RealDataOnly.NAME, condition = RealDataOnly.CONDITION)
public class AnswerMemory extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    /**
     * The product this answer was about, when it is known.
     *
     * <p>Null means "we do not know which product", never "this answer is product-independent". The
     * retrieval treats it accordingly: a bound memory is offered only for its own product, and an
     * unbound one is offered for any question, because an answer that never named a product cannot
     * contradict one.
     */
    @Column(name = "product_id")
    private UUID productId;

    @Column(name = "channel_code", length = 32)
    private String channelCode;

    @Column(name = "source_subtype", length = 32)
    private String sourceSubtype;

    @Column(name = "topic_signature", nullable = false, length = 400)
    private String topicSignature;

    @Column(name = "topic_category", length = 64)
    private String topicCategory;

    @Column(name = "answer_title", length = 300)
    private String answerTitle;

    @Column(name = "answer_body", nullable = false, columnDefinition = "text")
    private String answerBody;

    /** The comparison form of signature + body, written once so scoring cannot drift under it. */
    @Column(nullable = false, columnDefinition = "text")
    private String normalized;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private AnswerMemoryStrength strength;

    @Column(name = "origin_ref", nullable = false, length = 160)
    private String originRef;

    @Column(name = "origin_inquiry_id")
    private UUID originInquiryId;

    @Column(name = "origin_work_item_id")
    private UUID originWorkItemId;

    @Column(name = "origin_draft_version")
    private Integer originDraftVersion;

    @Column(name = "author_user_id")
    private UUID authorUserId;

    @Column(name = "author_name", length = 120)
    private String authorName;

    @Column(nullable = false)
    private int version = 1;

    /**
     * How far this answer may travel (Inquiry Decision v2.1, {@link AnswerMemoryReuseScope}). UNKNOWN until a person
     * says otherwise — and UNKNOWN never prefills another Case.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "reuse_scope", nullable = false, length = 16)
    private AnswerMemoryReuseScope reuseScope = AnswerMemoryReuseScope.UNKNOWN;

    @Column(name = "reuse_scope_declared_by")
    private UUID reuseScopeDeclaredBy;

    @Column(name = "reuse_scope_declared_at")
    private java.time.Instant reuseScopeDeclaredAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "data_origin", nullable = false, length = 16)
    private DataOrigin dataOrigin = DataOrigin.REAL;
}
