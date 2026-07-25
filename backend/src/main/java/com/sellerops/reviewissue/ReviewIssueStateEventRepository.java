package com.sellerops.reviewissue;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewIssueStateEventRepository
        extends JpaRepository<ReviewIssueStateEvent, UUID> {

    List<ReviewIssueStateEvent> findByOrgIdAndIssueIdOrderByCreatedAtAsc(UUID orgId, UUID issueId);
}
