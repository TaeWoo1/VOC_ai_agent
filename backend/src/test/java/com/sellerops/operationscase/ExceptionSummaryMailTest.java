package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.mail.OutboundMail;
import java.util.List;
import org.junit.jupiter.api.Test;

class ExceptionSummaryMailTest {

    @Test
    void theSummaryCarriesCountsAndChannelsAndALink_andNothingACustomerWrote() {
        OutboundMail mail = ExceptionSummaryMail.compose("owner@example.invalid", 2,
                List.of(new ExceptionSummaryMail.GapLine("카페24", "AUTH", List.of("INQUIRY", "REVIEW"))),
                "https://app.example/customer-operations");
        assertThat(mail.subject()).isEqualTo("[reviewnary] 고객 운영 관리에서 확인할 일이 있습니다");
        assertThat(mail.text())
                .contains("고객 운영 관리에서 확인할 일 2건이 있습니다.")
                .contains("카페24는 연결이 만료되어 문의·리뷰를 확인하지 못했습니다.")
                .contains("Reviewnary에서 확인하기: https://app.example/customer-operations")
                .doesNotContain("null");
    }

    @Test
    void aGapAloneDoesNotClaimDecisions() {
        OutboundMail mail = ExceptionSummaryMail.compose("o@example.invalid", 0,
                List.of(new ExceptionSummaryMail.GapLine("쿠팡", "CONNECTION", List.of("REVIEW"))), "https://x/");
        assertThat(mail.text()).startsWith("고객 운영 관리에서 제대로 확인하지 못한 곳이 있습니다.")
                .contains("쿠팡은 연결이 끊겨 리뷰를 확인하지 못했습니다.")
                .doesNotContain("확인할 일 0건");
    }

    @Test
    void theTopicParticleFollowsTheLastSound() {
        assertThat(ExceptionSummaryMail.topic("카페24")).isEqualTo("는");
        assertThat(ExceptionSummaryMail.topic("쿠팡")).isEqualTo("은");
        assertThat(ExceptionSummaryMail.topic("네이버")).isEqualTo("는");
        assertThat(ExceptionSummaryMail.topic("11번가")).isEqualTo("는");
        assertThat(ExceptionSummaryMail.topic("채널1")).isEqualTo("은");
    }
}
