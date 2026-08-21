package com.sellerops.customermemory;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Deterministic retrieval over the two closed vocabularies the index stores. No embedding, no vendor
 * call, no clock, no randomness: the same cue over the same index always returns the same neighbours
 * in the same order, which is what lets an Operator run be replayed and compared.
 *
 * <p><b>Ranking, in words.</b> A hit that matches the exact {@code aspect:problem} signature is a
 * better precedent than one that merely shares a topic — "붙였는데 떨어져요" should recall the previous
 * 접착:탈락 inquiry before it recalls an unrelated 배송 question. Within a tier, a hit on the same
 * product beats one on another product, an ANSWERED inquiry beats an unanswered one (an answered
 * precedent is the one that carries an answer to reuse), and newer beats older. Ties break on id so
 * the order is total.
 *
 * <p>Gated on {@code sellerops.customermemory.retriever.provider} following
 * {@code RuleBasedIssueSignatureExtractor}'s precedent: naming a provider that does not exist stops
 * the boot loudly rather than being silently reinterpreted as this one.
 */
@Component
@ConditionalOnProperty(name = "sellerops.customermemory.retriever.provider", havingValue = "lexical",
        matchIfMissing = true)
public class LexicalCustomerMemoryRetriever implements CustomerMemoryRetriever {

    static final String KIND = "LEXICAL";
    static final String VERSION = "customer-memory-lexical/v1";

    /**
     * How many candidate rows are pulled before ranking. Bounded because a popular topic (배송) can
     * match a large share of the index, and ranking a whole org's history to show five rows is a cost
     * with no product behind it.
     */
    static final int CANDIDATE_CAP = 200;

    private final CustomerMemoryEntryRepository entries;

    public LexicalCustomerMemoryRetriever(CustomerMemoryEntryRepository entries) {
        this.entries = entries;
    }

    @Override
    public String kind() {
        return KIND;
    }

    @Override
    public String version() {
        return VERSION;
    }

    @Override
    @Transactional(readOnly = true)
    public List<CustomerMemoryEntry> retrieve(UUID orgId, RetrievalCue cue, UUID excludeSourceId, int limit) {
        if (cue == null || cue.isEmpty() || limit <= 0) {
            return List.of();
        }
        String signature = blankToNull(cue.signatureKey());
        String topic = blankToNull(cue.topic());
        List<CustomerMemoryEntry> candidates =
                entries.findCandidates(orgId, signature, topic, PageRequest.of(0, CANDIDATE_CAP));

        return candidates.stream()
                .filter(e -> excludeSourceId == null || !excludeSourceId.equals(e.getSourceId()))
                .filter(e -> cue.productId() == null || cue.productId().equals(e.getProductId()))
                .sorted(rank(signature, cue.productId()))
                .limit(limit)
                .toList();
    }

    private static Comparator<CustomerMemoryEntry> rank(String signature, UUID productId) {
        return Comparator
                // 0 = signature match, 1 = topic-only match.
                .comparingInt((CustomerMemoryEntry e) ->
                        signature != null && signature.equals(e.getSignatureKey()) ? 0 : 1)
                .thenComparingInt(e -> productId != null && productId.equals(e.getProductId()) ? 0 : 1)
                // An answered inquiry is the precedent that actually carries an answer to reuse.
                .thenComparingInt(e -> e.getEntryKind() == CustomerMemoryKind.INQUIRY && e.isAnswered() ? 0 : 1)
                .thenComparing(CustomerMemoryEntry::getOccurredOn, Comparator.reverseOrder())
                .thenComparing(e -> Objects.toString(e.getId(), ""));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
