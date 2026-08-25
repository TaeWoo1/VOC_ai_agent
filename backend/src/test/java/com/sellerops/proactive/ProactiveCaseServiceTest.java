package com.sellerops.proactive;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.proactive.dto.ProactiveCaseView;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import java.time.Clock;
import java.time.Instant;
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
 * The read surface: what a card says, whose cards a seller sees, and the two marks that only a read
 * can make.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProactiveCaseServiceTest {

    @Autowired ProactiveCaseRepository cases;
    @Autowired InquiryRepository inquiries;
    @Autowired ReviewRepository reviews;
    @Autowired ChannelRepository channels;
    @Autowired ProductRepository products;

    private UUID org;
    private UUID otherOrg;
    private ProactiveCaseService service;
    private Instant now;

    @BeforeEach
    void setUp() {
        org = UUID.randomUUID();
        otherOrg = UUID.randomUUID();
        now = Instant.parse("2026-08-25T09:00:00Z");
        service = new ProactiveCaseService(cases, inquiries, reviews, channels, products,
                Clock.fixed(now, ZoneOffset.UTC));
    }

    @Test
    @DisplayName("a card carries the question, not the customer")
    void theCardIsSanitized() {
        UUID inquiryId = seedInquiry(org, "환불 문의", "제 번호는 010-1234-5678 입니다. 연락 주세요.");
        seedCase(org, ProactiveSubjectKind.INQUIRY, inquiryId, ProactivePriority.HIGH,
                ProactiveReason.UNANSWERED_INQUIRY);

        ProactiveCaseView card = service.list(org, 10).items().get(0);

        assertThat(card.snippet()).isEqualTo("환불 문의");
        assertThat(card.snippet()).doesNotContain("010");
    }

    @Test
    @DisplayName("a titleless question falls back to the same masked preview the inbox shows")
    void aTitlelessQuestionIsMasked() {
        UUID inquiryId = seedInquiry(org, "  ", "연락처 010-1234-5678 로 부탁드립니다");
        seedCase(org, ProactiveSubjectKind.INQUIRY, inquiryId, ProactivePriority.HIGH,
                ProactiveReason.UNANSWERED_INQUIRY);

        ProactiveCaseView card = service.list(org, 10).items().get(0);

        assertThat(card.snippet()).doesNotContain("1234").isNotBlank();
    }

    @Test
    @DisplayName("one org never sees another's prepared work")
    void theListIsOrgScoped() {
        UUID mine = seedInquiry(org, "내 문의", "본문");
        UUID theirs = seedInquiry(otherOrg, "다른 회사 문의", "본문");
        seedCase(org, ProactiveSubjectKind.INQUIRY, mine, ProactivePriority.HIGH,
                ProactiveReason.UNANSWERED_INQUIRY);
        seedCase(otherOrg, ProactiveSubjectKind.INQUIRY, theirs, ProactivePriority.HIGH,
                ProactiveReason.UNANSWERED_INQUIRY);

        assertThat(service.list(org, 10).items()).singleElement()
                .satisfies(card -> assertThat(card.subjectId()).isEqualTo(mine));
        assertThat(service.list(org, 10).total()).isEqualTo(1);
    }

    @Test
    @DisplayName("a card whose subject is gone is dropped, never rendered blank")
    void aMissingSubjectIsDropped() {
        seedCase(org, ProactiveSubjectKind.INQUIRY, UUID.randomUUID(), ProactivePriority.HIGH,
                ProactiveReason.UNANSWERED_INQUIRY);

        assertThat(service.list(org, 10).items()).isEmpty();
    }

    @Test
    @DisplayName("urgent work sorts first, by the declared rank rather than by the enum's spelling")
    void highSortsFirst() {
        UUID review = seedReview(org);
        UUID inquiry = seedInquiry(org, "배송 문의", "본문");
        seedCase(org, ProactiveSubjectKind.REVIEW, review, ProactivePriority.NORMAL,
                ProactiveReason.NEGATIVE_REVIEW);
        seedCase(org, ProactiveSubjectKind.INQUIRY, inquiry, ProactivePriority.HIGH,
                ProactiveReason.UNANSWERED_INQUIRY);

        List<ProactiveCaseView> items = service.list(org, 10).items();

        assertThat(items).extracting(ProactiveCaseView::priority).containsExactly("HIGH", "NORMAL");
        assertThat(service.list(org, 10).high()).isEqualTo(1);
    }

    @Test
    @DisplayName("surfaced means a seller could have seen it — recorded once, on the first read")
    void surfacedIsRecordedOnce() {
        UUID inquiry = seedInquiry(org, "배송 문의", "본문");
        UUID caseId = seedCase(org, ProactiveSubjectKind.INQUIRY, inquiry, ProactivePriority.HIGH,
                ProactiveReason.UNANSWERED_INQUIRY);

        assertThat(cases.findById(caseId).orElseThrow().getSurfacedAt()).isNull();
        service.list(org, 10);
        Instant first = cases.findById(caseId).orElseThrow().getSurfacedAt();
        assertThat(first).isEqualTo(now);

        // A later read is not a later first sighting.
        new ProactiveCaseService(cases, inquiries, reviews, channels, products,
                Clock.fixed(now.plusSeconds(3600), ZoneOffset.UTC)).list(org, 10);
        assertThat(cases.findById(caseId).orElseThrow().getSurfacedAt()).isEqualTo(first);
    }

    @Test
    @DisplayName("opening records the first look, and refuses a case from another org")
    void openRecordsTheFirstLook() {
        UUID inquiry = seedInquiry(org, "배송 문의", "본문");
        UUID caseId = seedCase(org, ProactiveSubjectKind.INQUIRY, inquiry, ProactivePriority.HIGH,
                ProactiveReason.UNANSWERED_INQUIRY);

        service.open(org, caseId);
        assertThat(cases.findById(caseId).orElseThrow().getOpenedAt()).isEqualTo(now);

        assertThatThrownBy(() -> service.open(otherOrg, caseId)).isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("the retention measure is a median, so one abandoned case cannot invent a trend")
    void theLatencyIsAMedian() {
        Instant base = Instant.parse("2026-08-25T00:00:00Z");
        List<Object[]> pairs = List.of(
                new Object[] {base, base.plusSeconds(60)},
                new Object[] {base, base.plusSeconds(120)},
                new Object[] {base, base.plusSeconds(999_999)});

        assertThat(ProactiveCaseService.medianSeconds(pairs)).isEqualTo(120);
        assertThat(ProactiveCaseService.medianSeconds(List.of()))
                .as("never zero — an unmeasured median must not read as instant")
                .isNull();
    }

    // ------------------------------------------------------------------ seeding

    private UUID seedInquiry(UUID orgId, String title, String body) {
        Inquiry q = new Inquiry();
        q.setOrgId(orgId);
        q.setChannelId(UUID.randomUUID());
        q.setTitle(title);
        q.setBody(body);
        q.setStatus("UNANSWERED");
        q.setDataOrigin(DataOrigin.REAL);
        q.setOperationalState(InquiryOperationalState.ACTIVE);
        q.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        return inquiries.save(q).getId();
    }

    private UUID seedReview(UUID orgId) {
        Review r = new Review();
        r.setOrgId(orgId);
        r.setChannelId(UUID.randomUUID());
        r.setRating(1);
        r.setBody("포장이 찢어져 있었습니다");
        r.setNegative(true);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        r.setDataOrigin(DataOrigin.REAL);
        r.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        return reviews.save(r).getId();
    }

    private UUID seedCase(UUID orgId, ProactiveSubjectKind kind, UUID subjectId,
                          ProactivePriority priority, ProactiveReason reason) {
        ProactiveCase row = new ProactiveCase();
        row.setOrgId(orgId);
        row.setSubjectKind(kind);
        row.setSubjectId(subjectId);
        row.setSignature(UUID.randomUUID().toString().replace("-", ""));
        row.setSourceState("status=UNANSWERED");
        row.setStatus(ProactiveCaseStatus.PREPARED);
        row.setPriority(priority);
        row.setReason(reason);
        row.setReasonNote(reason.noteKo());
        row.setPreparedAction(ProactivePreparedAction.DRAFT_PREPARED);
        return cases.save(row).getId();
    }
}
