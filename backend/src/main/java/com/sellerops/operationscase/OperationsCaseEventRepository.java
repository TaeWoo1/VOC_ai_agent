package com.sellerops.operationscase;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Append-only history. Every read names the organisation. */
public interface OperationsCaseEventRepository extends JpaRepository<OperationsCaseEvent, UUID> {

    List<OperationsCaseEvent> findByOrgIdAndCaseIdOrderByCreatedAtAsc(UUID orgId, UUID caseId);

    List<OperationsCaseEvent> findByOrgIdAndRunIdOrderByCreatedAtAsc(UUID orgId, UUID runId);

    long countByOrgIdAndRunIdAndKind(UUID orgId, UUID runId, CaseEventKind kind);
}
