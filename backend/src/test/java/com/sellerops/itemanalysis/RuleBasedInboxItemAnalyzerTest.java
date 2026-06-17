package com.sellerops.itemanalysis;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.itemanalysis.InboxItemAnalyzer.Result;
import com.sellerops.itemanalysis.InboxItemAnalyzer.SourceItem;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Deterministic rule outputs for representative Korean inputs. No DB. Also locks
 * the PII-safe contract: the templated summary never contains the input body, and
 * provenance is always RULE_BASED with null model/prompt metadata implied.
 */
class RuleBasedInboxItemAnalyzerTest {

    private final RuleBasedInboxItemAnalyzer analyzer = new RuleBasedInboxItemAnalyzer();

    private static SourceItem inquiry(String body, String status) {
        return new SourceItem("INQUIRY", UUID.randomUUID(), body, null, status, false);
    }

    private static SourceItem review(String body, Integer rating, boolean negative) {
        return new SourceItem("REVIEW", UUID.randomUUID(), body, rating, null, negative);
    }

    @Test
    void unansweredDeliveryInquiryIsHighAndNeedsAnswer() {
        Result r = analyzer.analyze(inquiry("배송이 언제 도착하나요? 아직 발송 안 됐어요", "UNANSWERED"));

        assertThat(r.category()).isEqualTo("배송");
        assertThat(r.sentiment()).isEqualTo("NEUTRAL");
        assertThat(r.urgency()).isEqualTo("HIGH");
        assertThat(r.recommendedAction()).isEqualTo("답변 필요");
        assertThat(r.summary()).isEqualTo("배송 관련 문의");
    }

    @Test
    void answeredProductInfoInquiryIsFaqCandidate() {
        Result r = analyzer.analyze(inquiry("이 제품 사양과 호환 크기가 어떻게 되나요?", "ANSWERED"));

        assertThat(r.category()).isEqualTo("제품정보");
        assertThat(r.urgency()).isEqualTo("LOW");
        assertThat(r.recommendedAction()).isEqualTo("FAQ 후보");
        assertThat(r.summary()).isEqualTo("제품정보 관련 문의");
    }

    @Test
    void negativeQualityReviewIsHighAndDetailPageCandidate() {
        Result r = analyzer.analyze(review("불량이고 금방 깨졌어요. 품질이 별로네요", 1, true));

        assertThat(r.category()).isEqualTo("품질");
        assertThat(r.sentiment()).isEqualTo("NEGATIVE");
        assertThat(r.urgency()).isEqualTo("HIGH");
        assertThat(r.recommendedAction()).isEqualTo("상세페이지 개선 후보");
        assertThat(r.summary()).isEqualTo("품질 관련 부정 리뷰");
    }

    @Test
    void positiveReviewIsLowAndConfirmOnly() {
        Result r = analyzer.analyze(review("색상이 예쁘고 만족스러워요", 5, false));

        assertThat(r.category()).isEqualTo("색상");
        assertThat(r.sentiment()).isEqualTo("POSITIVE");
        assertThat(r.urgency()).isEqualTo("LOW");
        assertThat(r.recommendedAction()).isEqualTo("확인 필요");
        assertThat(r.summary()).isEqualTo("색상 관련 긍정 리뷰");
    }

    @Test
    void lowRatingWithoutNegativeFlagIsStillNegative() {
        Result r = analyzer.analyze(review("가격이 너무 비싸요", 2, false));

        assertThat(r.category()).isEqualTo("가격");
        assertThat(r.sentiment()).isEqualTo("NEGATIVE");
    }

    @Test
    void unmatchedBodyFallsBackToEtc() {
        Result r = analyzer.analyze(inquiry("안녕하세요 그냥 인사드려요", "ANSWERED"));

        assertThat(r.category()).isEqualTo("기타");
        assertThat(r.recommendedAction()).isEqualTo("확인 필요");
    }

    @Test
    void provenanceIsAlwaysRuleBased() {
        Result r = analyzer.analyze(review("배송 빨랐어요", 5, false));

        assertThat(r.analyzerKind()).isEqualTo("RULE_BASED");
        assertThat(r.analyzerName()).isEqualTo("rule-based");
        assertThat(r.analyzerVersion()).isEqualTo("rules-v1");
    }

    @Test
    void summaryNeverContainsRawBody() {
        String body = "내 전화번호는 010-1234-5678 이고 환불해 주세요";
        Result r = analyzer.analyze(review(body, 1, true));

        // PII-safe: the templated summary is built from rule outputs only.
        assertThat(r.summary()).doesNotContain("010-1234-5678");
        assertThat(r.summary()).doesNotContain(body);
        assertThat(r.summary()).isEqualTo("교환 관련 부정 리뷰");
    }

    @Test
    void candidateActionsEndInHedgedForm() {
        Result faq = analyzer.analyze(inquiry("제품 사양 알려주세요", "ANSWERED"));
        Result detail = analyzer.analyze(review("품질 불량입니다", 1, true));

        assertThat(faq.recommendedAction()).endsWith("후보");
        assertThat(detail.recommendedAction()).endsWith("후보");
    }
}
