package com.sellerops.report;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AgentReportRepository extends JpaRepository<AgentReport, UUID> {

    /** The newest version of one period's report, or empty when it was never generated. */
    Optional<AgentReport> findTopByOrgIdAndKindAndPeriodStartOrderByVersionDesc(UUID orgId, ReportKind kind,
                                                                                LocalDate periodStart);

    Optional<AgentReport> findByOrgIdAndId(UUID orgId, UUID id);

    /** Recent reports of one cadence, newest period first, newest version first. */
    List<AgentReport> findByOrgIdAndKindOrderByPeriodStartDescVersionDesc(UUID orgId, ReportKind kind,
                                                                          Pageable pageable);
}
