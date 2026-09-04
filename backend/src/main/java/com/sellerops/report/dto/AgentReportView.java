package com.sellerops.report.dto;

import com.sellerops.report.ReportFacts;
import com.sellerops.report.ReportNarrative;
import com.sellerops.report.ReportSummary;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * One report as the screen reads it: the frozen facts, the deterministic summary, the validated
 * narrative (or null with a sentence saying why), and the provenance a seller may want to see.
 */
public record AgentReportView(UUID id, String kind, String kindLabelKo,
                              LocalDate periodStart, LocalDate periodEnd, String periodLabelKo,
                              int version, Instant generatedAt,
                              ReportFacts facts, ReportSummary summary,
                              ReportNarrative narrative, String narrativeStatus, String narrativeNoteKo) {
}
