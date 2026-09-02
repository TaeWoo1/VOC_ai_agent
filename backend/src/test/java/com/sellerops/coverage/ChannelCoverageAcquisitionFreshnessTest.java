package com.sellerops.coverage;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.ConnectorCapabilityRepository;
import com.sellerops.coverage.dto.ChannelCoverageRow;
import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewimport.ReviewImportPlan;
import com.sellerops.reviewimport.ReviewImportPlanRepository;
import com.sellerops.reviewimport.ReviewImportSegment;
import com.sellerops.reviewimport.ReviewImportSegmentAttempt;
import com.sellerops.reviewimport.ReviewImportSegmentAttemptRepository;
import com.sellerops.reviewimport.ReviewImportSegmentRepository;
import com.sellerops.reviewimport.SegmentAttemptResult;
import com.sellerops.reviewimport.SegmentCoverageState;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncScheduleRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Chat-first Completion & Continuity v1 §4 — freshness from ACQUISITION PROVENANCE.
 *
 * <p>The failure this pins: a NAVER account whose reviews are acquired through an approved export had
 * been read successfully that morning, and the channel still answered 「아직 확인한 적이 없어요」 — because
 * the only record consulted was a collection run's own columns, and a guided export does not write them
 * the way a connector pull does. The attempt row was there the whole time. Nothing is backfilled: this is
 * a second reader of a record that already existed.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ChannelCoverageAcquisitionFreshnessTest {

    @Autowired ChannelRepository channels;
    @Autowired ConnectorCapabilityRepository capabilities;
    @Autowired SellerAccountRepository accounts;
    @Autowired SyncScheduleRepository schedules;
    @Autowired SyncJobRepository syncJobs;
    @Autowired InquiryRepository inquiries;
    @Autowired ReviewRepository reviews;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ReviewImportSegmentAttemptRepository acquisitions;
    @Autowired ReviewImportPlanRepository plans;
    @Autowired ReviewImportSegmentRepository segments;

    private final UUID org = UUID.randomUUID();
    private ChannelCoverageService service;
    private Channel naver;

    @BeforeEach
    void setUp() {
        service = new ChannelCoverageService(channels, capabilities, accounts, schedules, syncJobs,
                inquiries, reviews, orders, acquisitions);
        naver = new Channel();
        naver.setCode("NAVER");
        naver.setNameKo("네이버");
        naver.setStatus(ChannelStatus.AVAILABLE);
        naver.setSupportsInquiry(true);
        naver.setSupportsReview(true);
        naver.setSupportsOrder(true);
        naver.setSupportsSales(true);
        naver.setSupportsProduct(true);
        naver.setSortOrder(0);
        naver = channels.save(naver);

        SellerAccount account = new SellerAccount();
        account.setOrgId(org);
        account.setChannelId(naver.getId());
        account.setConnectionStatus(ChannelStatus.CONNECTED);
        account.setFileUpload(false);
        accounts.save(account);

        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(naver.getId());
        r.setBody("배송이 빨라요");
        r.setRating(5);
        r.setNegative(false);
        r.setReceivedAt(LocalDate.parse("2026-09-01").atStartOfDay(ZoneOffset.UTC).toInstant());
        r.setContentHash(UUID.randomUUID().toString());
        r.setDedupKeyVersion(2);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        r.setDataOrigin(DataOrigin.REAL);
        reviews.save(r);
    }

    private ChannelCoverageRow reviewRow() {
        List<ChannelCoverageRow> rows = service.coverage(org, List.of("NAVER"));
        return rows.stream().filter(x -> "REVIEW".equals(x.dataType())).findFirst().orElseThrow();
    }

    @Test
    @DisplayName("with no acquisition on record the channel has no last observation — 「아직 확인한 적이 없어요」 is true")
    void noAcquisitionNoInstant() {
        assertThat(reviewRow().lastSuccessfulSyncAt()).isNull();
    }

    @Test
    @DisplayName("a SUCCEEDED guided acquisition IS the channel's last observation, with no run column stamped")
    void succeededAcquisitionIsTheObservation() {
        Instant finished = Instant.parse("2026-09-02T04:30:00Z");
        attempt(SegmentAttemptResult.SUCCEEDED, finished);
        assertThat(reviewRow().lastSuccessfulSyncAt()).isEqualTo(finished);
    }

    @Test
    @DisplayName("a FAILED acquisition is not an observation — a run that did not land rows never reads as fresh")
    void failedAcquisitionIsNotAnObservation() {
        attempt(SegmentAttemptResult.FAILED, Instant.parse("2026-09-02T04:30:00Z"));
        assertThat(reviewRow().lastSuccessfulSyncAt()).isNull();
    }

    private void attempt(SegmentAttemptResult result, Instant finishedAt) {
        ReviewImportPlan plan = new ReviewImportPlan();
        plan.setOrgId(org);
        plan.setSellerAccountId(accounts.findAll().get(0).getId());
        plan.setChannelId(naver.getId());
        plan.setRequestedStart(LocalDate.parse("2026-09-01"));
        plan.setRequestedEnd(LocalDate.parse("2026-09-02"));
        plan = plans.save(plan);

        ReviewImportSegment segment = new ReviewImportSegment();
        segment.setPlanId(plan.getId());
        segment.setOrgId(org);
        segment.setOrdinal(0);
        segment.setSegmentStart(LocalDate.parse("2026-09-01"));
        segment.setSegmentEnd(LocalDate.parse("2026-09-02"));
        segment.setCoverageState(SegmentCoverageState.COVERED);
        segment = segments.save(segment);

        ReviewImportSegmentAttempt a = new ReviewImportSegmentAttempt();
        a.setOrgId(org);
        a.setSegmentId(segment.getId());
        a.setAttemptNo(1);
        a.setResult(result);
        a.setStartedAt(finishedAt.minusSeconds(60));
        a.setFinishedAt(finishedAt);
        acquisitions.save(a);
    }
}
