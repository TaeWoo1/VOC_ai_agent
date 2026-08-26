package com.sellerops.knowledge.style;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One row per organization, keyed BY the organization.
 *
 * <p>The org id is the primary key rather than a unique column beside a surrogate one, so "a company
 * has one answer style" is a property of the table instead of a constraint somebody can drop. It is
 * also why this entity does not extend {@code BaseEntity}: that superclass brings a generated id this
 * row has no use for.
 *
 * <p><b>No row is a real state.</b> Nothing creates one on signup, nothing backfills existing
 * companies, and {@link AnswerStyleProfile#defaults()} answers for every org without one.
 */
@Getter
@Setter
@Entity
@Table(name = "organization_answer_style")
public class OrganizationAnswerStyle {

    @Id
    @Column(name = "org_id", nullable = false, updatable = false)
    private UUID orgId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AnswerTone tone = AnswerTone.POLITE;

    @Enumerated(EnumType.STRING)
    @Column(name = "length_preference", nullable = false)
    private AnswerLength lengthPreference = AnswerLength.NORMAL;

    @Enumerated(EnumType.STRING)
    @Column(name = "emoji_policy", nullable = false)
    private EmojiPolicy emojiPolicy = EmojiPolicy.NONE;

    @Column
    private String greeting;

    @Column
    private String closing;

    /** 「고객님」 and the like. A form of address, never a customer's actual name. */
    @Column(name = "customer_address")
    private String customerAddress;

    /** One phrase per line — see {@link StylePhrases}. */
    @Column(name = "required_phrases")
    private String requiredPhrases;

    /** One phrase per line — see {@link StylePhrases}. */
    @Column(name = "forbidden_phrases")
    private String forbiddenPhrases;

    /**
     * The seller's own approved sentence for "there is no basis to answer this yet".
     *
     * <p>Used verbatim or not at all. It is here rather than generated because the alternative — a
     * model writing a deferral — is how 「확인한 뒤 정확한 안내를 드리겠습니다」 got made on a seller's
     * behalf with nothing behind it, which is the sentence this product deleted.
     */
    @Column(name = "unknown_fallback")
    private String unknownFallback;

    /** Bumped on every save. A draft records it, so last month's wording stays readable. */
    @Column(nullable = false)
    private int version = 1;

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

    /** The value the composition reads. */
    public AnswerStyleProfile toProfile() {
        return new AnswerStyleProfile(tone, lengthPreference, emojiPolicy, greeting, closing,
                customerAddress, StylePhrases.parse(requiredPhrases),
                StylePhrases.parse(forbiddenPhrases), unknownFallback, version);
    }
}
