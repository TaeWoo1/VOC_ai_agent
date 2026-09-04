package com.sellerops.report.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/** A previously generated report, enough to open it. */
public record AgentReportListItem(UUID id, String kind, LocalDate periodStart, LocalDate periodEnd,
                                  String periodLabelKo, int version, Instant generatedAt, String narrativeStatus) {
}
