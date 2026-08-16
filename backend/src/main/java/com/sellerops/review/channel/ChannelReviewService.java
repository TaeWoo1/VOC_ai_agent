package com.sellerops.review.channel;

import com.sellerops.common.ApiException;
import com.sellerops.common.RedactedBody;
import com.sellerops.common.SafePreviewResult;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.itemanalysis.ItemAnalysis;
import com.sellerops.itemanalysis.ItemAnalysisCategories;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.channel.dto.ChannelReviewDetailView;
import com.sellerops.review.channel.dto.ChannelReviewItemView;
import com.sellerops.review.channel.dto.ChannelReviewPageView;
import com.sellerops.review.channel.dto.ChannelReviewTriageSummaryView;
import com.sellerops.review.triage.ReviewTriageNote;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

/**
 * The seller's own record of what buyers wrote on a connected channel.
 *
 * <p><b>It is a record, not a work queue.</b> Every other review read in this codebase narrows to something
 * the operator must act on. Coupang gives sellers no way to answer a 상품평, so "needs a reply" is not a
 * subset that means anything here — and a list that showed only actionable reviews would show almost none of
 * the seller's VOC. Nothing is hidden by default; the record stays whole.
 *
 * <p><b>What Review Triage v1 added is an ORDER and an EXPLANATION, not a queue.</b> The default sort is now
 * {@code attention} (확인 필요 우선), every row carries a {@link ReviewTriageNote} saying which tier it is in
 * and why, and the page carries a summary of how the whole record divides. No review is filtered away unless
 * the operator asks, nothing is marked done, and no tier promises that anything happens next — see
 * {@code docs/slices/review-triage-v1.md}. {@code sort=lowest} and {@code sort=newest} are unchanged.
 *
 * <p><b>The tier is decided by the rating and whether there is text, and by nothing else.</b> Body-derived
 * material (the stored analysis category, and how often it repeats) reaches the operator only as a citation
 * inside the note. That boundary is {@code contracts/review-eval/naver/v1/RUBRIC.md} §5, which forbids
 * surfacing an unmeasured text detector, and the label seed behind it is still empty.
 *
 * <p><b>New is derived, never stored.</b> A review is new when it was written into the database at or after
 * the most recent review import for this account started. No read flag, no per-review state: the question a
 * seller asks after a sync is "what came in this time", and that has an answer already.
 *
 * <p><b>Coverage is carried, not implied.</b> The page reports whether the last import claimed to have
 * covered the list, because a list of reviews cannot say so itself — an acquisition that stopped early looks
 * exactly like a channel with fewer reviews.
 *
 * <p>All text leaves through {@link VocPreviewSanitizer}: a redacted one-line preview in the list, the
 * redacted full body in the detail. What {@code [쿠팡에서 보기]} matches a live row on never leaves through
 * here at all — it is resolved from the stored review by {@link ChannelReviewLocateService}, against the
 * Local Agent's own session.
 */
@Service
public class ChannelReviewService {

    /**
     * What the list can be ordered by. Anything else is a 400 — never a silent fallback to the default.
     *
     * <p>{@link #SORT_ATTENTION} is the default as of Review Triage v1: the question a seller opens this
     * screen with is "what should I look at first", and answering it with the newest row was answering a
     * different one. The other two are unchanged and still reachable.
     */
    static final String SORT_ATTENTION = "attention";
    static final String SORT_NEWEST = "newest";
    static final String SORT_LOWEST = "lowest";

    static final int MAX_PAGE_SIZE = 100;
    static final int DEFAULT_PAGE_SIZE = 20;

    /** How many repeating categories the summary carries. Enough to see a pattern, few enough to read. */
    static final int MAX_REPEATED_CATEGORIES = 3;

    private static final String SOURCE_TYPE_REVIEW = "REVIEW";

    private final ReviewRepository reviews;
    private final ProductRepository products;
    private final SellerAccountRepository accounts;
    private final SyncJobRepository syncJobs;
    private final ItemAnalysisRepository analyses;

    public ChannelReviewService(ReviewRepository reviews, ProductRepository products,
                                SellerAccountRepository accounts, SyncJobRepository syncJobs,
                                ItemAnalysisRepository analyses) {
        this.reviews = reviews;
        this.products = products;
        this.accounts = accounts;
        this.syncJobs = syncJobs;
        this.analyses = analyses;
    }

    public ChannelReviewPageView list(UUID orgId, UUID accountId, String sort, String tier, int page, int size) {
        SellerAccount account = requireAccount(orgId, accountId);
        UUID channelId = account.getChannelId();
        Optional<SyncJob> lastImport = lastReviewImport(orgId, channelId);
        Instant newSince = lastImport.map(SyncJob::getStartedAt).orElse(null);

        String requestedSort = sort == null || sort.isBlank() ? SORT_ATTENTION : sort;
        Integer tierRank = tier == null || tier.isBlank() ? null
                : ReviewTriageRules.rank(ReviewTriageTier.parse(tier));
        Pageable pageable = PageRequest.of(Math.max(0, page), clampSize(size));

        // Two of the three orderings live in JPQL: the triage rank (one shared expression, so the
        // order and the counts cannot disagree) and 낮은 평점순 (whose nullable rating needs an explicit
        // NULLS-LAST case a `Pageable` sort cannot carry into a string query). 최신순 is a plain
        // property sort on a not-null column. A tier filter applies to all three — an operator who
        // filtered to 확인 필요 and then asked for 최신순 wants the newest of those, not the filter
        // silently dropped.
        Page<Review> found = findPage(orgId, channelId, requestedSort, tierRank, pageable);

        Map<UUID, Product> byProduct = productsOf(orgId, found.getContent());
        Map<UUID, String> categories = categoriesOf(orgId, found.getContent());
        Map<String, Long> categoryCounts = categoryCounts(orgId, channelId);

        List<ChannelReviewItemView> items = found.getContent().stream()
                .map(r -> item(r, productOf(byProduct, r), newSince, note(r, categories, categoryCounts)))
                .toList();

        long newCount = newSince == null ? 0
                : reviews.countByOrgIdAndChannelIdAndCreatedAtGreaterThanEqual(orgId, channelId, newSince);

        return new ChannelReviewPageView(found.getNumber(), found.getSize(), found.getTotalElements(),
                newCount,
                lastImport.map(SyncJob::getFinishedAt).orElse(null),
                lastImport.map(j -> "SUCCESS".equals(j.getStatus())).orElse(false),
                summary(orgId, channelId, categoryCounts),
                items);
    }

    /**
     * One review in full, with the target that finds it on the seller's own screen. Org-scoped at the query
     * boundary, then checked against the account's channel: a review id from another of the org's channels is
     * a wrong answer, not merely an odd one, because the locate target would send the agent looking for it on
     * a screen it was never written on.
     */
    public ChannelReviewDetailView detail(UUID orgId, UUID accountId, UUID reviewId) {
        SellerAccount account = requireAccount(orgId, accountId);
        Review review = reviews.findByIdAndOrgId(reviewId, orgId)
                .filter(r -> account.getChannelId().equals(r.getChannelId()))
                .orElseThrow(() -> ApiException.notFound("상품평을 찾을 수 없습니다."));

        Product product = review.getProductId() == null ? null
                : products.findAllByOrgIdAndIdIn(orgId, List.of(review.getProductId()))
                        .stream().findFirst().orElse(null);
        RedactedBody body = VocPreviewSanitizer.redactFullBody(review.getBody());
        Instant newSince = lastReviewImport(orgId, account.getChannelId()).map(SyncJob::getStartedAt).orElse(null);

        return new ChannelReviewDetailView(
                review.getId(),
                writtenOn(review),
                review.getRating(),
                review.isNegative(),
                body.text(),
                body.redacted(),
                product == null ? null : product.getName(),
                review.getMediaCount(),
                isTextless(review),
                isNew(review, newSince),
                // Built from the SAME inputs as the list row's note — the raw stored body, not the
                // redacted copy above. Redaction replaces PII-shaped spans with tokens, so building the
                // note from it could flip a review to 별점만 for a buyer who wrote only a phone number,
                // and the detail would then contradict the list it was opened from.
                //
                // The count is for THIS review's category alone. Reusing the grouped breakdown made
                // opening one review scan the channel's whole analysis join to read a single entry.
                detailNote(orgId, account.getChannelId(), review),
                new ChannelReviewDetailView.LocateTarget(
                        product == null ? null : product.getSku(),
                        review.getSourceOptionId(),
                        writtenOn(review),
                        review.getRating()));
    }

    private ChannelReviewItemView item(Review review, Product product, Instant newSince,
                                       ReviewTriageNote triage) {
        SafePreviewResult preview = VocPreviewSanitizer.sanitize(review.getBody());
        return new ChannelReviewItemView(
                review.getId(),
                writtenOn(review),
                review.getRating(),
                review.isNegative(),
                preview.text(),
                product == null ? null : product.getName(),
                product == null ? null : product.getSku(),
                review.getSourceOptionId(),
                review.getMediaCount(),
                isTextless(review),
                isNew(review, newSince),
                triage);
    }

    /**
     * The triage note for one review.
     *
     * <p>Reads the RAW stored body, never a sanitized preview: blankness is what decides the tier, and a
     * preview that redacted its way to empty would demote a review the buyer did write.
     */
    private ReviewTriageNote note(Review review, Map<UUID, String> categories, Map<String, Long> counts) {
        String category = categories.get(review.getId());
        return ReviewTriageNote.of(review.getRating(), review.getBody(), category,
                category == null ? 0 : counts.getOrDefault(category, 0L));
    }

    /**
     * The note for one review read on its own — the same note the list row carried.
     *
     * <p>Reads one category's count rather than the channel's whole breakdown. The number has to match
     * what the list showed, so it uses the same predicate and the same org scoping; a cheaper count
     * that meant something slightly different would show the operator two answers for one review.
     */
    private ReviewTriageNote detailNote(UUID orgId, UUID channelId, Review review) {
        String category = categoriesOf(orgId, List.of(review)).get(review.getId());
        return ReviewTriageNote.of(review.getRating(), review.getBody(), category,
                category == null ? 0 : reviews.countByChannelAndCategory(orgId, channelId, category));
    }

    /**
     * The stored analysis category for each row on this page — ONE org-scoped batch query, the same shape
     * and reasoning as {@link #productsOf}: the id set is bounded by the clamped page size and each id hits
     * the unique index on {@code item_analyses}, so the cost is a page rather than the table.
     *
     * <p>A review with no entry has no analysis row at all — nothing ever looked at it. That is a coverage
     * state, not a verdict about the review, and {@link ReviewTriageNote} renders it as no tag rather than
     * as a category.
     */
    private Map<UUID, String> categoriesOf(UUID orgId, List<Review> page) {
        List<UUID> ids = page.stream().map(Review::getId).toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return analyses.findByOrgIdAndSourceTypeAndSourceIdIn(orgId, SOURCE_TYPE_REVIEW, ids).stream()
                .filter(a -> a.getCategory() != null)
                .collect(Collectors.toMap(ItemAnalysis::getSourceId, ItemAnalysis::getCategory,
                        // The unique index makes a duplicate impossible; keeping the first is a total
                        // function rather than a claim, so a legacy duplicate cannot throw inside a read.
                        (first, second) -> first));
    }

    /** How often each category occurs across the whole channel record — one grouped query, unwindowed. */
    private Map<String, Long> categoryCounts(UUID orgId, UUID channelId) {
        Map<String, Long> counts = new LinkedHashMap<>();
        for (Object[] row : reviews.countByChannelGroupedByCategory(orgId, channelId)) {
            if (row[0] != null) {
                counts.put((String) row[0], ((Number) row[1]).longValue());
            }
        }
        return counts;
    }

    /**
     * The unfiltered picture: the three tier counts, and the categories that repeat.
     *
     * <p>Always computed WITHOUT the caller's tier filter. A summary recomputed under its own filter would
     * collapse to the one option the operator already chose and leave no way back — the same rule the
     * attention drill-down's category breakdown follows.
     */
    private ChannelReviewTriageSummaryView summary(UUID orgId, UUID channelId, Map<String, Long> categoryCounts) {
        Map<Integer, Long> byTier = new LinkedHashMap<>();
        for (Object[] row : reviews.countByChannelGroupedByTierRank(orgId, channelId)) {
            byTier.put(((Number) row[0]).intValue(), ((Number) row[1]).longValue());
        }

        List<ChannelReviewTriageSummaryView.RepeatedCategory> repeated = categoryCounts.entrySet().stream()
                // 기타 is a stored verdict meaning "we looked and it fitted nothing". Listing it as a
                // repeating issue would turn the analyzer's shrug into a finding about the seller's product.
                .filter(e -> !ItemAnalysisCategories.FALLBACK.equals(e.getKey()))
                .filter(e -> e.getValue() >= ReviewTriageNote.REPEAT_MIN)
                .sorted(Comparator.<Map.Entry<String, Long>>comparingLong(Map.Entry::getValue).reversed()
                        // A total order, so two categories tied on count do not swap places between reads
                        // and make the summary look like it changed when nothing did.
                        .thenComparing(Map.Entry::getKey))
                .limit(MAX_REPEATED_CATEGORIES)
                .map(e -> new ChannelReviewTriageSummaryView.RepeatedCategory(e.getKey(), e.getValue()))
                .toList();

        return new ChannelReviewTriageSummaryView(
                tierCount(byTier, ReviewTriageTier.NEEDS_ATTENTION),
                tierCount(byTier, ReviewTriageTier.WATCH),
                tierCount(byTier, ReviewTriageTier.FYI),
                repeated);
    }

    /**
     * One tier's count. A tier the grouped query returned no row for is zero, not unknown — the query
     * scanned the whole channel, so an absent group means there are none.
     */
    private long tierCount(Map<Integer, Long> byTier, ReviewTriageTier tier) {
        return byTier.getOrDefault(ReviewTriageRules.rank(tier), 0L);
    }

    /**
     * The product a review is about, or null when it names none.
     *
     * <p>Guarded rather than looked up directly: {@code reviews.product_id} is nullable, and when NO row
     * on the page names a product {@link #productsOf} short-circuits to {@link Map#of()} — which throws
     * {@link NullPointerException} on {@code get(null)} rather than returning null. So a page whose
     * reviews all lack a product used to fail the whole list with a 500, which is the worst possible
     * shape for the failure: the seller's own record becomes unreachable because of a field that is
     * allowed to be absent. Found by {@code ChannelReviewTriageIT}, whose fixtures name no product.
     */
    private Product productOf(Map<UUID, Product> byProduct, Review review) {
        return review.getProductId() == null ? null : byProduct.get(review.getProductId());
    }

    private Map<UUID, Product> productsOf(UUID orgId, List<Review> page) {
        List<UUID> ids = page.stream().map(Review::getProductId).filter(java.util.Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return products.findAllByOrgIdAndIdIn(orgId, ids).stream()
                .collect(Collectors.toMap(Product::getId, Function.identity(), (a, b) -> a));
    }

    /** The most recent REVIEW collection for this account, whatever produced it. */
    /**
     * **Scoped by CHANNEL, because that is what the list is scoped by.**
     *
     * <p>The rows come from {@code findByOrgIdAndChannelId} — every review the org holds for this channel,
     * whichever of its seller accounts collected them. An import read per ACCOUNT would then date a list it
     * does not cover: on an org with two Coupang connections, reviews collected under the sibling account
     * would be marked new, or not new, against an import that never touched them. One scope for the rows and
     * their dates, or the numbers on the page describe two different sets.
     */
    private Optional<SyncJob> lastReviewImport(UUID orgId, UUID channelId) {
        return syncJobs.findFirstByOrgIdAndChannelIdAndDataTypeOrderByCreatedAtDesc(orgId, channelId, "REVIEW");
    }

    /**
     * A review the buyer rated without writing. The channel's placeholder for that cell is never stored, so
     * a blank body means exactly this and nothing else — there is no case where a body went missing.
     */
    private boolean isTextless(Review review) {
        // One definition, shared with the rule that ranks on it — a list that showed 별점만 while the tier
        // said otherwise would be two answers to the same question on one row.
        return ReviewTriageRules.isTextless(review.getBody());
    }

    private boolean isNew(Review review, Instant newSince) {
        return newSince != null && review.getCreatedAt() != null && !review.getCreatedAt().isBefore(newSince);
    }

    /** Stored as UTC start-of-day for the calendar date the channel printed, so this reads it back unshifted. */
    private LocalDate writtenOn(Review review) {
        return review.getReceivedAt() == null ? null : review.getReceivedAt().atZone(ZoneOffset.UTC).toLocalDate();
    }

    /**
     * The property sorts: {@code newest} or {@code lowest}. {@code attention} is the default and never
     * reaches here — it is ordered in JPQL by the shared tier rank, because a CASE expression is not a
     * property {@code Sort} can name.
     *
     * <p>An unrecognised value is refused rather than quietly ordered by the default: a seller who asked
     * for the complaints first and silently got the newest first would read the top of the list as their
     * worst reviews.
     */
    private Page<Review> findPage(UUID orgId, UUID channelId, String sort, Integer tierRank, Pageable pageable) {
        if (SORT_ATTENTION.equals(sort)) {
            return reviews.findByOrgIdAndChannelIdTriaged(orgId, channelId, tierRank, pageable);
        }
        if (SORT_LOWEST.equals(sort)) {
            // Its own query rather than a `Sort`, because the NULLS-LAST handling has to be inside the
            // JPQL: `rating` is nullable here and a bare `rating asc` sorts nulls FIRST on H2 and LAST
            // on PostgreSQL, which would make the top of 낮은 평점순 depend on the database. See
            // ReviewRepository.findByOrgIdAndChannelIdTriagedLowestFirst.
            return reviews.findByOrgIdAndChannelIdTriagedLowestFirst(orgId, channelId, tierRank, pageable);
        }
        if (SORT_NEWEST.equals(sort)) {
            // `received_at` is not null, so a plain property sort carries no null-ordering exposure.
            return reviews.findByOrgIdAndChannelIdTriagedSorted(orgId, channelId, tierRank,
                    PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(),
                            Sort.by(Sort.Order.desc("receivedAt"), Sort.Order.asc("id"))));
        }
        throw ApiException.badRequest("정렬 방식을 알 수 없습니다. (attention / newest / lowest)");
    }

    private int clampSize(int size) {
        return Math.max(1, Math.min(MAX_PAGE_SIZE, size <= 0 ? DEFAULT_PAGE_SIZE : size));
    }

    private SellerAccount requireAccount(UUID orgId, UUID accountId) {
        return accounts.findById(accountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
    }
}
