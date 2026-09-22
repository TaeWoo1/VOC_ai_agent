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
import com.sellerops.review.ReviewProductLabel;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.channel.dto.AiTriageMarkView;
import com.sellerops.review.channel.dto.ChannelReviewDetailView;
import com.sellerops.review.channel.dto.ChannelReviewItemView;
import com.sellerops.review.channel.dto.ChannelReviewPageView;
import com.sellerops.review.channel.dto.ChannelReviewTriageSummaryView;
import com.sellerops.review.channel.dto.ReviewRecordPageView;
import com.sellerops.review.triage.ReviewTriageNote;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.feedback.AiTriageCurrent;
import com.sellerops.review.triage.feedback.AiTriageCurrentRepository;
import com.sellerops.review.channel.dto.TriageFeedbackRequests;
import com.sellerops.review.triage.feedback.SellerCorrectionState;
import com.sellerops.review.triage.feedback.TriageCorrection;
import com.sellerops.review.triage.feedback.TriageCorrectionAuditRepository;
import com.sellerops.review.triage.feedback.TriageCorrectionRepository;
import com.sellerops.review.triage.feedback.TriageDisplayDecision;
import com.sellerops.review.channel.dto.ReviewChannelCapabilityView;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.Channel;
import com.sellerops.review.publish.ReviewExecutionKind;
import com.sellerops.review.triage.ReviewTriageChannelCapability;
import com.sellerops.review.triage.pilot.AiTriagePilotService;
import com.sellerops.attention.reply.ReviewReplyWorkLookup;
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
 * <p><b>The rules tier is decided by the rating and whether there is text, and by nothing else.</b>
 * Body-derived material (the stored analysis category, and how often it repeats) reaches the operator only
 * as a citation inside the note. That boundary is {@code contracts/review-eval/naver/v1/RUBRIC.md} §5.
 *
 * <p><b>What the §13.7 pilot adds, and the only thing it adds.</b> For an org opted in, a review the frozen
 * candidate promoted carries an {@link AiTriageMarkView} — {@code AI 확인 필요} — and sorts with 확인 필요.
 * The rules tier on the row is unchanged and shown beside it, so the seller can always tell which mechanism
 * spoke. Nothing here can lower a tier: the ordering is {@code ReviewRepository.FINAL_TIER_RANK}, whose
 * one departure from the rules rank can only produce the top rank. For an org not opted in every row reads
 * exactly as it did before the pilot existed — the join finds nothing and the mark is null.
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
    private final AiTriageCurrentRepository aiCurrent;
    private final AiTriagePilotService pilot;
    private final ChannelRepository channels;
    private final ReviewReplyWorkLookup replyWork;
    private final com.sellerops.identity.ExecutableIdentityResolver identity;
    private final com.sellerops.review.publish.ReviewExecutionCapability execution;
    private final TriageCorrectionRepository corrections;
    private final TriageCorrectionAuditRepository correctionAudit;

    @org.springframework.beans.factory.annotation.Autowired
    public ChannelReviewService(ReviewRepository reviews, ProductRepository products,
                                SellerAccountRepository accounts, SyncJobRepository syncJobs,
                                ItemAnalysisRepository analyses, AiTriageCurrentRepository aiCurrent,
                                AiTriagePilotService pilot, ChannelRepository channels,
                                ReviewReplyWorkLookup replyWork,
                                com.sellerops.identity.ExecutableIdentityResolver identity,
                                com.sellerops.review.publish.ReviewExecutionCapability execution,
                                TriageCorrectionRepository corrections,
                                TriageCorrectionAuditRepository correctionAudit) {
        this.corrections = corrections;
        this.correctionAudit = correctionAudit;
        this.identity = identity;
        this.execution = execution;
        this.channels = channels;
        this.replyWork = replyWork;
        this.reviews = reviews;
        this.products = products;
        this.accounts = accounts;
        this.syncJobs = syncJobs;
        this.analyses = analyses;
        this.aiCurrent = aiCurrent;
        this.pilot = pilot;
    }

    /**
     * Test wiring with no provenance resolver and no execution lane: every row reads {@code NONE} and
     * every channel's execution is {@code NOT_SUPPORTED / EXECUTION_DISABLED} — both fail-closed.
     */
    public ChannelReviewService(ReviewRepository reviews, ProductRepository products,
                                SellerAccountRepository accounts, SyncJobRepository syncJobs,
                                ItemAnalysisRepository analyses, AiTriageCurrentRepository aiCurrent,
                                AiTriagePilotService pilot, ChannelRepository channels,
                                ReviewReplyWorkLookup replyWork,
                                TriageCorrectionRepository corrections,
                                TriageCorrectionAuditRepository correctionAudit) {
        this(reviews, products, accounts, syncJobs, analyses, aiCurrent, pilot, channels, replyWork,
                com.sellerops.identity.ExecutableIdentityResolver.unresolved(),
                com.sellerops.review.publish.ReviewExecutionCapability.disabled(),
                corrections, correctionAudit);
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
        Page<Review> found = findPage(orgId, channelId, requestedSort, tierRank, pilot.isEnabledFor(orgId), pageable);

        Map<UUID, Product> byProduct = productsOf(orgId, found.getContent());
        Map<UUID, String> categories = categoriesOf(orgId, found.getContent());
        Map<String, Long> categoryCounts = categoryCounts(orgId, channelId);
        Map<UUID, AiTriageMarkView> marks = marksOf(orgId, found.getContent());
        Map<UUID, TriageFeedbackRequests.CorrectionView> sellerCorrections = correctionsOf(orgId, found.getContent());
        Map<UUID, com.sellerops.identity.ExecutableIdentity> identities =
                identity.forReviews(orgId, found.getContent());

        List<ChannelReviewItemView> items = found.getContent().stream()
                .map(r -> item(r, productOf(byProduct, r), newSince, note(r, categories, categoryCounts),
                        marks.get(r.getId()), sellerCorrections.get(r.getId()),
                        identities.getOrDefault(r.getId(), com.sellerops.identity.ExecutableIdentity.NONE)))
                .toList();

        long newCount = newSince == null ? 0
                : reviews.countByOrgIdAndChannelIdAndCreatedAtGreaterThanEqual(orgId, channelId, newSince);

        return new ChannelReviewPageView(found.getNumber(), found.getSize(), found.getTotalElements(),
                newCount,
                lastImport.map(SyncJob::getFinishedAt).orElse(null),
                lastImport.map(j -> "SUCCESS".equals(j.getStatus())).orElse(false),
                pilot.isEnabledFor(orgId),
                capabilityOf(orgId, account),
                summary(orgId, channelId, categoryCounts),
                items);
    }

    /**
     * The organisation's record: {@link #list}'s answer over every seller-visible channel, or the one named by
     * {@code channel} (UI/UX v2 Phase 2).
     *
     * <p><b>Nothing about a row changes with the scope.</b> The order is the same {@code FINAL_TIER_RANK}, the tier
     * filter the same expression, a row's 「같은 분류 N건」 is still counted within ITS OWN channel, and 「새로
     * 들어온」 is still dated against its own channel's last import. What is summed is only what is naturally a sum:
     * the total, the tier counts, the new count and the repeating categories of the channels in scope.
     *
     * <p>An unknown channel is refused rather than widened — a seller who asked for one channel and silently got all
     * three would read the answer as that channel's. A visible channel absent from the catalogue simply contributes
     * nothing.
     */
    public ReviewRecordPageView record(UUID orgId, String channel, String sort, String tier, int page, int size) {
        List<String> codes = visibleCodes(channel);
        Map<UUID, Channel> byId = new LinkedHashMap<>();
        for (String code : codes) {
            channels.findByCode(code).ifPresent(c -> byId.put(c.getId(), c));
        }
        String requestedSort = sort == null || sort.isBlank() ? SORT_ATTENTION : sort;
        Integer tierRank = tier == null || tier.isBlank() ? null
                : ReviewTriageRules.rank(ReviewTriageTier.parse(tier));
        Pageable pageable = PageRequest.of(Math.max(0, page), clampSize(size));
        boolean aiEnabled = pilot.isEnabledFor(orgId);
        if (byId.isEmpty()) {
            return new ReviewRecordPageView(pageable.getPageNumber(), pageable.getPageSize(), 0, 0, aiEnabled,
                    codes, new ChannelReviewTriageSummaryView(0, 0, 0, 0, List.of()), List.of(), List.of(),
                    outsideVisible(orgId));
        }
        List<UUID> channelIds = List.copyOf(byId.keySet());

        Page<Review> found = findRecordPage(orgId, channelIds, requestedSort, tierRank, aiEnabled, pageable);

        Map<UUID, Instant> newSince = new java.util.HashMap<>();
        long newCount = 0;
        for (UUID channelId : channelIds) {
            Instant since = lastReviewImport(orgId, channelId).map(SyncJob::getStartedAt).orElse(null);
            if (since != null) {
                newSince.put(channelId, since);
                newCount += reviews.countByOrgIdAndChannelIdAndCreatedAtGreaterThanEqual(orgId, channelId, since);
            }
        }

        Map<UUID, Map<String, Long>> countsByChannel = new java.util.HashMap<>();
        Map<String, Long> countsInScope = new LinkedHashMap<>();
        for (Object[] row : reviews.countByChannelsGroupedByChannelAndCategory(orgId, channelIds)) {
            if (row[1] == null) continue;
            long n = ((Number) row[2]).longValue();
            countsByChannel.computeIfAbsent((UUID) row[0], k -> new LinkedHashMap<>()).put((String) row[1], n);
            countsInScope.merge((String) row[1], n, Long::sum);
        }

        Map<UUID, Product> byProduct = productsOf(orgId, found.getContent());
        Map<UUID, String> categories = categoriesOf(orgId, found.getContent());
        Map<UUID, AiTriageMarkView> marks = marksOf(orgId, found.getContent());
        Map<UUID, TriageFeedbackRequests.CorrectionView> sellerCorrections = correctionsOf(orgId, found.getContent());
        Map<UUID, com.sellerops.identity.ExecutableIdentity> identities =
                identity.forReviews(orgId, found.getContent());

        List<ReviewRecordPageView.Row> items = found.getContent().stream()
                .map(r -> {
                    Channel ch = byId.get(r.getChannelId());
                    ChannelReviewItemView item = item(r, productOf(byProduct, r), newSince.get(r.getChannelId()),
                            note(r, categories, countsByChannel.getOrDefault(r.getChannelId(), Map.of())),
                            marks.get(r.getId()), sellerCorrections.get(r.getId()),
                            identities.getOrDefault(r.getId(), com.sellerops.identity.ExecutableIdentity.NONE));
                    return new ReviewRecordPageView.Row(ch == null ? null : ch.getCode(),
                            ch == null ? null : ch.getNameKo(), item);
                })
                .toList();

        Map<Integer, Long> byTier = new LinkedHashMap<>();
        List<Object[]> grouped = aiEnabled
                ? reviews.countByChannelsGroupedByFinalTierRank(orgId, channelIds)
                : reviews.countByChannelsGroupedByTierRank(orgId, channelIds);
        for (Object[] row : grouped) {
            byTier.put(((Number) row[0]).intValue(), ((Number) row[1]).longValue());
        }
        ChannelReviewTriageSummaryView summary = summaryOf(byTier,
                aiEnabled ? reviews.countAiAttentionByChannels(orgId, channelIds) : 0, countsInScope);

        List<ReviewRecordPageView.ChannelFacts> facts = new java.util.ArrayList<>();
        for (Channel ch : byId.values()) {
            List<SellerAccount> held = accounts.findAllByOrgIdAndChannelId(orgId, ch.getId());
            // One account or none: with two on one channel there is no way to say which one a row belongs to,
            // exactly as the review workspace's own reply-account rule says.
            SellerAccount only = held.size() == 1 ? held.get(0) : null;
            Optional<SyncJob> last = lastReviewImport(orgId, ch.getId());
            facts.add(new ReviewRecordPageView.ChannelFacts(ch.getCode(), ch.getNameKo(),
                    only == null ? null : only.getId(),
                    only == null ? null : capabilityOf(orgId, only),
                    last.map(SyncJob::getFinishedAt).orElse(null),
                    last.map(j -> "SUCCESS".equals(j.getStatus())).orElse(false)));
        }

        return new ReviewRecordPageView(found.getNumber(), found.getSize(), found.getTotalElements(), newCount,
                aiEnabled, byId.values().stream().map(Channel::getCode).toList(), summary, items, facts,
                outsideVisible(orgId));
    }

    /** Reviews on channels outside {@code ProductChannels.VISIBLE_CODES} — counted, never listed. */
    private long outsideVisible(UUID orgId) {
        List<UUID> visible = com.sellerops.channel.ProductChannels.VISIBLE_CODES.stream()
                .map(channels::findByCode).flatMap(Optional::stream).map(Channel::getId).toList();
        return visible.isEmpty() ? 0 : reviews.countByOrgIdAndChannelIdNotIn(orgId, visible);
    }

    /** The seller-visible channel codes in scope: all of them, or the one asked for. */
    private static List<String> visibleCodes(String channel) {
        if (channel == null || channel.isBlank()) {
            return com.sellerops.channel.ProductChannels.VISIBLE_CODES;
        }
        String code = channel.strip().toUpperCase(java.util.Locale.ROOT);
        if (!com.sellerops.channel.ProductChannels.isVisible(code)) {
            throw ApiException.badRequest("알 수 없는 채널입니다.");
        }
        return List.of(code);
    }

    /** {@link #findPage}, over a set of channels — the same three lenses and the same refusal of anything else. */
    private Page<Review> findRecordPage(UUID orgId, List<UUID> channelIds, String sort, Integer tierRank,
                                        boolean aiEnabled, Pageable pageable) {
        if (SORT_ATTENTION.equals(sort)) {
            return reviews.findByOrgIdAndChannelIdInTriaged(orgId, channelIds, tierRank, aiEnabled, pageable);
        }
        if (SORT_LOWEST.equals(sort)) {
            return reviews.findByOrgIdAndChannelIdInTriagedLowestFirst(orgId, channelIds, tierRank, aiEnabled, pageable);
        }
        if (SORT_NEWEST.equals(sort)) {
            return reviews.findByOrgIdAndChannelIdInTriagedSorted(orgId, channelIds, tierRank, aiEnabled,
                    PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(),
                            Sort.by(Sort.Order.desc("receivedAt"), Sort.Order.asc("id"))));
        }
        throw ApiException.badRequest("정렬 방식을 알 수 없습니다. (attention / newest / lowest)");
    }

    /**
     * The pilot's marks for the rows on this page — one org-scoped batch query, the same shape as
     * {@link #categoriesOf}. Empty when the pilot is off for this org, without touching the table.
     *
     * <p>Only rows with {@code aiAttention = true} become marks. A current row with {@code false} is
     * the pilot saying "nothing to add", and nothing to add renders as nothing.
     */
    private Map<UUID, AiTriageMarkView> marksOf(UUID orgId, List<Review> page) {
        boolean surfaceOn = pilot.isEnabledFor(orgId);
        if (!surfaceOn || page.isEmpty()) {
            return Map.of();
        }
        // The display decision is resolved by ONE function — the same one that stamps shownSource on
        // every event (contract §3) — so a row renders the mark exactly when an event on it would say
        // AI. It already encodes "a rules 확인 필요 never carries a mark": there is nothing to add, and a
        // mark there would let the seller credit the model for the rule's work.
        List<UUID> ids = page.stream().map(Review::getId).toList();
        Map<UUID, AiTriageCurrent> currents = aiCurrent.findByOrgIdAndReviewIdIn(orgId, ids).stream()
                .collect(Collectors.toMap(AiTriageCurrent::getReviewId, c -> c, (a, b) -> a));
        Map<UUID, AiTriageMarkView> marks = new java.util.HashMap<>();
        for (Review r : page) {
            AiTriageCurrent c = currents.get(r.getId());
            if (TriageDisplayDecision.resolve(ReviewTriageRules.tier(r.getRating(), r.getBody()), c, surfaceOn).aiShown()) {
                marks.put(r.getId(), mark(c));
            }
        }
        return marks;
    }

    /**
     * The seller's STANDING corrections for the rows on this page — one org-scoped batch query, the
     * same shape as {@link #marksOf}.
     *
     * <p><b>Not gated on the pilot.</b> A correction is the seller's own judgment; it exists whether
     * or not a classifier ever looked at the review, and hiding it when the pilot is off would make it
     * vanish from the screen while staying in the database — which is the T-07 defect one level down.
     *
     * <p><b>It does not re-rank anything.</b> {@code FINAL_TIER_RANK} does not read this table. A
     * corrected review sits exactly where the system put it and says, on the row, that the seller
     * disagreed. Moving it would be the overwrite this design exists to avoid.
     */
    private Map<UUID, TriageFeedbackRequests.CorrectionView> correctionsOf(UUID orgId, List<Review> page) {
        if (page.isEmpty()) {
            return Map.of();
        }
        Map<UUID, TriageFeedbackRequests.CorrectionView> out = new java.util.HashMap<>();
        for (TriageCorrection c : corrections.findByOrgIdAndStateAndReviewIdIn(orgId,
                SellerCorrectionState.STANDING, page.stream().map(Review::getId).toList())) {
            // changeCount 0 on the list: the row shows THAT the seller corrected it, and the trail's
            // length is a second query this page has no use for. The detail read pays for it.
            TriageFeedbackRequests.CorrectionView view = ChannelReviewFeedbackService.viewOf(c, 0);
            if (view != null) {
                out.put(c.getReviewId(), view);
            }
        }
        return out;
    }

    /**
     * The channel's row of the contract-§1 table, on the wire — so the UI renders no control the
     * server would refuse (no `[쿠팡에서 보기]` on a NAVER account, no feedback control on a channel
     * outside the three) and asserts nothing about the channel that the server did not say.
     */
    private ReviewChannelCapabilityView capabilityOf(UUID orgId, SellerAccount account) {
        String code = channelCodeOf(account.getChannelId());
        return ReviewChannelCapabilityView.of(ReviewTriageChannelCapability.of(code),
                execution.of(orgId, account.getId(), code));
    }

    private String channelCodeOf(UUID channelId) {
        return channels.findById(channelId).map(Channel::getCode).orElse(null);
    }

    private static AiTriageMarkView mark(AiTriageCurrent c) {
        return new AiTriageMarkView(c.getClassifierVersion(), c.getReasonCode(), c.getPredictedAt());
    }

    /**
     * One review in full, addressed by the review alone — org-scoped, and nothing else.
     *
     * <p><b>This is the canonical read.</b> {@code (reviewId, orgId)} was always the authorization; the
     * account contributed one channel-equality check, and that check was a statement about the ADDRESS
     * the caller happened to use rather than about who may read the row. A review acquired by no
     * account — a manual upload, a seller-center export — is still this org's review, and until this
     * overload existed there was no address at which it could be read in full.
     *
     * <p>The account is still resolved, because the reply lane is genuinely account-bound; it is
     * resolved FROM the review's channel instead of being supplied, and its absence costs the caller
     * the reply panel and nothing else.
     */
    public ChannelReviewDetailView detail(UUID orgId, UUID reviewId) {
        Review review = reviews.findByIdAndOrgId(reviewId, orgId)
                .orElseThrow(() -> ApiException.notFound("상품평을 찾을 수 없습니다."));
        return detail(orgId, review, replyAccountFor(orgId, review));
    }

    /**
     * The same review, addressed through one of the org's accounts — the record screen's address.
     *
     * <p>Kept because the channel record IS account-shaped: it lists what one connected account holds.
     * The channel-equality filter stays for the same reason it was written — a review from another of
     * the org's channels is a wrong answer at this address, not merely an odd one, because the locate
     * target would send the agent looking for it on a screen it was never written on.
     */
    public ChannelReviewDetailView detail(UUID orgId, UUID accountId, UUID reviewId) {
        SellerAccount account = requireAccount(orgId, accountId);
        Review review = reviews.findByIdAndOrgId(reviewId, orgId)
                .filter(r -> account.getChannelId().equals(r.getChannelId()))
                .orElseThrow(() -> ApiException.notFound("상품평을 찾을 수 없습니다."));
        return detail(orgId, review, account);
    }

    /**
     * The single account this org holds on this review's channel, or null.
     *
     * <p>Null for none AND for more than one: with two accounts on one channel there is no way to say
     * from a review which of them a reply would be from, and picking the older one would answer a
     * question nobody asked. Fail-closed, exactly as the ingested-review attention source does.
     */
    private SellerAccount replyAccountFor(UUID orgId, Review review) {
        if (review.getChannelId() == null) {
            return null;
        }
        List<SellerAccount> found = accounts.findAllByOrgIdAndChannelId(orgId, review.getChannelId());
        return found.size() == 1 ? found.get(0) : null;
    }

    /**
     * The body both addresses share. Every channel-derived fact comes from the REVIEW's own channel —
     * which is what it always meant, even when it was read off an account that had been checked equal
     * to it — and the account is used for exactly one thing: whether a reply can be executed.
     */
    private ChannelReviewDetailView detail(UUID orgId, Review review, SellerAccount account) {
        UUID channelId = review.getChannelId();
        String channelCode = channelId == null ? null : channelCodeOf(channelId);
        Product product = review.getProductId() == null ? null
                : products.findAllByOrgIdAndIdIn(orgId, List.of(review.getProductId()))
                        .stream().findFirst().orElse(null);
        RedactedBody body = VocPreviewSanitizer.redactFullBody(review.getBody());
        Instant newSince = channelId == null ? null
                : lastReviewImport(orgId, channelId).map(SyncJob::getStartedAt).orElse(null);
        // No account, no reply work — and it is refused HERE rather than inside the lookup, which
        // answers a question about the CHANNEL. NAVER's capability says a reply flow exists whether or
        // not this seller has connected anything; handing out its ref with no account would put a
        // draft panel on screen that every account-addressed reply endpoint would then refuse.
        ChannelReviewDetailView.ReplyWork work = account == null ? null
                : replyWork.forReview(orgId, channelCode, review.getId(),
                                execution.of(orgId, account.getId(), channelCode).kind())
                        .map(r -> new ChannelReviewDetailView.ReplyWork(
                                r.actionRef(), r.triageDisposition(), r.hasReplyPreparation(),
                                // The channel's own statement, off the entity already read for this
                                // response. Never SellerOps' record of a guided reply (that is
                                // `outcome`), and never a substitute for the operator's decision.
                                review.getReplyState().name()))
                        .orElse(null);

        return new ChannelReviewDetailView(
                review.getId(),
                writtenOn(review),
                review.getRating(),
                review.isNegative(),
                body.text(),
                body.redacted(),
                ReviewProductLabel.displayName(review, product == null ? null : product.getName()),
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
                detailNote(orgId, channelId, review),
                marksOf(orgId, List.of(review)).get(review.getId()),
                // The seller's own judgment, read back on every open — so a correction survives a
                // refresh on the screen as well as in the database. Null when none stands.
                ChannelReviewFeedbackService.viewOf(
                        corrections.findByReviewId(review.getId())
                                .filter(c -> c.getOrgId().equals(orgId)).orElse(null),
                        (int) correctionAudit.countByReviewId(review.getId())),
                new ChannelReviewDetailView.LocateTarget(
                        product == null ? null : product.getSku(),
                        review.getSourceOptionId(),
                        writtenOn(review),
                        review.getRating()),
                work,
                account == null ? null : account.getId(),
                replyUnavailableReason(work, account, channelCode),
                identity.forReview(review).name());
    }

    /**
     * Which of two different absences produced a null {@code replyWork}, or null when it is present.
     *
     * <p>Derived, never stored: the channel's own capability answers first, because 「쿠팡은 상품평에
     * 답변하는 기능이 없습니다」 is true whether or not this seller has connected anything. Only where a
     * reply flow does exist is a missing account the reason.
     */
    private static String replyUnavailableReason(ChannelReviewDetailView.ReplyWork work,
                                                 SellerAccount account, String channelCode) {
        if (work != null) {
            return null;
        }
        if (!ReviewTriageChannelCapability.of(channelCode).replyFlowExists()) {
            return "CHANNEL_HAS_NO_REPLY_FLOW";
        }
        return account == null ? "NO_SELLER_ACCOUNT" : "CHANNEL_HAS_NO_REPLY_FLOW";
    }

    private ChannelReviewItemView item(Review review, Product product, Instant newSince,
                                       ReviewTriageNote triage, AiTriageMarkView aiMark,
                                       TriageFeedbackRequests.CorrectionView sellerCorrection,
                                       com.sellerops.identity.ExecutableIdentity executableIdentity) {
        SafePreviewResult preview = VocPreviewSanitizer.sanitize(review.getBody());
        return new ChannelReviewItemView(
                review.getId(),
                writtenOn(review),
                review.getRating(),
                review.isNegative(),
                preview.text(),
                ReviewProductLabel.displayName(review, product == null ? null : product.getName()),
                // The SKU stays strictly the catalogue's. A channel identifier is not a SKU — passing one
                // through as if it were is what created a parallel product per listing.
                product == null ? null : product.getSku(),
                review.getSourceOptionId(),
                review.getMediaCount(),
                isTextless(review),
                isNew(review, newSince),
                triage,
                aiMark,
                sellerCorrection,
                executableIdentity.name());
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
        // Two queries and a Java branch, not one query and a parameter — see
        // ReviewRepository.countByChannelGroupedByFinalTierRank for the PostgreSQL reason.
        List<Object[]> grouped = pilot.isEnabledFor(orgId)
                ? reviews.countByChannelGroupedByFinalTierRank(orgId, channelId)
                : reviews.countByChannelGroupedByTierRank(orgId, channelId);
        for (Object[] row : grouped) {
            byTier.put(((Number) row[0]).intValue(), ((Number) row[1]).longValue());
        }
        // Zero, and no query, when the pilot is off — the summary then reads as it always did.
        return summaryOf(byTier, pilot.isEnabledFor(orgId) ? reviews.countAiAttentionByChannel(orgId, channelId) : 0,
                categoryCounts);
    }

    /**
     * The summary from its counts — shared by the channel record and the organisation's record, so the repeating
     * categories are chosen by one rule whichever scope they were counted over.
     */
    private ChannelReviewTriageSummaryView summaryOf(Map<Integer, Long> byTier, long aiAttention,
                                                     Map<String, Long> categoryCounts) {
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
                aiAttention,
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
    private Page<Review> findPage(UUID orgId, UUID channelId, String sort, Integer tierRank, boolean aiEnabled,
                                  Pageable pageable) {
        if (SORT_ATTENTION.equals(sort)) {
            return reviews.findByOrgIdAndChannelIdTriaged(orgId, channelId, tierRank, aiEnabled, pageable);
        }
        if (SORT_LOWEST.equals(sort)) {
            // Its own query rather than a `Sort`, because the NULLS-LAST handling has to be inside the
            // JPQL: `rating` is nullable here and a bare `rating asc` sorts nulls FIRST on H2 and LAST
            // on PostgreSQL, which would make the top of 낮은 평점순 depend on the database. See
            // ReviewRepository.findByOrgIdAndChannelIdTriagedLowestFirst.
            return reviews.findByOrgIdAndChannelIdTriagedLowestFirst(orgId, channelId, tierRank, aiEnabled, pageable);
        }
        if (SORT_NEWEST.equals(sort)) {
            // `received_at` is not null, so a plain property sort carries no null-ordering exposure.
            return reviews.findByOrgIdAndChannelIdTriagedSorted(orgId, channelId, tierRank, aiEnabled,
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
