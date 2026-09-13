package com.sellerops.channel;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
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
 * <b>Core data presence is not connector availability.</b>
 *
 * <p>{@code ProductChannels} answers «what can a seller connect», and it was being asked «what does
 * this seller have». Measured 2026-09-13: an org whose only content was one uploaded GMARKET review
 * had the backend report one undecided review while the Home said 「판매 채널을 연결하면 시작할 수
 * 있습니다」 — the channel had no row in the table the screen reads, so the screen could not see it.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class OrgChannelVisibilityTest {

    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;

    private final UUID org = UUID.randomUUID();
    private OrgChannelVisibility visibility;

    @BeforeEach
    void setUp() {
        visibility = new OrgChannelVisibility(channels, reviews, inquiries);
    }

    @Test
    @DisplayName("an org holding nothing sees exactly the connectable set, in its own order")
    void nothingHeldIsTheConnectableSet() {
        assertThat(visibility.codesFor(org)).isEqualTo(ProductChannels.VISIBLE_CODES);
    }

    @Test
    @DisplayName("a channel this org holds reviews on is accounted for, connectable or not")
    void aDataBearingChannelIsAccountedFor() {
        review(channel("GMARKET", "G마켓").getId());

        List<String> codes = visibility.codesFor(org);

        assertThat(codes).contains("GMARKET");
        // Connectable first, always: a channel never jumps the list by having rows.
        assertThat(codes.subList(0, ProductChannels.VISIBLE_CODES.size()))
                .isEqualTo(ProductChannels.VISIBLE_CODES);
        assertThat(codes).endsWith("GMARKET");
    }

    @Test
    @DisplayName("another org's rows do not widen this one's")
    void theWideningIsOrgScoped() {
        UUID gmarket = channel("GMARKET", "G마켓").getId();
        Review other = new Review();
        other.setOrgId(UUID.randomUUID());
        other.setChannelId(gmarket);
        other.setBody("남의 org 리뷰");
        other.setRating(1);
        other.setNegative(true);
        other.setReceivedAt(Instant.parse("2026-09-01T00:00:00Z"));
        other.setContentHash(UUID.randomUUID().toString());
        other.setDedupKeyVersion(2);
        other.setReplyState(ReviewReplyState.UNKNOWN);
        reviews.save(other);

        assertThat(visibility.codesFor(org)).isEqualTo(ProductChannels.VISIBLE_CODES);
    }

    @Test
    @DisplayName("a connectable channel is never listed twice for holding rows")
    void aConnectableChannelIsNotDuplicated() {
        review(channel("CAFE24", "카페24").getId());

        assertThat(visibility.codesFor(org)).isEqualTo(ProductChannels.VISIBLE_CODES);
    }

    @Test
    @DisplayName("ProductChannels is unchanged — this widens a question, not the connectable set")
    void theConnectableSetIsUntouched() {
        review(channel("GMARKET", "G마켓").getId());

        assertThat(ProductChannels.VISIBLE_CODES).containsExactly("NAVER", "COUPANG", "CAFE24");
        assertThat(ProductChannels.isVisible("GMARKET")).isFalse();
    }

    private Channel channel(String code, String nameKo) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(nameKo);
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        return channels.save(ch);
    }

    private void review(UUID channelId) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setBody("업로드한 리뷰");
        r.setRating(2);
        r.setNegative(true);
        r.setReceivedAt(Instant.parse("2026-09-01T00:00:00Z"));
        r.setContentHash(UUID.randomUUID().toString());
        r.setDedupKeyVersion(2);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        reviews.save(r);
    }
}
