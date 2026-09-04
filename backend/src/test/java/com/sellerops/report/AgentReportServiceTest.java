package com.sellerops.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.sellerops.agent.llm.report.AgentReportNarrativeService;
import com.sellerops.report.dto.AgentReportView;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * Snapshot semantics: open reads, first open generates once, regenerate appends a version, and the
 * narrative is optional at every step.
 */
class AgentReportServiceTest {

    private final AgentReportRepository reports = mock(AgentReportRepository.class);
    private final ReportFactsBuilder builder = mock(ReportFactsBuilder.class);
    private final AgentReportNarrativeService narrative = mock(AgentReportNarrativeService.class);
    private final ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule())
            .disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    // Friday 2026-09-04, Seoul: the latest completed week is 08-24 … 08-30.
    private final Clock clock = Clock.fixed(Instant.parse("2026-09-04T03:00:00Z"), ReportPeriod.CALENDAR);
    private final AgentReportService service = new AgentReportService(reports, builder, narrative, mapper, clock);
    private final UUID org = UUID.randomUUID();

    @BeforeEach
    void stubs() {
        when(builder.build(eq(org), any(), any())).thenReturn(ReportFixtures.busy());
        when(reports.save(any())).thenAnswer(inv -> {
            AgentReport r = inv.getArgument(0);
            r.setId(UUID.randomUUID());
            return r;
        });
    }

    @Test
    @DisplayName("the first open generates the period once; reopening reads the stored row and asks nothing")
    void openGeneratesOnceThenReads() {
        when(reports.findTopByOrgIdAndKindAndPeriodStartOrderByVersionDesc(org, ReportKind.WEEKLY,
                LocalDate.of(2026, 8, 24))).thenReturn(Optional.empty());
        when(narrative.isEnabledFor(org)).thenReturn(false);

        AgentReportView first = service.current(org, ReportKind.WEEKLY);
        assertThat(first.version()).isEqualTo(1);
        assertThat(first.periodLabelKo()).isEqualTo("2026년 8월 24일 ~ 30일");
        assertThat(first.narrativeStatus()).isEqualTo("UNAVAILABLE");
        assertThat(first.narrativeNoteKo()).contains("정리된 사실만");
        assertThat(first.summary().lines()).isNotEmpty();
        assertThat(first.facts().issues()).hasSize(1);

        ArgumentCaptor<AgentReport> saved = ArgumentCaptor.forClass(AgentReport.class);
        verify(reports).save(saved.capture());
        when(reports.findTopByOrgIdAndKindAndPeriodStartOrderByVersionDesc(org, ReportKind.WEEKLY,
                LocalDate.of(2026, 8, 24))).thenReturn(Optional.of(saved.getValue()));

        AgentReportView again = service.current(org, ReportKind.WEEKLY);
        assertThat(again.id()).isEqualTo(first.id());
        assertThat(again.facts()).isEqualTo(first.facts());
        // One build, one save: the second open read the row.
        verify(builder).build(eq(org), any(), any());
        verify(narrative, never()).narrate(any(), any());
    }

    @Test
    void regenerateAppendsAVersionAndLeavesTheOldOne() {
        AgentReport v1 = new AgentReport();
        v1.setVersion(1);
        when(reports.findTopByOrgIdAndKindAndPeriodStartOrderByVersionDesc(org, ReportKind.WEEKLY,
                LocalDate.of(2026, 8, 24))).thenReturn(Optional.of(v1));
        when(narrative.isEnabledFor(org)).thenReturn(false);

        AgentReportView v2 = service.regenerate(org, ReportKind.WEEKLY, null);
        assertThat(v2.version()).isEqualTo(2);
        verify(reports, never()).delete(any());
    }

    @Test
    @DisplayName("the narrative's untraceable and causal lines are dropped before storage; the rest is READY")
    void narrativeIsValidatedBeforeItIsStored() {
        when(reports.findTopByOrgIdAndKindAndPeriodStartOrderByVersionDesc(any(), any(), any()))
                .thenReturn(Optional.empty());
        when(narrative.isEnabledFor(org)).thenReturn(true);
        when(narrative.versionFor(org)).thenReturn("agent-report/v1+test");
        when(narrative.narrate(eq(org), any())).thenReturn(Optional.of(new ReportNarrative("이번 주 요약", List.of(
                new ReportNarrative.Line("리뷰가 81건으로 이전 기간 65건보다 늘었습니다.", List.of("c-reviews")),
                new ReportNarrative.Line("접착 부족 리뷰 증가는 생산 품질 저하 때문입니다.",
                        List.of("i-" + ReportFixtures.ISSUE)),
                new ReportNarrative.Line("배송 파손이 늘었습니다.", List.of("i-nope"))))));

        AgentReportView view = service.current(org, ReportKind.WEEKLY);
        assertThat(view.narrativeStatus()).isEqualTo("READY");
        assertThat(view.narrative().headline()).isEqualTo("이번 주 요약");
        assertThat(view.narrative().lines()).extracting(ReportNarrative.Line::text)
                .containsExactly("리뷰가 81건으로 이전 기간 65건보다 늘었습니다.");
        assertThat(view.narrativeNoteKo()).isNull();
    }

    @Test
    void aFailedOrFullyRefusedNarrativeLeavesTheSummaryStanding() {
        when(reports.findTopByOrgIdAndKindAndPeriodStartOrderByVersionDesc(any(), any(), any()))
                .thenReturn(Optional.empty());
        when(narrative.isEnabledFor(org)).thenReturn(true);
        when(narrative.narrate(eq(org), any())).thenReturn(Optional.empty());

        AgentReportView view = service.current(org, ReportKind.WEEKLY);
        assertThat(view.narrativeStatus()).isEqualTo("FAILED");
        assertThat(view.narrative()).isNull();
        assertThat(view.summary().lines()).isNotEmpty();
        assertThat(view.narrativeNoteKo()).contains("만들지 못해");
    }
}
