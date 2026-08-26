package com.sellerops.proactive;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.ReviewRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>Finished work is not recommended work</b> (Agent Command Center v1 §1-B/§1-C, regression B/C).
 *
 * <p>Both open cases in the canonical Demo Org pointed at work that was done — one at an inquiry the
 * seller had answered in the Cafe24 console, one at a {@code COMPLETED} work item — and the home
 * screen offered both as 「AI가 먼저 확인한 일」. The reconciler owns closing them and has not run;
 * that is a different fix on a different clock. What a READ can do is stop recommending.
 *
 * <p>These cases assert the read, and they assert the counts with it: a section that said
 * 「전체 2건 중 0건」 would be announcing work it is refusing to show.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProactiveRecommendationStalenessTest {

    @Autowired ProactiveCaseRepository cases;
    @Autowired InquiryRepository inquiries;
    @Autowired ReviewRepository reviews;
    @Autowired ChannelRepository channels;
    @Autowired ProductRepository products;
    @Autowired InquiryWorkItemRepository workItems;

    private UUID org;
    private ProactiveCaseService service;

    @BeforeEach
    void setUp() {
        org = UUID.randomUUID();
        service = new ProactiveCaseService(cases, inquiries, reviews, channels, products,
                Clock.fixed(Instant.parse("2026-08-27T09:00:00Z"), ZoneOffset.UTC));
    }

    @Test
    @DisplayName("B — an inquiry the channel already answered is not offered as today's work")
    void answeredInquiryIsNotRecommended() {
        UUID answered = seedInquiry("ANSWERED");
        UUID waiting = seedInquiry("UNANSWERED");
        seedCase(answered, seedWorkItem(answered, InquiryWorkItemPhase.PROPOSED));
        seedCase(waiting, seedWorkItem(waiting, InquiryWorkItemPhase.PROPOSED));

        var response = service.list(org, 10);

        assertThat(response.items()).extracting(v -> v.subjectId()).containsExactly(waiting);
        assertThat(response.total()).isEqualTo(1);
        assertThat(service.summary(org).open()).isEqualTo(1);
    }

    @Test
    @DisplayName("C — a case whose work item is finished is not an active issue")
    void terminalWorkItemIsNotRecommended() {
        UUID stillOpen = seedInquiry("UNANSWERED");
        UUID doneAnyway = seedInquiry("UNANSWERED");
        seedCase(stillOpen, seedWorkItem(stillOpen, InquiryWorkItemPhase.OPEN));
        seedCase(doneAnyway, seedWorkItem(doneAnyway, InquiryWorkItemPhase.COMPLETED));

        var response = service.list(org, 10);

        assertThat(response.items()).extracting(v -> v.subjectId()).containsExactly(stillOpen);
        assertThat(response.total()).isEqualTo(1);
    }

    @Test
    @DisplayName("a dismissed work item is a decision the seller made, not work to re-offer")
    void dismissedWorkItemIsNotRecommended() {
        UUID spam = seedInquiry("UNANSWERED");
        seedCase(spam, seedWorkItem(spam, InquiryWorkItemPhase.DISMISSED));

        assertThat(service.list(org, 10).items()).isEmpty();
    }

    @Test
    @DisplayName("a case with no work item behind it is judged on its inquiry alone")
    void noWorkItemStillRecommends() {
        UUID waiting = seedInquiry("UNANSWERED");
        seedCase(waiting, null);

        assertThat(service.list(org, 10).items()).hasSize(1);
    }

    @Test
    @DisplayName("a synthetic inquiry never becomes today's work")
    void syntheticIsNotRecommended() {
        Inquiry q = inquiry("UNANSWERED");
        q.setDataOrigin(DataOrigin.DEMO_SEED);
        UUID seeded = inquiries.save(q).getId();
        seedCase(seeded, null);

        assertThat(service.list(org, 10).items()).isEmpty();
    }

    private Inquiry inquiry(String status) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setTitle("전선이 몇 가닥까지 들어가나요?");
        q.setBody("몰딩 하나에 몇 가닥이나 넣을 수 있나요?");
        q.setStatus(status);
        q.setDataOrigin(DataOrigin.REAL);
        q.setOperationalState(InquiryOperationalState.ACTIVE);
        q.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        return q;
    }

    private UUID seedInquiry(String status) {
        return inquiries.save(inquiry(status)).getId();
    }

    private UUID seedWorkItem(UUID inquiryId, InquiryWorkItemPhase phase) {
        InquiryWorkItem item = new InquiryWorkItem();
        item.setOrgId(org);
        item.setInquiryId(inquiryId);
        item.setChannelId(UUID.randomUUID());
        item.setSellerAccountId(UUID.randomUUID());
        item.setPhase(phase);
        return workItems.save(item).getId();
    }

    private void seedCase(UUID subjectId, UUID workItemId) {
        ProactiveCase row = new ProactiveCase();
        row.setOrgId(org);
        row.setSubjectKind(ProactiveSubjectKind.INQUIRY);
        row.setSubjectId(subjectId);
        row.setWorkItemId(workItemId);
        row.setSignature(UUID.randomUUID().toString().replace("-", ""));
        row.setSourceState("status=UNANSWERED");
        row.setStatus(ProactiveCaseStatus.PREPARED);
        row.setPriority(ProactivePriority.HIGH);
        row.setReason(ProactiveReason.UNANSWERED_INQUIRY);
        row.setReasonNote(ProactiveReason.UNANSWERED_INQUIRY.noteKo());
        row.setPreparedAction(ProactivePreparedAction.DRAFT_PREPARED);
        cases.save(row);
    }
}
