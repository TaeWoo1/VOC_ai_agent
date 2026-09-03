package com.sellerops.knowledge.candidate;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * <b>Something reviewnary noticed. Not something the company has said.</b>
 * (Knowledge Sources &amp; Acquisition v1)
 *
 * <p>The distinction this table exists for is the whole point of it. A sentence that appears in
 * eighteen of the seller's own past answers is strong evidence that it is their standard — and it is
 * still not their standard until a person says so. Answers are written in a hurry, to one customer,
 * about one order; a policy is written on purpose, for everyone. Promoting the first into the second
 * automatically would put words in the company's mouth that nobody at the company chose, and the
 * seller would find out when a customer quoted it back.
 *
 * <p>So: {@code OPEN} until a human decides. {@code ACCEPTED} writes an ordinary knowledge source and
 * records which one it became — from that moment the knowledge is a normal source with normal
 * provenance, and this row is only the history of how it got there. {@code DISMISSED} means "not
 * this", and deliberately does NOT prevent the same sentence being noticed again later: a seller who
 * dismissed a candidate in March may well want it in September, and a permanent veto on a sentence
 * they never wrote down is a veto they cannot see or undo.
 *
 * <p>Carries no customer content: {@code content} is the SELLER's own sentence, and {@code subject} is
 * the seller's word for what it is about.
 */
@Getter
@Setter
@Entity
@Table(name = "knowledge_candidate")
public class KnowledgeCandidate {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    /** {@code PRODUCT} or {@code ORG} — which corpus accepting it would write into. */
    @Column(nullable = false, length = 16)
    private String scope;

    @Column(name = "product_id")
    private UUID productId;

    @Column(nullable = false, length = 300)
    private String subject;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    /** {@code REPEATED_ANSWER} or {@code DRAFT_GAP} — how it came to be noticed. */
    @Column(nullable = false, length = 24)
    private String origin;

    /** How many of the seller's own past answers carry this sentence. 0 for a gap. */
    @Column(name = "evidence_count", nullable = false)
    private int evidenceCount;

    /** {@code OPEN} / {@code ACCEPTED} / {@code DISMISSED}. */
    @Column(nullable = false, length = 16)
    private String state = "OPEN";

    /** The knowledge source an accepted candidate became. Null until then. */
    @Column(name = "source_id")
    private UUID sourceId;

    /** Identity for the partial unique index: one OPEN candidate per sentence per scope. */
    @Column(name = "dedupe_key", nullable = false, length = 120)
    private String dedupeKey;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decided_by", length = 120)
    private String decidedBy;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
