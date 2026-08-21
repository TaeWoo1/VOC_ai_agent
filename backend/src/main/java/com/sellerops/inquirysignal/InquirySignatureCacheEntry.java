package com.sellerops.inquirysignal;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One classified inquiry text, keyed by a one-way hash of the text.
 *
 * <p><b>This is a privacy control before it is a cost control.</b> The hash means a customer sentence
 * is sent to a model AT MOST ONCE, ever: a re-run, a replayed backfill page, and a re-collection of the
 * same inquiry all hit this row instead of re-exposing the same words. Without it, the honest
 * "we classify each inquiry once" would be true only of the first attempt.
 *
 * <p><b>There is no body column and none can be added without changing V49.</b> What is stored is a
 * hash, two closed-vocabulary labels, and provenance. The hash is one-way — the text is not
 * recoverable from it, and it exists to answer "have we seen this exact text", not to identify a person.
 *
 * <p>A MISS is stored too ({@link #signatureKey} null): "we asked and got no usable answer" is a fact
 * worth remembering, because otherwise every pass would ask again about the same unclassifiable text.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_signature_cache")
public class InquirySignatureCacheEntry extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    /** sha-256 of the normalized text. Org-scoped in the key: two orgs never share a row. */
    @Column(name = "content_hash", nullable = false, length = 64)
    private String contentHash;

    /** {@code <topic>:<askKind>}, or null on a miss. */
    @Column(name = "signature_key", length = 96)
    private String signatureKey;

    @Column(length = 32)
    private String topic;

    @Column(name = "ask_kind", length = 32)
    private String askKind;

    @Column(length = 16)
    private String severity;

    @Column(name = "extractor_kind", nullable = false, length = 24)
    private String extractorKind;

    @Column(name = "extractor_version", nullable = false, length = 32)
    private String extractorVersion;

    /**
     * Which model actually answered, so a re-measure can tell which rows a given model produced.
     *
     * <p><b>256, not 64.</b> The version a generator stamps is composite — capability + vendor + model +
     * prompt version + schema + token budget + reasoning effort — because a measurement recorded against
     * "the model" stops being reproducible the moment any of those changes, and
     * {@code contracts/inquiry-issue/v1/RUBRIC.md} requires a run to be re-derivable from what it
     * recorded. 64 was copied from {@code review_issues.extractor_version}, whose values are short by
     * construction; the first real classification hit the limit immediately (V50).
     */
    @Column(name = "provider_version", length = 256)
    private String providerVersion;
}
