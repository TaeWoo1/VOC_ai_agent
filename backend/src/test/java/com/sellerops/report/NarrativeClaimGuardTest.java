package com.sellerops.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class NarrativeClaimGuardTest {

    private static final Set<String> FACTS = Set.of("c-reviews", "i-1", "o-1");

    private static ReportNarrative.Line line(String text, String... ids) {
        return new ReportNarrative.Line(text, List.of(ids));
    }

    @Test
    @DisplayName("a line is kept only when every id it cites exists and it cites at least one")
    void traceOrDrop() {
        var result = NarrativeClaimGuard.validate(new ReportNarrative("요약", List.of(
                line("리뷰가 81건 들어왔습니다.", "c-reviews"),
                line("접착 관련 리뷰가 늘었습니다.", "i-1", "i-99"),
                line("전반적으로 조용한 한 주였습니다."))), FACTS);

        assertThat(result.narrative().lines()).extracting(ReportNarrative.Line::text)
                .containsExactly("리뷰가 81건 들어왔습니다.");
        assertThat(result.refused()).isEqualTo(2);
    }

    @Test
    @DisplayName("the unsupported-cause sentence from the brief is refused; the interpretation is kept")
    void causesAndOutcomesAreRefused() {
        var result = NarrativeClaimGuard.validate(new ReportNarrative(null, List.of(
                line("접착 관련 리뷰가 이전 기간보다 증가했습니다.", "i-1"),
                line("접착 관련 문의/리뷰 증가를 확인할 필요가 있습니다.", "i-1"),
                line("생산 품질이 나빠졌습니다.", "i-1"),
                line("테이프 두께 때문에 떨어지는 것으로 보입니다.", "i-1"),
                line("FAQ 보완으로 만족도가 높아질 것입니다.", "o-1"))), FACTS);

        assertThat(result.narrative().lines()).extracting(ReportNarrative.Line::text).containsExactly(
                "접착 관련 리뷰가 이전 기간보다 증가했습니다.",
                "접착 관련 문의/리뷰 증가를 확인할 필요가 있습니다.");
        assertThat(result.refused()).isEqualTo(3);
    }

    @Test
    void theHeadlineIsHeldToTheSameVocabularyAndIsOptional() {
        var causal = NarrativeClaimGuard.validate(new ReportNarrative("품질 저하로 리뷰가 늘었습니다",
                List.of(line("리뷰 81건.", "c-reviews"))), FACTS);
        assertThat(causal.narrative().headline()).isNull();
        assertThat(causal.narrative().lines()).hasSize(1);

        var plain = NarrativeClaimGuard.validate(new ReportNarrative("리뷰가 늘고 문의는 그대로입니다",
                List.of(line("리뷰 81건.", "c-reviews"))), FACTS);
        assertThat(plain.narrative().headline()).isEqualTo("리뷰가 늘고 문의는 그대로입니다");
    }

    @Test
    void nothingAdmissibleMeansNothingToShow() {
        var result = NarrativeClaimGuard.validate(new ReportNarrative(null, List.of(
                line("원인은 배송 업체 변경입니다.", "c-reviews"))), FACTS);
        assertThat(result.hasAnything()).isFalse();
        assertThat(NarrativeClaimGuard.validate(null, FACTS).hasAnything()).isFalse();
    }

    @Test
    void theOneCauseSentenceTheReportPrintsItselfIsNotACause() {
        // The composer's LIMIT line says the cause is unknown; the guard reads 「원인은」 in it. That is
        // fine — the guard is applied to the MODEL's lines, never to the composer's, and this pins that
        // the two vocabularies are meant to differ rather than accidentally agree.
        assertThat(NarrativeClaimGuard.unsupportedClaim("늘어난 원인은 리뷰가 말해주지 않습니다.")).isTrue();
    }
}
