package com.sellerops.review.naver;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.common.DataOrigin;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>NAVER Review Reply Enrichment</b> — the seller's published reply text, onto the canonical review the export
 * already stored.
 *
 * <p>The export stays the bulk history source: it states which reviews have a reply (답글여부) and when. It never
 * carries the text, and neither does the review list's row model (census M2, 2026-09-18). The text is on the review's
 * detail in Seller Center, so a bounded READ opens exactly the reviews this service names ({@link #targets}) and hands
 * back what it read ({@link #record}). Nothing here reaches a channel.
 *
 * <p><b>Matched by the review's own id</b> — the export's 리뷰글번호, the value the detail opens — on this organisation's
 * NAVER channel, and only onto a review the channel already says was replied to. A reading for any other review is
 * refused rather than stored somewhere it might be believed.
 *
 * <p><b>Idempotent.</b> The same text read again changes nothing; different text replaces it and is counted, because a
 * seller may edit a reply.
 */
@Service
public class NaverReviewReplyEnrichmentService {

    private static final Logger log = LoggerFactory.getLogger(NaverReviewReplyEnrichmentService.class);

    public static final String SOURCE = "NAVER_REVIEW_DETAIL_V1";
    static final int MAX_TARGETS = 20;
    static final int MAX_REPLY_CHARS = 4000;
    private static final Pattern REVIEW_ID = Pattern.compile("\\d{6,20}");
    private static final String NAVER = "NAVER";

    /** One review whose reply text is still unread. {@code receivedOn} lets the operator set the list period. */
    public record Target(UUID reviewId, String sourceReviewId, UUID productId, String productName, Integer rating,
                         java.time.LocalDate receivedOn, java.time.LocalDate repliedOn) {
    }

    /** What one detail read handed back. {@code repliedAt} is ISO-8601 when the page stated it. */
    public record Observation(String sourceReviewId, String replyText, String repliedAt) {
    }

    public record Result(int recorded, int unchanged, int refused) {
    }

    private final ReviewRepository reviews;
    private final ChannelRepository channels;
    private final EntityManager em;
    private final com.sellerops.product.ProductRepository products;

    public NaverReviewReplyEnrichmentService(ReviewRepository reviews, ChannelRepository channels, EntityManager em,
                                             com.sellerops.product.ProductRepository products) {
        this.reviews = reviews;
        this.channels = channels;
        this.em = em;
        this.products = products;
    }

    /** Replied NAVER reviews of this organisation whose reply text has not been read, newest first. */
    @Transactional(readOnly = true)
    public List<Target> targets(UUID orgId, int limit) {
        UUID naver = naverChannel();
        return em.createQuery("""
                        select r from Review r
                        where r.orgId = :org and r.channelId = :naver and r.replyState = :answered
                          and r.externalId is not null and r.sellerReplyBody is null and r.dataOrigin = :real
                        order by r.receivedAt desc
                        """, Review.class)
                .setParameter("org", orgId).setParameter("naver", naver)
                .setParameter("answered", ReviewReplyState.ANSWERED).setParameter("real", DataOrigin.REAL)
                .setMaxResults(Math.max(1, Math.min(limit, MAX_TARGETS)))
                .getResultList().stream()
                .filter(r -> REVIEW_ID.matcher(r.getExternalId()).matches())
                .map(r -> new Target(r.getId(), r.getExternalId(), r.getProductId(), productName(orgId, r.getProductId()),
                        r.getRating(), dateOf(r.getReceivedAt()), dateOf(r.getRepliedAt())))
                .toList();
    }

    @Transactional
    public Result record(UUID orgId, List<Observation> observations) {
        if (observations == null || observations.isEmpty() || observations.size() > MAX_TARGETS) {
            throw ApiException.badRequest("답글 읽기 결과가 올바르지 않습니다.");
        }
        UUID naver = naverChannel();
        Instant now = Instant.now();
        int recorded = 0;
        int unchanged = 0;
        int refused = 0;
        Set<String> seen = new HashSet<>();
        for (Observation o : observations) {
            if (o == null || o.sourceReviewId() == null || !REVIEW_ID.matcher(o.sourceReviewId()).matches()
                    || !seen.add(o.sourceReviewId()) || o.replyText() == null || o.replyText().isBlank()
                    || o.replyText().length() > MAX_REPLY_CHARS) {
                refused++;
                continue;
            }
            Optional<Review> found = reviews.findByOrgIdAndChannelIdAndExternalId(orgId, naver, o.sourceReviewId())
                    .filter(r -> r.getReplyState() == ReviewReplyState.ANSWERED);
            if (found.isEmpty()) {
                // Not this organisation's replied NAVER review: refused, never stored against a guess.
                refused++;
                continue;
            }
            Review r = found.get();
            String text = o.replyText().strip();
            if (text.equals(r.getSellerReplyBody())) {
                unchanged++;
                continue;
            }
            r.setSellerReplyBody(text);
            r.setSellerReplyAt(parse(o.repliedAt()));
            r.setSellerReplyObservedAt(now);
            r.setSellerReplySource(SOURCE);
            reviews.save(r);
            recorded++;
        }
        // Counts only — never the reply text or the review.
        log.info("naver review reply enrichment org={} recorded={} unchanged={} refused={}", orgId, recorded,
                unchanged, refused);
        return new Result(recorded, unchanged, refused);
    }

    private String productName(UUID orgId, UUID productId) {
        return productId == null ? null : products.findById(productId).filter(p -> orgId.equals(p.getOrgId()))
                .map(com.sellerops.product.OperatorProductName::displayNameOrNull).orElse(null);
    }

    private UUID naverChannel() {
        return channels.findByCode(NAVER).map(Channel::getId)
                .orElseThrow(() -> ApiException.notFound("네이버 채널이 없습니다."));
    }

    private static Instant parse(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(value.strip()).toInstant();
        } catch (Exception unreadable) {
            return null;
        }
    }

    private static java.time.LocalDate dateOf(Instant at) {
        return at == null ? null : java.time.LocalDate.ofInstant(at, java.time.ZoneId.of("Asia/Seoul"));
    }
}
