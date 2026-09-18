package com.sellerops.review.media;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.product.detail.image.DetailImageFetcher;
import com.sellerops.product.detail.image.FetchedImage;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>A review photo, observed → fetched → looked at</b> (Customer Ops Demo Closure v1), with the one distinction the
 * lane exists to keep: a photo is «inspected» only when a vision model looked at its bytes. A stored address, a count,
 * a refused fetch or a failed model call never reads as inspected.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewMediaLaneTest {

    private static final String PHOTO = "https://shop-phinf.pstatic.net/20260917_1/review_photo.jpg";

    @Autowired ReviewMediaRepository media;
    @Autowired ReviewRepository reviews;

    private final UUID org = UUID.randomUUID();
    private Review review;
    private ReviewMediaWriter writer;

    @BeforeEach
    void seed() {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(UUID.randomUUID());
        r.setRating(5);
        r.setBody("별은 5개인데 모서리가 깨져서 왔어요.");
        r.setReceivedAt(Instant.parse("2026-09-17T00:00:00Z"));
        r.setMediaCount(1);
        r.setMediaCountObserved(true);
        review = reviews.save(r);
        writer = new ReviewMediaWriter(media);
    }

    @Test
    @DisplayName("only the channel's own image CDN over https is stored; a changed address resets what was seen")
    void theWriterAcceptsOnlyTheChannelCdn() {
        assertThat(ReviewMediaWriter.acceptableHost(PHOTO)).contains("shop-phinf.pstatic.net");
        assertThat(ReviewMediaWriter.acceptableHost("http://shop-phinf.pstatic.net/a.jpg")).isEmpty();
        assertThat(ReviewMediaWriter.acceptableHost("https://evil.example/a.jpg")).isEmpty();
        assertThat(ReviewMediaWriter.acceptableHost("https://pstatic.net.evil.example/a.jpg")).isEmpty();
        assertThat(ReviewMediaWriter.acceptableHost("https://user@shop-phinf.pstatic.net/a.jpg")).isEmpty();

        int stored = writer.record(org, review.getId(), List.of(
                new ReviewMediaWriter.Attachment(PHOTO, ReviewMedia.Kind.IMAGE),
                new ReviewMediaWriter.Attachment("https://evil.example/b.jpg", ReviewMedia.Kind.IMAGE)),
                "NAVER_REVIEW_OBSERVE_V1", Instant.now());
        assertThat(stored).isEqualTo(1);
        ReviewMedia row = media.findByOrgIdAndReviewIdOrderByOrdinalAsc(org, review.getId()).get(0);
        assertThat(row.getInspectionStatus()).isEqualTo(ReviewMedia.InspectionStatus.NOT_INSPECTED);
        assertThat(row.getDepicts()).isNull();

        row.setInspectionStatus(ReviewMedia.InspectionStatus.INSPECTED);
        row.setDepicts("깨진 모서리");
        row.setProblemVisible(ReviewMedia.ProblemVisible.YES);
        media.save(row);
        writer.record(org, review.getId(), List.of(new ReviewMediaWriter.Attachment(
                "https://shop-phinf.pstatic.net/20260917_1/another.jpg", ReviewMedia.Kind.IMAGE)),
                "NAVER_REVIEW_OBSERVE_V1", Instant.now());
        ReviewMedia moved = media.findByOrgIdAndReviewIdOrderByOrdinalAsc(org, review.getId()).get(0);
        assertThat(moved.getInspectionStatus()).isEqualTo(ReviewMedia.InspectionStatus.NOT_INSPECTED);
        assertThat(moved.getDepicts()).as("what was seen in the old photo does not describe the new one").isNull();
    }

    @Test
    @DisplayName("the inspector fetches the stored photo and records what the vision model saw")
    void aPhotoIsInspectedOnlyWhenTheModelLooked() {
        writer.record(org, review.getId(), List.of(new ReviewMediaWriter.Attachment(PHOTO, ReviewMedia.Kind.IMAGE)),
                "NAVER_REVIEW_OBSERVE_V1", Instant.now());
        AtomicReference<String> sent = new AtomicReference<>();
        ReviewMediaInspector inspector = inspector(true, sent,
                "{\"depicts\":\"모서리가 깨진 흰색 몰딩\",\"problemVisible\":\"YES\","
                        + "\"problemDescription\":\"한쪽 모서리가 깨져 있습니다\"}");

        ReviewMediaInspector.Inspection result = inspector.inspect(org, review.getId());

        assertThat(result.inspected()).isEqualTo(1);
        ReviewMedia row = media.findByOrgIdAndReviewIdOrderByOrdinalAsc(org, review.getId()).get(0);
        assertThat(row.getInspectionStatus()).isEqualTo(ReviewMedia.InspectionStatus.INSPECTED);
        assertThat(row.getProblemVisible()).isEqualTo(ReviewMedia.ProblemVisible.YES);
        assertThat(row.getDepicts()).isEqualTo("모서리가 깨진 흰색 몰딩");
        assertThat(row.getInspectionModel()).startsWith("review-media-vision/v1+openai:");

        // The payload floor: the photo travels as bytes, never as its address; the review's own words and rating go
        // with it; nothing identifying the shop or the buyer does.
        assertThat(sent.get()).contains("data:image/jpeg;base64,");
        assertThat(sent.get()).doesNotContain("pstatic.net");
        assertThat(sent.get()).contains("모서리가 깨져서 왔어요").contains("별점: 5점");
        assertThat(sent.get()).doesNotContain(review.getId().toString()).doesNotContain(org.toString());

        // Inspected once: a second call looks at nothing again.
        AtomicReference<String> again = new AtomicReference<>();
        assertThat(inspector(true, again, "{}").inspect(org, review.getId()).inspected()).isZero();
        assertThat(again.get()).isNull();
    }

    @Test
    @DisplayName("capability off, a refused fetch or an off-schema answer never reads as inspected")
    void failuresAreNamedNotSeen() {
        writer.record(org, review.getId(), List.of(new ReviewMediaWriter.Attachment(PHOTO, ReviewMedia.Kind.IMAGE)),
                "NAVER_REVIEW_OBSERVE_V1", Instant.now());

        AtomicReference<String> off = new AtomicReference<>();
        assertThat(inspector(false, off, "{}").inspect(org, review.getId()).capabilityOn()).isFalse();
        assertThat(off.get()).as("off means no request at all").isNull();
        assertThat(media.findByOrgIdAndReviewIdOrderByOrdinalAsc(org, review.getId()).get(0).getInspectionStatus())
                .isEqualTo(ReviewMedia.InspectionStatus.NOT_INSPECTED);

        ReviewMediaInspector refused = new ReviewMediaInspector(properties(true), media, reviews,
                new ReviewMediaVisionGenerator(counting(new AtomicInteger()), "gpt-5.6-terra", "k", 600, null),
                new DetailImageFetcher() {
                    @Override
                    public Loaded loadOne(String url, int ordinal) {
                        return new Loaded(new FetchedImage(ordinal, FetchedImage.Outcome.REFUSED_PRIVATE_ADDRESS,
                                null, 0, null, 0, 0), null);
                    }
                });
        refused.inspect(org, review.getId());
        ReviewMedia row = media.findByOrgIdAndReviewIdOrderByOrdinalAsc(org, review.getId()).get(0);
        assertThat(row.getInspectionStatus()).isEqualTo(ReviewMedia.InspectionStatus.FETCH_FAILED);
        assertThat(row.getDepicts()).isNull();

        ReviewMediaWriter.resetInspection(row);
        media.save(row);
        inspector(true, new AtomicReference<>(), "{\"depicts\":\"\",\"problemVisible\":\"MAYBE\"}")
                .inspect(org, review.getId());
        assertThat(media.findByOrgIdAndReviewIdOrderByOrdinalAsc(org, review.getId()).get(0).getInspectionStatus())
                .isEqualTo(ReviewMedia.InspectionStatus.MODEL_FAILED);
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────

    private ReviewMediaInspector inspector(boolean on, AtomicReference<String> sent, String modelJson) {
        AgentLlmTransport transport = (uri, headers, body) -> {
            sent.set(body);
            String content = modelJson.replace("\\", "\\\\").replace("\"", "\\\"");
            return new AgentLlmTransport.Response(200,
                    "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"" + content + "\"}}]}", 5);
        };
        return new ReviewMediaInspector(properties(on), media, reviews,
                new ReviewMediaVisionGenerator(transport, "gpt-5.6-terra", "k", 600, null),
                new DetailImageFetcher() {
                    @Override
                    public Loaded loadOne(String url, int ordinal) {
                        return new Loaded(new FetchedImage(ordinal, FetchedImage.Outcome.OK, "sha", 4, "image/jpeg",
                                0, 0), new byte[] {1, 2, 3, 4});
                    }
                });
    }

    private ReviewMediaVisionProperties properties(boolean on) {
        return new ReviewMediaVisionProperties(on, org.toString(), "gpt-5.6-terra", "k", 600, "none");
    }

    private static AgentLlmTransport counting(AtomicInteger calls) {
        return (uri, headers, body) -> {
            calls.incrementAndGet();
            return new AgentLlmTransport.Response(500, "", 1);
        };
    }
}
