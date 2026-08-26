package com.sellerops.inquiry;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.common.DataOrigin;
import com.sellerops.common.SyntheticDataVisibility;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>답변이 필요한 문의 is a claim about the SELLER's obligations</b> (Agent Command Center v1 §1-A,
 * regression A).
 *
 * <p>The {@code realDataOnly} filter is switched off on a demo deployment on purpose — a demo shows
 * its demo dashboard — and the canonical Demo Org's 6 DEMO_SEED + 2 VERIFY_FIXTURE unanswered rows
 * were therefore counted into the number the home screen prints as work waiting: 22 real became 30.
 * A manufactured row may appear in a chart of what the shop did. It may never appear in a number that
 * says the seller owes an answer.
 *
 * <p>Both cases run with synthetic rows VISIBLE, because that is the configuration where the two
 * counts differ and the one the demo actually runs in.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class OperationalUnansweredCountTest {

    @Autowired InquiryRepository inquiries;

    private UUID org;
    private boolean previous;

    @BeforeEach
    void setUp() {
        org = UUID.randomUUID();
        previous = SyntheticDataVisibility.syntheticVisible();
        SyntheticDataVisibility.overrideForTest(true);
    }

    @AfterEach
    void tearDown() {
        SyntheticDataVisibility.overrideForTest(previous);
    }

    @Test
    @DisplayName("A — the operational count excludes every manufactured origin")
    void syntheticRowsAreNotWorkWaiting() {
        UUID channel = UUID.randomUUID();
        seed(channel, "UNANSWERED", DataOrigin.REAL);
        seed(channel, "UNANSWERED", DataOrigin.REAL);
        seed(channel, "UNANSWERED", DataOrigin.DEMO_SEED);
        seed(channel, "UNANSWERED", DataOrigin.VERIFY_FIXTURE);
        seed(channel, "ANSWERED", DataOrigin.REAL);
        seed(channel, "UNANSWERED", DataOrigin.REAL, InquiryOperationalState.EXCLUDED_SPAM);

        // What the demo deployment sees without the narrowing — the number this package corrected.
        assertThat(inquiries.countByOrgIdAndStatus(org, "UNANSWERED")).isEqualTo(4);
        assertThat(inquiries.countUnansweredOperational(org)).isEqualTo(2);
    }

    @Test
    @DisplayName("A — the per-channel breakdown sums to the org total it sits beside")
    void perChannelAgreesWithTheTotal() {
        UUID cafe24 = UUID.randomUUID();
        UUID naver = UUID.randomUUID();
        seed(cafe24, "UNANSWERED", DataOrigin.REAL);
        seed(cafe24, "UNANSWERED", DataOrigin.REAL);
        seed(cafe24, "UNANSWERED", DataOrigin.DEMO_SEED);
        seed(naver, "UNANSWERED", DataOrigin.REAL);

        long summed = inquiries.countUnansweredOperationalByChannel(org).stream()
                .mapToLong(row -> ((Number) row[1]).longValue()).sum();

        assertThat(summed).isEqualTo(inquiries.countUnansweredOperational(org)).isEqualTo(3);
    }

    private void seed(UUID channelId, String status, DataOrigin origin) {
        seed(channelId, status, origin, InquiryOperationalState.ACTIVE);
    }

    private void seed(UUID channelId, String status, DataOrigin origin,
                      InquiryOperationalState state) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channelId);
        q.setTitle("문의");
        q.setBody("본문");
        q.setStatus(status);
        q.setDataOrigin(origin);
        q.setOperationalState(state);
        q.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        inquiries.save(q);
    }
}
