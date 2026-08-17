package com.sellerops.inbox;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.inbox.dto.FeedItem;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.lang.reflect.RecordComponent;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InboxServiceTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired ChannelRepository channels;
    @Autowired ProductRepository products;

    private InboxService service;
    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    private static final String RAW_INQUIRY_BODY =
            "재입고 문의드립니다. 010-1234-5678 또는 hong@example.com 으로 연락주세요.";
    private static final String CLEAN_REVIEW_BODY = "접착력이 약해 금방 떨어졌어요. 재구매 의사 없습니다.";

    @BeforeEach
    void setUp() {
        service = new InboxService(inquiries, reviews, channels, products);

        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channel);
        q.setAuthor("홍길동");
        q.setBody(RAW_INQUIRY_BODY);
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2026-06-10T00:00:00Z"));
        inquiries.save(q);

        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channel);
        r.setRating(1);
        r.setBody(CLEAN_REVIEW_BODY);
        r.setNegative(true);
        r.setReceivedAt(Instant.parse("2026-06-09T00:00:00Z"));
        reviews.save(r);
    }

    @Test
    void masksPhoneAndEmailInInquirySnippet() {
        FeedItem inquiry = service.inbox(org).items().stream()
                .filter(i -> i.type().equals("INQUIRY")).findFirst().orElseThrow();

        assertThat(inquiry.snippet()).contains("[전화번호]", "[이메일]");
        assertThat(inquiry.snippet()).doesNotContain("010-1234-5678", "hong@example.com");
    }

    @Test
    void leavesCleanReviewSnippetReadable() {
        FeedItem review = service.inbox(org).items().stream()
                .filter(i -> i.type().equals("REVIEW")).findFirst().orElseThrow();

        assertThat(review.snippet()).isEqualTo(CLEAN_REVIEW_BODY);
    }

    /**
     * Product assembly A4: the unanswered count is counted server-side, not derived from the capped rows,
     * and `type=INQUIRY` reads inquiries only.
     */
    @Test
    void countsUnansweredInquiriesUncappedAndFiltersByType() {
        for (int i = 0; i < 3; i++) {
            Inquiry extra = new Inquiry();
            extra.setOrgId(org);
            extra.setChannelId(channel);
            extra.setBody("추가 문의 " + i);
            extra.setStatus("UNANSWERED");
            extra.setReceivedAt(Instant.parse("2026-06-0" + (1 + i) + "T00:00:00Z"));
            inquiries.save(extra);
        }
        var page = service.inbox(org, "INQUIRY", 2);
        assertThat(page.items()).hasSize(2);
        assertThat(page.items()).allMatch(item -> item.type().equals("INQUIRY"));
        assertThat(page.unansweredInquiries())
                .isEqualTo(inquiries.countByOrgIdAndStatus(org, "UNANSWERED"))
                .isGreaterThanOrEqualTo(3);
        var reviewsOnly = service.inbox(org, "REVIEW", 50);
        assertThat(reviewsOnly.items()).isNotEmpty().allMatch(item -> item.type().equals("REVIEW"));
    }

    /** Product assembly A2 (2026-08-18): a row carries its channel id so a client can resolve it to an account. */
    @Test
    void carriesTheChannelIdOnEveryRow() {
        for (FeedItem item : service.inbox(org).items()) {
            assertThat(item.channelId()).isEqualTo(channel.toString());
        }
    }

    @Test
    void preservesRawBodyInDatabase() {
        Inquiry stored = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0);
        assertThat(stored.getBody()).isEqualTo(RAW_INQUIRY_BODY);
        assertThat(stored.getBody()).contains("010-1234-5678", "hong@example.com");
    }

    @Test
    void feedItemCarriesSourceId() {
        // The source row UUID is the join key to item-analysis. Every row must
        // carry it, and it must equal the underlying inquiry/review id.
        String inquiryId = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0)
                .getId().toString();
        String reviewId = reviews.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0)
                .getId().toString();

        for (FeedItem item : service.inbox(org).items()) {
            assertThat(item.id()).isNotBlank();
        }
        FeedItem inquiry = service.inbox(org).items().stream()
                .filter(i -> i.type().equals("INQUIRY")).findFirst().orElseThrow();
        FeedItem review = service.inbox(org).items().stream()
                .filter(i -> i.type().equals("REVIEW")).findFirst().orElseThrow();
        assertThat(inquiry.id()).isEqualTo(inquiryId);
        assertThat(review.id()).isEqualTo(reviewId);
    }

    @Test
    void secretInquiryStaysInTheQueueFeedButIsExcludedFromTheDashboardPreview() {
        Inquiry secret = new Inquiry();
        secret.setOrgId(org);
        secret.setChannelId(channel);
        secret.setBody("비밀 문의 본문");
        secret.setStatus("UNANSWERED");
        secret.setSecret(true);
        secret.setReceivedAt(Instant.parse("2026-06-11T00:00:00Z"));
        inquiries.save(secret);
        String secretId = secret.getId().toString();

        // Work queue keeps it (default feed = includeSecret).
        assertThat(service.recentFeed(org, 50))
                .anyMatch(i -> i.id().equals(secretId));
        // Dashboard preview (includeSecret=false) omits it, but the null-flag inquiry stays.
        List<FeedItem> preview = service.recentFeed(org, 50, false);
        assertThat(preview).noneMatch(i -> i.id().equals(secretId));
        assertThat(preview).anyMatch(i -> i.type().equals("INQUIRY"));
    }

    @Test
    void feedItemDoesNotExposeAuthor() {
        // Structural guarantee: the DTO has no author component...
        boolean hasAuthorComponent = Arrays.stream(FeedItem.class.getRecordComponents())
                .map(RecordComponent::getName)
                .anyMatch(n -> n.equals("author"));
        assertThat(hasAuthorComponent).isFalse();

        // ...and the author value does not leak into any returned string field.
        for (FeedItem item : service.inbox(org).items()) {
            assertThat(item.channelNameKo()).doesNotContain("홍길동");
            assertThat(item.productName()).doesNotContain("홍길동");
            assertThat(item.snippet()).doesNotContain("홍길동");
        }
    }
}
