package com.sellerops.review.triage.feedback;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TriageBehaviorEventRepository extends JpaRepository<TriageBehaviorEvent, UUID> {

    List<TriageBehaviorEvent> findByOrgIdAndSnapshotVersionIsNull(UUID orgId);
}
