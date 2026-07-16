package com.sellerops.attention.source;

import com.sellerops.attention.AttentionItemFilters;
import com.sellerops.attention.AttentionSignalType;
import com.sellerops.attention.VocItemFilter;
import com.sellerops.attention.VocWindowSnapshot;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.community.CommunityReplyStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * The Cafe24 {@link VocItemSource}: reads the collected community-article store
 * ({@code cafe24_community_articles}) — the only source over API-collected VOC, and
 * the only one carrying inquiries — behind the channel-generic source seam. NAVER's
 * file-ingest reviews are served separately by {@link IngestedReviewVocItemSource};
 * CAFE24 stays here, since a Cafe24 review can also reach the upload store and two
 * sources claiming the channel would double-count it. All Cafe24-specific policy
 * lives here: the platform
 * time zone ({@link #KST}), the stored source-kind names, the operator-facing source
 * types, and the read-time fail-closed preview. The window arrives as validated
 * calendar dates; this adapter interprets the half-open day boundaries in KST (rows
 * with an unknown source date are excluded upstream by the query — a conservative
 * undercount). No article body is exposed: the row is metadata only, with the preview
 * sanitized by {@link VocPreviewSanitizer}.
 */
@Component
public class Cafe24VocItemSource implements VocItemSource {

    /** Cafe24's explicit platform zone; window "day" boundaries are KST. */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");
    static final String CHANNEL_CODE = "CAFE24";
    static final String SOURCE_KIND_REVIEW = "REVIEW";
    static final String SOURCE_KIND_INQUIRY = "PRODUCT_INQUIRY";
    /** Operator-facing source kinds (the stored PRODUCT_INQUIRY shows as INQUIRY). */
    static final String SOURCE_TYPE_REVIEW = "REVIEW";
    static final String SOURCE_TYPE_INQUIRY = "INQUIRY";

    private final Cafe24CommunityArticleRepository articles;

    public Cafe24VocItemSource(Cafe24CommunityArticleRepository articles) {
        this.articles = articles;
    }

    @Override
    public boolean supports(String channelCode) {
        return CHANNEL_CODE.equals(channelCode);
    }

    @Override
    public VocWindowSnapshot snapshot(UUID orgId, UUID accountId, LocalDate from, LocalDate to) {
        Instant fromInstant = from.atStartOfDay(KST).toInstant();
        Instant toExclusive = to.plusDays(1).atStartOfDay(KST).toInstant();
        // Baseline = the immediately preceding equal-length window, same KST half-open
        // semantics; its exclusive end is exactly the current window's start. Reuses the
        // existing window count query — no new repository method, no server clock.
        long windowDays = ChronoUnit.DAYS.between(from, to) + 1;
        Instant prevFromInstant = from.minusDays(windowDays).atStartOfDay(KST).toInstant();
        return new VocWindowSnapshot(
                articles.countInWindow(orgId, accountId, SOURCE_KIND_REVIEW, fromInstant, toExclusive),
                articles.countInWindow(orgId, accountId, SOURCE_KIND_INQUIRY, fromInstant, toExclusive),
                articles.countInWindowByReplyStatus(orgId, accountId, SOURCE_KIND_INQUIRY,
                        CommunityReplyStatus.PENDING.name(), fromInstant, toExclusive),
                articles.countInWindowByReplyStatus(orgId, accountId, SOURCE_KIND_INQUIRY,
                        CommunityReplyStatus.UNKNOWN.name(), fromInstant, toExclusive),
                articles.countInWindowByRatingBetween(orgId, accountId, SOURCE_KIND_REVIEW,
                        1, 2, fromInstant, toExclusive),
                articles.countInWindowByRatingBetween(orgId, accountId, SOURCE_KIND_REVIEW,
                        3, 3, fromInstant, toExclusive),
                articles.countInWindow(orgId, accountId, SOURCE_KIND_REVIEW, prevFromInstant, fromInstant),
                articles.countInWindow(orgId, accountId, SOURCE_KIND_INQUIRY, prevFromInstant, fromInstant));
    }

    @Override
    public VocItemSlice items(UUID orgId, UUID accountId, String channelCode, String channelNameKo,
                              AttentionSignalType signalType, LocalDate from, LocalDate to, int page, int size) {
        Instant fromInstant = from.atStartOfDay(KST).toInstant();
        Instant toExclusive = to.plusDays(1).atStartOfDay(KST).toInstant();
        VocItemFilter filter = AttentionItemFilters.forType(signalType);

        Page<Cafe24CommunityArticle> result = articles.findInWindowFiltered(
                orgId, accountId, filter.sourceKind(), filter.replyStatus(),
                filter.minRating(), filter.maxRating(), fromInstant, toExclusive,
                PageRequest.of(page, size));
        List<OperatorVocItem> rows = result.getContent().stream()
                .map(a -> toItem(a, signalType, channelCode, channelNameKo))
                .toList();
        return new VocItemSlice(rows, result.getTotalElements());
    }

    private OperatorVocItem toItem(Cafe24CommunityArticle a, AttentionSignalType signalType,
                                   String channelCode, String channelNameKo) {
        String sourceType = SOURCE_KIND_REVIEW.equals(a.getSourceKind()) ? SOURCE_TYPE_REVIEW : SOURCE_TYPE_INQUIRY;
        // Read-time, fail-closed preview — never the raw body, never persisted/logged.
        String rawText = a.getContent() == null || a.getContent().isBlank() ? a.getTitle() : a.getContent();
        String safePreview = VocPreviewSanitizer.sanitize(rawText).text();
        // productName is always null here, and that is a capability limit, not an absence:
        // a community article carries a raw product_no but no product name and no link to
        // `products`, so this store cannot resolve a display name for any row. Resolving it
        // would mean either exposing the raw product_no (an identifier — excluded by the DTO)
        // or inventing a catalog join that does not exist. Null says "not available on this
        // channel"; see the OperatorVocItem javadoc on why that must not read as "no product".
        // actionRef and triageDisposition are always null here, and — like productName above
        // — that is a capability limit, not an absence. Triage is anchored on `reviews`
        // (review_triage.review_id), and a community article is not a review row: it lives in
        // its own store with its own id space. Minting a ref for it would either address a
        // row the anchor cannot reach or invent a second anchor this slice has no grounding
        // to design. So a Cafe24 row is readable and not decidable, and says so honestly
        // rather than offering an affordance that would fail on use. Adding a source here is
        // a product decision, not a mechanical edit — see VocItemRef on why refs are
        // source-qualified precisely so a second store can be added without ambiguity.
        return new OperatorVocItem(channelCode, channelNameKo, sourceType, null, a.getRating(), a.getReplyStatus(),
                kstDate(a.getSourceCreatedAt()), kstDate(a.getCollectedAt()), signalType.name(), safePreview,
                null, null);
    }

    /** Instant → KST calendar date string (date only), or null when unknown. */
    private static String kstDate(Instant instant) {
        return instant == null ? null : instant.atZone(KST).toLocalDate().toString();
    }
}
