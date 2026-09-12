package com.sellerops.knowledge.candidate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface KnowledgeCandidateRepository extends JpaRepository<KnowledgeCandidate, UUID> {

    List<KnowledgeCandidate> findAllByOrgIdAndStateOrderByEvidenceCountDescCreatedAtDesc(
            UUID orgId, String state);

    Optional<KnowledgeCandidate> findByIdAndOrgId(UUID id, UUID orgId);

    Optional<KnowledgeCandidate> findByOrgIdAndDedupeKeyAndState(UUID orgId, String dedupeKey, String state);

    long countByOrgIdAndState(UUID orgId, String state);

    /**
     * How many asks are still waiting for ONE product — the Decision Workspace's «why the draft may
     * say less than you expect» number. A count, so the workspace never loads the org's whole inbox
     * to show a figure beside one review.
     */
    long countByOrgIdAndProductIdAndState(UUID orgId, UUID productId, String state);

    /**
     * Whether this org has already ANSWERED this exact ask.
     *
     * <p>Knowledge Gap Continuity v1: a regenerate re-runs the gap detection, so without this a
     * seller who answered an ask and let the screen re-ask for a draft met the identical question
     * again in the same breath — the row they closed, filed anew. Identity only: the same dedupe
     * key, which is the same scope, the same product and the same question.
     *
     * <p>{@code DISMISSED} is deliberately not included. 「아니요」 says «not this, now», and
     * {@code dismiss} records that in so many words: the same sentence may be noticed again later.
     */
    boolean existsByOrgIdAndDedupeKeyAndState(UUID orgId, String dedupeKey, String state);
}
