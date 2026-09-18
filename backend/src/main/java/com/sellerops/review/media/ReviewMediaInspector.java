package com.sellerops.review.media;

import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.common.MarkupText;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.product.detail.image.DetailImageFetcher;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * <b>Look at a review's photos</b> — the review-photo vision capability's one door.
 *
 * <p>For one review, at most {@link ReviewMediaVisionProperties#MAX_IMAGES_PER_REVIEW} photos not yet inspected are
 * fetched from the channel's CDN (the address must still pass {@link ReviewMediaWriter#acceptableHost}, then every
 * {@code ImageFetchPolicy} check, per hop) and shown to the vision model one at a time with the review's own rating
 * and words. What the model saw is written on the media row; a fetch or model failure is written as that failure, so
 * a row never reads as inspected when it was not.
 *
 * <p>Bytes are held in memory for one call and never stored or logged. The capability is org-gated and off by
 * default; when it is off, this does nothing and every photo stays {@code NOT_INSPECTED}.
 */
@Service
public class ReviewMediaInspector {

    private static final Logger log = LoggerFactory.getLogger(ReviewMediaInspector.class);

    /** What happened to one review's photos in this call. */
    public record Inspection(int inspected, int failed, int alreadyInspected, boolean capabilityOn) {
    }

    private final ReviewMediaVisionProperties properties;
    private final ReviewMediaRepository media;
    private final ReviewRepository reviews;
    private final ReviewMediaVisionGenerator generator;
    private final DetailImageFetcher fetcher;

    @org.springframework.beans.factory.annotation.Autowired
    public ReviewMediaInspector(ReviewMediaVisionProperties properties, ReviewMediaRepository media,
                                ReviewRepository reviews, AgentLlmTransport transport) {
        this(properties, media, reviews,
                new ReviewMediaVisionGenerator(transport, properties.model(), properties.apiKey(),
                        properties.maxOutputTokens(), properties.reasoningEffort()),
                // Constructed here, not injected: a container-wide fetcher bean would make credential-free URL egress
                // available to every class (DetailImageFetchBoundaryTest names this holder).
                new DetailImageFetcher());
    }

    ReviewMediaInspector(ReviewMediaVisionProperties properties, ReviewMediaRepository media, ReviewRepository reviews,
                         ReviewMediaVisionGenerator generator, DetailImageFetcher fetcher) {
        this.properties = properties;
        this.media = media;
        this.reviews = reviews;
        this.generator = generator;
        this.fetcher = fetcher;
    }

    public boolean enabledFor(UUID orgId) {
        return properties.isEnabledFor(orgId);
    }

    public Inspection inspect(UUID orgId, UUID reviewId) {
        List<ReviewMedia> rows = media.findByOrgIdAndReviewIdOrderByOrdinalAsc(orgId, reviewId);
        int already = (int) rows.stream()
                .filter(m -> m.getInspectionStatus() == ReviewMedia.InspectionStatus.INSPECTED).count();
        if (!properties.isEnabledFor(orgId) || rows.isEmpty()) {
            return new Inspection(0, 0, already, properties.isEnabledFor(orgId));
        }
        Review review = reviews.findById(reviewId).filter(r -> orgId.equals(r.getOrgId())).orElse(null);
        if (review == null) {
            return new Inspection(0, 0, already, true);
        }
        String text = VocPreviewSanitizer.redactFullBody(MarkupText.toPlainText(review.getBody())).text();
        int inspected = 0;
        int failed = 0;
        List<ReviewMedia> pending = new ArrayList<>();
        for (ReviewMedia m : rows) {
            if (m.getInspectionStatus() == ReviewMedia.InspectionStatus.NOT_INSPECTED
                    && pending.size() < ReviewMediaVisionProperties.MAX_IMAGES_PER_REVIEW) {
                pending.add(m);
            }
        }
        for (ReviewMedia m : pending) {
            Instant now = Instant.now();
            if (m.getMediaKind() == ReviewMedia.Kind.VIDEO) {
                mark(m, ReviewMedia.InspectionStatus.NOT_AN_IMAGE, "video", now);
                continue;
            }
            if (ReviewMediaWriter.acceptableHost(m.getSourceUrl()).isEmpty()) {
                mark(m, ReviewMedia.InspectionStatus.FETCH_FAILED, "host_refused", now);
                failed++;
                continue;
            }
            DetailImageFetcher.Loaded loaded = fetcher.loadOne(m.getSourceUrl(), m.getOrdinal());
            if (!loaded.ok()) {
                String outcome = loaded.meta().outcome().name();
                boolean notImage = "NOT_AN_IMAGE".equals(outcome);
                mark(m, notImage ? ReviewMedia.InspectionStatus.NOT_AN_IMAGE
                        : ReviewMedia.InspectionStatus.FETCH_FAILED, outcome.toLowerCase(), now);
                if (!notImage) {
                    failed++;
                }
                continue;
            }
            ReviewMediaVisionGenerator.Result result =
                    generator.inspect(loaded.bytes(), loaded.meta().contentType(), review.getRating(), text);
            if (result.observation().isEmpty()) {
                mark(m, ReviewMedia.InspectionStatus.MODEL_FAILED, result.reason(), now);
                failed++;
                continue;
            }
            ReviewMediaVisionGenerator.Observation o = result.observation().get();
            m.setInspectionStatus(ReviewMedia.InspectionStatus.INSPECTED);
            m.setInspectedAt(now);
            m.setInspectionModel(generator.modelVersion());
            m.setDepicts(o.depicts());
            m.setProblemVisible(o.problemVisible());
            m.setProblemDescription(o.problemDescription());
            m.setInspectionFailure(null);
            media.save(m);
            inspected++;
        }
        // Counts and closed words only — never the photo's address or what it shows.
        log.info("review media inspection org={} inspected={} failed={} already={}", orgId, inspected, failed,
                already);
        return new Inspection(inspected, failed, already, true);
    }

    /**
     * The photo's bytes for the seller's own case screen — the same fetch, under the same policy, that inspection
     * uses; no model is called. Served same-origin so the app's image policy stays {@code 'self'}.
     */
    public java.util.Optional<DetailImageFetcher.Loaded> loadForSeller(ReviewMedia m) {
        if (ReviewMediaWriter.acceptableHost(m.getSourceUrl()).isEmpty()) {
            return java.util.Optional.empty();
        }
        DetailImageFetcher.Loaded loaded = fetcher.loadOne(m.getSourceUrl(), m.getOrdinal());
        return loaded.ok() ? java.util.Optional.of(loaded) : java.util.Optional.empty();
    }

    private void mark(ReviewMedia m, ReviewMedia.InspectionStatus status, String failure, Instant at) {
        m.setInspectionStatus(status);
        m.setInspectedAt(at);
        m.setInspectionFailure(failure == null ? null : failure.substring(0, Math.min(40, failure.length())));
        media.save(m);
    }
}
