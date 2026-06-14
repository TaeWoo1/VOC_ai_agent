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

    @Test
    void preservesRawBodyInDatabase() {
        Inquiry stored = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0);
        assertThat(stored.getBody()).isEqualTo(RAW_INQUIRY_BODY);
        assertThat(stored.getBody()).contains("010-1234-5678", "hong@example.com");
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
