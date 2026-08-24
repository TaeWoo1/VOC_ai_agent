package com.sellerops.agent.quota;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/** One model call this org spent. No goal text, no response — usage only. */
@Getter
@Setter
@Entity
@Table(name = "agent_llm_usage")
public class AgentLlmUsage extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "usage_date", nullable = false)
    private LocalDate usageDate;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private AgentUsageKind kind;

    @Column(name = "run_id", length = 200)
    private String runId;
}
