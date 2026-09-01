package com.sellerops.review.recent;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ProductChannels;
import com.sellerops.common.ApiException;
import com.sellerops.common.MarkupText;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.coverage.ChannelCoverageService;
import com.sellerops.coverage.dto.ChannelCoverageRow;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.recent.dto.RecentReviewItemView;
import com.sellerops.review.recent.dto.RecentReviewsResponse;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The reviews that arrived in a window, across every channel the seller can see — the one read
 * behind 「오늘 새 리뷰 보여줘」 and 「낮은 평점 리뷰만」.
 *
 * <p><b>It composes rows this backend already holds; it contacts no channel.</b> The channel record
 * ({@code ChannelReviewService}) is scoped to one account and ordered for triage; this read is scoped
 * to the ORG and ordered by arrival, because the question it answers is "what came in", not "what
 * needs a look". The two share the sanitizer and the product lookup so the same review reads the
 * same in both places.
 *
 * <p><b>REAL rows only, stated in the query.</b> A demo deployment may hold seeded reviews for its
 * charts, but an AI operator that lists a seeded review as something a buyer wrote this week is the
 * seller's assistant describing a customer who does not exist.
 *
 * <p><b>Coverage rides along, because the rows cannot vouch for themselves.</b> Seven rows for a
 * window look the same whether the channel was read this morning or last month. The per-channel
 * {@link ChannelCoverageRow} for REVIEW is the only thing that can say which, and the caller is
 * expected to refuse 「0건」 for a channel whose row cannot prove freshness.
 */
@Service
public class RecentReviewService {

    static final int DEFAULT_SIZE = 20;
    static final int MAX_SIZE = 50;
    /** 「최근」 with no dates named: today and the six days before it. */
    static final int DEFAULT_WINDOW_DAYS = 7;

    /** The lower bound of "everything this org holds" — the same shape {@code InquiryRowsService} uses. */
    private static final LocalDate BEGINNING = LocalDate.of(1970, 1, 1);
    private static final String DATA_TYPE_REVIEW = "REVIEW";

    private final ReviewRepository reviews;
    private final ProductRepository products;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final ChannelCoverageService coverage;
    private final Clock clock;
    private final com.sellerops.identity.ExecutableIdentityResolver identity;

    @org.springframework.beans.factory.annotation.Autowired
    public RecentReviewService(ReviewRepository reviews, ProductRepository products,
                               SellerAccountRepository accounts, ChannelRepository channels,
                               ChannelCoverageService coverage,
                               com.sellerops.identity.ExecutableIdentityResolver identity) {
        this(reviews, products, accounts, channels, coverage, Clock.systemUTC(), identity);
    }

    /** Test seam with no resolver: every row reads {@code NONE}, the fail-closed identity. */
    RecentReviewService(ReviewRepository reviews, ProductRepository products,
                        SellerAccountRepository accounts, ChannelRepository channels,
                        ChannelCoverageService coverage, Clock clock) {
        this(reviews, products, accounts, channels, coverage, clock,
                com.sellerops.identity.ExecutableIdentityResolver.unresolved());
    }

    RecentReviewService(ReviewRepository reviews, ProductRepository products,
                        SellerAccountRepository accounts, ChannelRepository channels,
                        ChannelCoverageService coverage, Clock clock,
                        com.sellerops.identity.ExecutableIdentityResolver identity) {
        this.identity = identity;
        this.reviews = reviews;
        this.products = products;
        this.accounts = accounts;
        this.channels = channels;
        this.coverage = coverage;
        this.clock = clock;
    }

    /**
     * @param from inclusive calendar date; null means {@code to - 6 days}
     * @param to inclusive calendar date; null means today (UTC, the zone {@code receivedAt} is stored in)
     * @param channel one of {@link ProductChannels#VISIBLE_CODES}, or null for all of them
     * @param productId narrows to one product; org scope is applied by the query, never trusted from here
     */
    @Transactional(readOnly = true)
    public RecentReviewsResponse recent(UUID orgId, LocalDate from, LocalDate to, boolean negativeOnly,
                                        String channel, UUID productId, Integer size) {
        return recent(orgId, from, to, negativeOnly, channel, productId, size, null);
    }

    /**
     * @param order {@code NEWEST} (default) or {@code OLDEST} — which end of the window the first row comes
     *     from (Query Accuracy v1). Anything else is refused, never silently read as newest.
     */
    @Transactional(readOnly = true)
    public RecentReviewsResponse recent(UUID orgId, LocalDate from, LocalDate to, boolean negativeOnly,
                                        String channel, UUID productId, Integer size, String order) {
        boolean oldest = oldestFirst(order);
        LocalDate toDate = to == null ? LocalDate.now(clock) : to;
        // <b>An absent lower bound is NO lower bound</b> (Conversation Contract Correctness v2). This
        // read used to substitute a seven-day window, so 「별점 낮은 리뷰 보여줘」 — a question with no
        // period in it — was answered about a week: three of the eight low-rated reviews the seller
        // held. The caller had already stopped inventing a window for exactly that reason, and the
        // invention simply moved down a layer. {@code GET /api/inquiries/rows} has always read an
        // absent {@code from} as unbounded; one axis cannot mean two things in two READs.
        LocalDate fromDate = from == null ? BEGINNING : from;
        if (fromDate.isAfter(toDate)) {
            throw ApiException.badRequest("조회 기간의 시작일이 종료일보다 늦습니다.");
        }
        List<String> codes = channelCodes(channel);
        int limit = clampSize(size);
        // Reviews store the channel's calendar date as UTC start-of-day, so the window is the same
        // half-open [from, to+1d) every other window read in this repository uses.
        Instant start = fromDate.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant end = toDate.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();

        long total = 0;
        List<Review> merged = new ArrayList<>();
        Map<UUID, SellerAccount> accountByChannel = new java.util.HashMap<>();
        Map<UUID, Channel> channelById = new java.util.HashMap<>();
        for (String code : codes) {
            Optional<Channel> found = channels.findByCode(code);
            if (found.isEmpty()) {
                continue;
            }
            Channel ch = found.get();
            // A channel this org never connected contributes no rows and no count. It is still in the
            // coverage list below as NOT_CONNECTED, which is how the caller learns it was not read.
            Optional<SellerAccount> account = accounts.findByOrgIdAndChannelId(orgId, ch.getId());
            if (account.isEmpty()) {
                continue;
            }
            accountByChannel.put(ch.getId(), account.get());
            channelById.put(ch.getId(), ch);
            total += reviews.countRecentInWindowByChannel(orgId, ch.getId(), negativeOnly, productId, start, end);
            merged.addAll(oldest
                    ? reviews.findOldestInWindowByChannel(orgId, ch.getId(), negativeOnly, productId,
                            start, end, PageRequest.of(0, limit))
                    : reviews.findRecentInWindowByChannel(orgId, ch.getId(), negativeOnly, productId,
                            start, end, PageRequest.of(0, limit)));
        }
        // Each channel page is already in the requested order; the merge re-sorts across channels and
        // cuts, so the first N of the merged list are the first N of the whole window.
        Comparator<Review> byReceipt = oldest
                ? Comparator.comparing(Review::getReceivedAt).thenComparing(Review::getId)
                : Comparator.comparing(Review::getReceivedAt, Comparator.reverseOrder())
                        .thenComparing(Review::getId, Comparator.reverseOrder());
        merged.sort(byReceipt);
        List<Review> page = merged.size() > limit ? merged.subList(0, limit) : merged;

        Map<UUID, Product> byProduct = productsOf(orgId, page);
        Map<UUID, com.sellerops.identity.ExecutableIdentity> identities = identity.forReviews(orgId, page);
        List<RecentReviewItemView> items = page.stream()
                .map(r -> toItem(r, channelById.get(r.getChannelId()), accountByChannel.get(r.getChannelId()),
                        byProduct, identities.getOrDefault(r.getId(), com.sellerops.identity.ExecutableIdentity.NONE)))
                .toList();
        List<ChannelCoverageRow> reviewCoverage = coverage.coverage(orgId, codes).stream()
                .filter(row -> DATA_TYPE_REVIEW.equals(row.dataType()))
                .toList();
        return new RecentReviewsResponse(fromDate, toDate, negativeOnly, total, items, reviewCoverage);
    }

    private static boolean oldestFirst(String order) {
        if (order == null || order.isBlank()) {
            return false;
        }
        return switch (order.strip().toUpperCase(java.util.Locale.ROOT)) {
            case "NEWEST" -> false;
            case "OLDEST" -> true;
            default -> throw ApiException.badRequest("알 수 없는 정렬입니다.");
        };
    }

    private static List<String> channelCodes(String channel) {
        if (channel == null || channel.isBlank()) {
            return ProductChannels.VISIBLE_CODES;
        }
        String code = channel.strip().toUpperCase(java.util.Locale.ROOT);
        if (!ProductChannels.isVisible(code)) {
            // Refused rather than widened: a seller who asked for one channel and silently got all
            // three would read the answer as that channel's.
            throw ApiException.badRequest("알 수 없는 채널입니다.");
        }
        return List.of(code);
    }

    private RecentReviewItemView toItem(Review r, Channel channel, SellerAccount account,
                                        Map<UUID, Product> byProduct,
                                        com.sellerops.identity.ExecutableIdentity executableIdentity) {
        Product product = r.getProductId() == null ? null : byProduct.get(r.getProductId());
        // A rating-only review has no sentence to preview; the sanitizer's text would be blank.
        String preview = ReviewTriageRules.isTextless(r.getBody())
                ? null : VocPreviewSanitizer.sanitize(MarkupText.toPlainText(r.getBody())).text();
        return new RecentReviewItemView(
                r.getId(),
                account == null ? null : account.getId(),
                channel == null ? null : channel.getCode(),
                channel == null ? null : channel.getNameKo(),
                r.getReceivedAt() == null ? null : r.getReceivedAt().atZone(ZoneOffset.UTC).toLocalDate(),
                r.getRating(),
                r.isNegative(),
                preview,
                r.getProductId(),
                product == null ? null : product.getName(),
                r.getReplyState() == null ? null : r.getReplyState().name(),
                executableIdentity.name());
    }

    /** Org-scoped batch lookup — the same shape {@code ChannelReviewService.productsOf} uses. */
    private Map<UUID, Product> productsOf(UUID orgId, List<Review> page) {
        List<UUID> ids = page.stream().map(Review::getProductId).filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return products.findAllByOrgIdAndIdIn(orgId, ids).stream()
                .collect(Collectors.toMap(Product::getId, Function.identity(), (a, b) -> a));
    }

    private static int clampSize(Integer size) {
        if (size == null || size <= 0) {
            return DEFAULT_SIZE;
        }
        return Math.min(MAX_SIZE, size);
    }
}
