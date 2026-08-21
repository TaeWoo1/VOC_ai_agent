package com.sellerops.customermemory;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CustomerMemoryEntryRepository extends JpaRepository<CustomerMemoryEntry, UUID> {

    /** The idempotency probe behind re-indexing: one entry per source row. */
    Optional<CustomerMemoryEntry> findByOrgIdAndEntryKindAndSourceId(
            UUID orgId, CustomerMemoryKind entryKind, UUID sourceId);

    /** Batch form of the above, so indexing a page of ids is one query rather than N. */
    List<CustomerMemoryEntry> findByOrgIdAndEntryKindAndSourceIdIn(
            UUID orgId, CustomerMemoryKind entryKind, Collection<UUID> sourceIds);

    /**
     * The retrieval read: entries matching a signature OR a topic, newest first.
     *
     * <p>Both criteria are optional and a null one matches nothing rather than everything — a null
     * {@code signatureKey} must not turn "find things like this one" into "return the whole index".
     * Ranking happens in {@link LexicalCustomerMemoryRetriever}, not here, because the rank depends on
     * WHICH criterion matched and SQL would have to encode the tie-break twice.
     */
    @Query("""
            select e from CustomerMemoryEntry e
            where e.orgId = :orgId
              and (
                    (:signatureKey is not null and e.signatureKey = :signatureKey)
                 or (:topic is not null and e.topic = :topic)
              )
            order by e.occurredOn desc, e.id asc
            """)
    List<CustomerMemoryEntry> findCandidates(@Param("orgId") UUID orgId,
                                             @Param("signatureKey") String signatureKey,
                                             @Param("topic") String topic,
                                             Pageable pageable);

    /**
     * Repeated-inquiry detection: how many INQUIRY entries share each signature in a window.
     *
     * <p>Grouped on {@code signature_key}, and rows with no signature are excluded rather than grouped
     * under null — for exactly the reason {@link com.sellerops.reviewissue.ProductEvidenceCount} gives
     * about unattributed products: letting "we could not classify it" form the largest group would let
     * a gap in extraction manufacture a 반복 문의 verdict.
     */
    @Query("""
            select e.signatureKey, count(e), min(e.occurredOn), max(e.occurredOn)
            from CustomerMemoryEntry e
            where e.orgId = :orgId
              and e.entryKind = com.sellerops.customermemory.CustomerMemoryKind.INQUIRY
              and e.signatureKey is not null
              and e.occurredOn between :fromInclusive and :toInclusive
            group by e.signatureKey
            order by count(e) desc, e.signatureKey asc
            """)
    List<Object[]> repeatedInquirySignatures(@Param("orgId") UUID orgId,
                                             @Param("fromInclusive") LocalDate fromInclusive,
                                             @Param("toInclusive") LocalDate toInclusive);

    /**
     * The same grouping on the TOPIC axis, for inquiries that carry no signature but do carry a topic.
     *
     * <p><b>{@code 기타} is excluded, and it is excluded for the same reason null is.</b>
     * {@code ItemAnalysisCategories} states that the fallback category is "the analyzer's verdict when
     * no keyword matched" — semantically "we looked and it fits nothing", which is a statement about the
     * classifier and not about the customers. Found on real data 2026-08-21: the demo org's largest
     * "repeat" was 기타 with 1,777 occurrences, i.e. every inquiry the vocabulary could not place,
     * reported to a seller as a pattern. That is precisely the failure {@code ProductEvidenceCount}
     * describes for unattributed products — letting a gap in classification manufacture a verdict.
     */
    @Query("""
            select e.topic, count(e), min(e.occurredOn), max(e.occurredOn)
            from CustomerMemoryEntry e
            where e.orgId = :orgId
              and e.entryKind = com.sellerops.customermemory.CustomerMemoryKind.INQUIRY
              and e.topic is not null
              and e.topic <> :fallbackTopic
              and e.occurredOn between :fromInclusive and :toInclusive
            group by e.topic
            order by count(e) desc, e.topic asc
            """)
    List<Object[]> repeatedInquiryTopics(@Param("orgId") UUID orgId,
                                         @Param("fromInclusive") LocalDate fromInclusive,
                                         @Param("toInclusive") LocalDate toInclusive,
                                         @Param("fallbackTopic") String fallbackTopic);

    /** Entries for one product — the ProductOps read. Newest first, bounded by the caller. */
    List<CustomerMemoryEntry> findByOrgIdAndProductIdOrderByOccurredOnDesc(
            UUID orgId, UUID productId, Pageable pageable);

    /**
     * Indexed inquiries that actually carry a signature — the rubric's recall numerator.
     *
     * <p>It exists as its own count because the honest headline for this capability is a ratio, and a
     * ratio computed in two places drifts. This was 0 of 3,220 on the demo org before v2.
     */
    @Query("""
            select count(e) from CustomerMemoryEntry e
            where e.orgId = :orgId
              and e.entryKind = com.sellerops.customermemory.CustomerMemoryKind.INQUIRY
              and e.signatureKey is not null
            """)
    long countSignedInquiries(@Param("orgId") UUID orgId);

    /** How many entries of a kind this org has indexed at all — the coverage denominator. */
    long countByOrgIdAndEntryKind(UUID orgId, CustomerMemoryKind entryKind);

    /** How many of them carry no product link — the coverage numerator ProductOps must report. */
    long countByOrgIdAndEntryKindAndProductIdIsNull(UUID orgId, CustomerMemoryKind entryKind);
}
