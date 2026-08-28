package com.sellerops.identity;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.common.DataOrigin;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.review.Review;
import com.sellerops.reviewimport.ReviewImportPlanRepository;
import com.sellerops.reviewimport.ReviewImportSegmentAttemptRepository;
import com.sellerops.reviewimport.ReviewImportSegmentRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Decides {@link ExecutableIdentity} for a stored inquiry or review from PROVENANCE ALREADY STORED —
 * never from the shape of a string.
 *
 * <p><b>Trust comes from how the row was acquired, not from what it looks like.</b> Three things must
 * all hold for {@code MARKETPLACE}, and the first is the one a file can never fake:
 *
 * <ol>
 *   <li><b>A trusted acquisition run wrote it.</b> Inquiries: the connector clients stamp
 *       {@code seller_account_id} on every row they write, and the file-upload path stamps none
 *       ({@code IngestionService.ingestInquiries(org, channel, rows)} passes {@code null}). Reviews:
 *       either a {@code Cafe24CommunityArticle} row exists under the review's natural key (the board
 *       article the promoter copied it from), or {@code reviews.acquisition_sync_job_id} names a run
 *       whose {@code method} is {@code SELLER_CENTER_READ} (the Coupang WING handoff) or
 *       {@code SELLER_CENTER_EXPORT} with a launch binding (a {@code ReviewImportSegmentAttempt} links
 *       the run to a plan and its account). A {@code MANUAL_UPLOAD} run, or no run, is {@code NONE}.</li>
 *   <li><b>An exact org + API-mode account binding.</b> The seller account must be this org's and
 *       {@code fileUpload = false}. An ESM file-import account is a real row and still a file.</li>
 *   <li><b>The provider's own object identity is present.</b> The namespaced external id
 *       ({@code naver-qna:} / {@code naver-payinq:} / {@code onlineInquiry:} / {@code cafe24:b…:a…})
 *       is PARSED here to confirm the row names a channel object; it is never the trust decision. For
 *       a Coupang WING read, which publishes no review id, the identity is the locate target the
 *       handoff stored — product, date and rating.</li>
 * </ol>
 *
 * <p>Every miss, every unresolvable repository lookup and every synthetic row is {@code NONE}. The
 * resolver has no side effects and holds no state; batch reads are grouped per run/account so a page
 * of rows costs a handful of queries rather than one per row.
 */
@Component
public class ExecutableIdentityResolver {

    /** The inquiry namespaces the connector clients stamp. Used to parse; never to trust. */
    private static final List<Pattern> INQUIRY_NAMESPACES = List.of(
            Pattern.compile("^naver-qna:[0-9]{1,20}$"),
            Pattern.compile("^naver-payinq:[0-9]{1,20}$"),
            Pattern.compile("^onlineInquiry:[0-9]{1,20}$"),
            Pattern.compile("^cafe24:b[0-9]{1,9}:a[0-9]{1,18}$"));

    /** {@code cafe24:b4:a123} — the promoter's natural id for a board-4 review. */
    private static final Pattern CAFE24_REVIEW =
            Pattern.compile("^cafe24:b(?<board>[0-9]{1,9}):a(?<article>[0-9]{1,18})$");

    private static final String CAFE24 = "CAFE24";

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final Cafe24CommunityArticleRepository articles;
    private final SyncJobRepository syncJobs;
    private final ReviewImportSegmentAttemptRepository attempts;
    private final ReviewImportSegmentRepository segments;
    private final ReviewImportPlanRepository plans;

    public ExecutableIdentityResolver(SellerAccountRepository accounts, ChannelRepository channels,
                                      Cafe24CommunityArticleRepository articles, SyncJobRepository syncJobs,
                                      ReviewImportSegmentAttemptRepository attempts,
                                      ReviewImportSegmentRepository segments,
                                      ReviewImportPlanRepository plans) {
        this.accounts = accounts;
        this.channels = channels;
        this.articles = articles;
        this.syncJobs = syncJobs;
        this.attempts = attempts;
        this.segments = segments;
        this.plans = plans;
    }

    /**
     * A resolver with nothing to read from, which therefore answers {@code NONE} for everything.
     *
     * <p>Exists for the services' legacy test constructors: a service built without repositories can
     * prove no provenance, and the honest identity of an unprovable row is {@code NONE}. It is never
     * wired as a bean.
     */
    public static ExecutableIdentityResolver unresolved() {
        return new ExecutableIdentityResolver(null, null, null, null, null, null, null);
    }

    private boolean canResolve() {
        return accounts != null && channels != null && articles != null && syncJobs != null
                && attempts != null && segments != null && plans != null;
    }

    // ── inquiries ────────────────────────────────────────────────────────────────────────────

    /** Identity of one inquiry. */
    public ExecutableIdentity forInquiry(Inquiry inquiry) {
        if (inquiry == null) {
            return ExecutableIdentity.NONE;
        }
        return forInquiries(inquiry.getOrgId(), List.of(inquiry)).getOrDefault(inquiry.getId(),
                ExecutableIdentity.NONE);
    }

    /** Identities of a page of inquiries, keyed by inquiry id; every id present, absent ⇒ NONE. */
    public Map<UUID, ExecutableIdentity> forInquiries(UUID orgId, Collection<Inquiry> inquiries) {
        Map<UUID, ExecutableIdentity> out = new LinkedHashMap<>();
        Map<UUID, Optional<SellerAccount>> accountCache = new HashMap<>();
        for (Inquiry inquiry : inquiries) {
            out.put(inquiry.getId(), inquiryIdentity(orgId, inquiry, accountCache));
        }
        return out;
    }

    private ExecutableIdentity inquiryIdentity(UUID orgId, Inquiry inquiry,
                                               Map<UUID, Optional<SellerAccount>> accountCache) {
        if (!canResolve() || inquiry == null || orgId == null || !orgId.equals(inquiry.getOrgId())
                || inquiry.getDataOrigin() != DataOrigin.REAL) {
            return ExecutableIdentity.NONE;
        }
        // (1) the connector wrote it — the file path stamps no account.
        if (inquiry.getSellerAccountId() == null) {
            return ExecutableIdentity.NONE;
        }
        // (2) exact org + API-mode binding, on the inquiry's own channel.
        SellerAccount account = apiAccount(orgId, inquiry.getSellerAccountId(), accountCache);
        if (account == null || !account.getChannelId().equals(inquiry.getChannelId())) {
            return ExecutableIdentity.NONE;
        }
        // (3) the provider's own object identity — parsed, not trusted.
        return namesChannelObject(inquiry.getExternalId()) ? ExecutableIdentity.MARKETPLACE
                : ExecutableIdentity.NONE;
    }

    static boolean namesChannelObject(String externalId) {
        if (externalId == null || externalId.isBlank()) {
            return false;
        }
        String id = externalId.strip();
        return INQUIRY_NAMESPACES.stream().anyMatch(p -> p.matcher(id).matches());
    }

    // ── reviews ──────────────────────────────────────────────────────────────────────────────

    /** Identity of one review. */
    public ExecutableIdentity forReview(Review review) {
        if (review == null) {
            return ExecutableIdentity.NONE;
        }
        return forReviews(review.getOrgId(), List.of(review)).getOrDefault(review.getId(),
                ExecutableIdentity.NONE);
    }

    /** Identities of a page of reviews, keyed by review id; every id present, absent ⇒ NONE. */
    public Map<UUID, ExecutableIdentity> forReviews(UUID orgId, Collection<Review> reviews) {
        Map<UUID, ExecutableIdentity> out = new LinkedHashMap<>();
        Map<UUID, Optional<SellerAccount>> accountCache = new HashMap<>();
        Map<UUID, Optional<RunBinding>> runCache = new HashMap<>();
        Map<UUID, Optional<Channel>> channelCache = new HashMap<>();
        for (Review review : reviews) {
            out.put(review.getId(), reviewIdentity(orgId, review, accountCache, runCache, channelCache));
        }
        return out;
    }

    private ExecutableIdentity reviewIdentity(UUID orgId, Review review,
                                              Map<UUID, Optional<SellerAccount>> accountCache,
                                              Map<UUID, Optional<RunBinding>> runCache,
                                              Map<UUID, Optional<Channel>> channelCache) {
        if (!canResolve() || review == null || orgId == null || !orgId.equals(review.getOrgId())
                || review.getDataOrigin() != DataOrigin.REAL) {
            return ExecutableIdentity.NONE;
        }
        Channel channel = channelCache.computeIfAbsent(review.getChannelId(), channels::findById).orElse(null);
        if (channel == null) {
            return ExecutableIdentity.NONE;
        }
        if (CAFE24.equals(channel.getCode())) {
            return cafe24ReviewIdentity(orgId, review, accountCache);
        }
        return runBackedReviewIdentity(orgId, review, channel, accountCache, runCache);
    }

    /**
     * A Cafe24 review is a copy of a board-4 article. Its provenance is the article row itself — stored
     * under {@code (channel, seller account, board, article)} by the connector — so the natural key is
     * looked up on the org's single API-mode Cafe24 account. A {@code cafe24:b4:a…} id with no article
     * behind it is a string, and a string is {@code NONE}.
     */
    private ExecutableIdentity cafe24ReviewIdentity(UUID orgId, Review review,
                                                    Map<UUID, Optional<SellerAccount>> accountCache) {
        Matcher m = review.getExternalId() == null ? null : CAFE24_REVIEW.matcher(review.getExternalId().strip());
        if (m == null || !m.matches()) {
            return ExecutableIdentity.NONE;
        }
        int board;
        long article;
        try {
            board = Integer.parseInt(m.group("board"));
            article = Long.parseLong(m.group("article"));
        } catch (NumberFormatException e) {
            return ExecutableIdentity.NONE;
        }
        // (2) the org's API-mode account on this channel — singular by the V36 partial unique index.
        SellerAccount account;
        try {
            account = accounts.findByOrgIdAndChannelId(orgId, review.getChannelId())
                    .filter(a -> !a.isFileUpload())
                    .orElse(null);
        } catch (RuntimeException e) {
            return ExecutableIdentity.NONE;
        }
        if (account == null) {
            return ExecutableIdentity.NONE;
        }
        accountCache.put(account.getId(), Optional.of(account));
        // (1) the article the connector stored — the acquisition itself.
        boolean articleStored = articles.findByChannelIdAndSellerAccountIdAndBoardNoAndArticleNo(
                        review.getChannelId(), account.getId(), board, article)
                .filter(a -> orgId.equals(a.getOrgId()))
                .isPresent();
        return articleStored ? ExecutableIdentity.MARKETPLACE : ExecutableIdentity.NONE;
    }

    /**
     * NAVER (guided export) and Coupang (WING read): the run that inserted the row decides.
     *
     * <p>{@code SELLER_CENTER_READ} runs carry their account directly ({@code AgentReviewHandoffService}
     * records it). {@code SELLER_CENTER_EXPORT} runs are opened by the file-upload connector with no
     * account, so the binding is walked: run → segment attempt → segment → plan → account. That walk IS
     * the launch binding; an export-method run no attempt links to is not a guided export.
     */
    private ExecutableIdentity runBackedReviewIdentity(UUID orgId, Review review, Channel channel,
                                                       Map<UUID, Optional<SellerAccount>> accountCache,
                                                       Map<UUID, Optional<RunBinding>> runCache) {
        if (review.getAcquisitionSyncJobId() == null) {
            return ExecutableIdentity.NONE;
        }
        RunBinding run = runCache.computeIfAbsent(review.getAcquisitionSyncJobId(),
                id -> bindRun(orgId, id)).orElse(null);
        if (run == null) {
            return ExecutableIdentity.NONE;
        }
        SellerAccount account = apiAccount(orgId, run.sellerAccountId(), accountCache);
        if (account == null || !account.getChannelId().equals(review.getChannelId())) {
            return ExecutableIdentity.NONE;
        }
        // (3) provider object identity. An export carries the channel's review id; a screen read carries
        // no id, so the stored locate target — product, date, rating — is what names the object.
        boolean identified = run.method() == CollectionMethod.SELLER_CENTER_EXPORT
                ? review.getExternalId() != null && !review.getExternalId().isBlank()
                : review.getProductId() != null && review.getReceivedAt() != null && review.getRating() != null;
        return identified ? ExecutableIdentity.MARKETPLACE : ExecutableIdentity.NONE;
    }

    private Optional<RunBinding> bindRun(UUID orgId, UUID syncJobId) {
        SyncJob job = syncJobs.findByIdAndOrgId(syncJobId, orgId).orElse(null);
        if (job == null || job.getMethod() == null) {
            return Optional.empty();
        }
        CollectionMethod method;
        try {
            method = CollectionMethod.valueOf(job.getMethod());
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        return switch (method) {
            case SELLER_CENTER_READ -> job.getSellerAccountId() == null ? Optional.empty()
                    : Optional.of(new RunBinding(method, job.getSellerAccountId()));
            case SELLER_CENTER_EXPORT -> attempts.findFirstBySyncJobId(job.getId())
                    .filter(a -> orgId.equals(a.getOrgId()))
                    .flatMap(a -> segments.findByIdAndOrgId(a.getSegmentId(), orgId))
                    .flatMap(s -> plans.findByIdAndOrgId(s.getPlanId(), orgId))
                    .filter(p -> p.getSellerAccountId() != null)
                    .map(p -> new RunBinding(method, p.getSellerAccountId()));
            // MANUAL_UPLOAD and API: a file is a file, and an API review pull does not exist on any
            // channel reviewnary serves (Cafe24 goes through the article table above).
            default -> Optional.empty();
        };
    }

    private SellerAccount apiAccount(UUID orgId, UUID accountId, Map<UUID, Optional<SellerAccount>> cache) {
        if (accountId == null) {
            return null;
        }
        return cache.computeIfAbsent(accountId, id -> accounts.findByIdAndOrgId(id, orgId))
                .filter(a -> !a.isFileUpload())
                .orElse(null);
    }

    private record RunBinding(CollectionMethod method, UUID sellerAccountId) {
    }
}
