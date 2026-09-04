package com.sellerops.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ReportSummaryComposerTest {

    @Test
    @DisplayName("a rising issue yields a fact, an interpretation, and the limit — never a cause")
    void factInterpretationLimit() {
        ReportSummary summary = ReportSummaryComposer.compose(ReportFixtures.busy());
        List<String> texts = summary.lines().stream().map(ReportSummary.Line::text).toList();

        assertThat(texts).contains("「접착 부족」 관련 리뷰가 4건 있었습니다 (이전 기간 1건).");
        assertThat(summary.lines()).anySatisfy(l -> {
            assertThat(l.kind()).isEqualTo(ReportSummary.Kind.INTERPRETATION);
            assertThat(l.text()).isEqualTo("「접착 부족」 관련 리뷰 증가를 확인할 필요가 있습니다.");
            assertThat(l.factIds()).containsExactly("i-" + ReportFixtures.ISSUE);
        });
        assertThat(summary.lines()).anySatisfy(l -> {
            assertThat(l.kind()).isEqualTo(ReportSummary.Kind.LIMIT);
            assertThat(l.text()).contains("원인은 리뷰가 말해주지 않습니다");
        });
        // Every line cites something.
        assertThat(summary.lines()).allSatisfy(l -> assertThat(l.factIds()).isNotEmpty());
        // And no line asserts what the guard would refuse, except the LIMIT line that denies a cause.
        assertThat(summary.lines()).filteredOn(l -> l.kind() != ReportSummary.Kind.LIMIT)
                .allSatisfy(l -> assertThat(NarrativeClaimGuard.unsupportedClaim(l.text())).isFalse());
    }

    @Test
    void movementInCountersIsStatedWithBothNumbers() {
        List<String> texts = ReportSummaryComposer.compose(ReportFixtures.busy()).lines().stream()
                .map(ReportSummary.Line::text).toList();
        assertThat(texts).contains("부정 리뷰은(는) 이전 기간보다 2건 늘었습니다 (1건 → 3건).");
        assertThat(texts).noneMatch(t -> t.startsWith("주문은(는)"));
        assertThat(texts).contains("개선 기회 1건이 제안되어 있습니다 (검토 전 1건).");
        assertThat(texts).contains("지금 답변이 필요한 문의가 5건 있습니다.");
    }

    @Test
    @DisplayName("a previous window with no reading is 자료 없음, never 0건, and yields no delta")
    void absentPreviousReadingIsNotAZero() {
        ReportFacts facts = ReportFixtures.busy();
        ReportFacts withAbsent = new ReportFacts(facts.period(), List.of(
                ReportFixtures.counter("c-reviews", "받은 리뷰", 81, null),
                ReportFixtures.counter("c-negative-reviews", "부정 리뷰", 3, null),
                ReportFixtures.counter("c-inquiries", "받은 문의", 5, 1L),
                ReportFixtures.counter("c-orders", "주문", 317, null),
                facts.counters().get(4)), facts.issues(), facts.opportunities(), facts.nextSteps(), facts.generatedAt());
        List<String> texts = ReportSummaryComposer.compose(withAbsent).lines().stream().map(ReportSummary.Line::text).toList();
        assertThat(texts.get(0)).contains("이전 기간 리뷰 자료 없음, 문의 1건");
        assertThat(texts).noneMatch(t -> t.startsWith("주문은(는)"));
        assertThat(texts).noneMatch(t -> t.contains("0건 → 317건"));
    }

    @Test
    @DisplayName("a quiet period says so in one sentence and invents nothing")
    void quietPeriod() {
        ReportSummary summary = ReportSummaryComposer.compose(ReportFixtures.quiet());
        assertThat(summary.lines().get(0).text()).startsWith("2026년 8월 24일 ~ 30일에는 달라진 것이 없습니다");
        assertThat(summary.lines()).hasSize(1);
        assertThat(summary.lines()).noneMatch(l -> l.kind() == ReportSummary.Kind.INTERPRETATION);
    }
}
