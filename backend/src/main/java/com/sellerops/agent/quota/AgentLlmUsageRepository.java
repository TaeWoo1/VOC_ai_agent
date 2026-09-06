package com.sellerops.agent.quota;

import java.time.LocalDate;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AgentLlmUsageRepository extends JpaRepository<AgentLlmUsage, UUID> {

    long countByOrgIdAndUsageDate(UUID orgId, LocalDate usageDate);

    /**
     * The calls the daily limit is about: this org's, today, spent by the SELLER.
     *
     * <p>The unqualified count above is what reporting reads and it still sees everything. This one
     * exists because a benchmark signing in as a real account used to spend that account's budget.
     */
    long countByOrgIdAndUsageDateAndActor(UUID orgId, LocalDate usageDate, AgentUsageActor actor);

    /**
     * Distinct runs today. {@code run_id is not null} matters: a null is "this call belonged to no
     * run", and counting nulls as one run would let every draft in the org share a single slot.
     */
    @Query("select count(distinct u.runId) from AgentLlmUsage u "
            + "where u.orgId = :orgId and u.usageDate = :day and u.runId is not null")
    long countDistinctRuns(@Param("orgId") UUID orgId, @Param("day") LocalDate day);

    /** Distinct SELLER runs today — the run limit's own count. */
    @Query("select count(distinct u.runId) from AgentLlmUsage u "
            + "where u.orgId = :orgId and u.usageDate = :day and u.runId is not null "
            + "and u.actor = com.sellerops.agent.quota.AgentUsageActor.USER")
    long countDistinctUserRuns(@Param("orgId") UUID orgId, @Param("day") LocalDate day);

    /** True when this run has already been counted — a later iteration must not buy a second slot. */
    boolean existsByOrgIdAndUsageDateAndRunId(UUID orgId, LocalDate usageDate, String runId);
}
