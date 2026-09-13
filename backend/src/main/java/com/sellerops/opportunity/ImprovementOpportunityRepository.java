package com.sellerops.opportunity;

import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

public interface ImprovementOpportunityRepository extends JpaRepository<ImprovementOpportunity, UUID> {

    /**
     * One decision, locked for the duration of a decision.
     *
     * <p>The trail records {@code statusFrom}, and that column is only true if the status it names is
     * the one actually left. Two presses reading the row at once would both see the standing status
     * and both write a row claiming to have left it. The unique index serialises the INSERT of a
     * first decision; this serialises every one after it.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<ImprovementOpportunity> findWithLockByOrgIdAndIssueIdAndKind(
            UUID orgId, UUID issueId, OpportunityKind kind);

    List<ImprovementOpportunity> findByOrgIdAndIssueIdIn(UUID orgId, Collection<UUID> issueIds);

    /**
     * Every decision in one state. Used to answer 「무엇이 준비돼 있나」 without deriving over the whole
     * issue list first: the decided rows are few, and only those can possibly be prepared work.
     */
    List<ImprovementOpportunity> findByOrgIdAndStatus(UUID orgId, OpportunityStatus status);
}
