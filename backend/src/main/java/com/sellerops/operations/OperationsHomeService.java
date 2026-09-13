package com.sellerops.operations;

import com.sellerops.attention.reply.ReviewReplyApproval;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.common.SafePreviewResult;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.coverage.ChannelCoverageService;
import com.sellerops.coverage.dto.ChannelCoverageRow;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.operations.dto.OperationsHomeView;
import com.sellerops.opportunity.OpportunityService;

import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.channel.ProductChannels;
import com.sellerops.repeatedissue.RepeatedIssueWorkspaceService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.triage.pilot.AiTriagePilotService;
import com.sellerops.reviewissue.IssueLifecycleState;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Operations Home's one read — <b>a composer, not a new source of truth.</b>
 *
 * <p>Every number it returns is owned somewhere else and asked for here in its owner's own words: the
 * attention tier by {@code ReviewRepository}'s rank expression, the repeated problems by
 * {@link ReviewIssueQueryService} in {@code IssueOrdering}'s order, the collection state by
 * {@link ChannelCoverageService}, and the per-problem context by
 * {@link RepeatedIssueWorkspaceService}. This class decides WHICH bounded slice to ask for and
 * nothing else, so there is no second definition of «needs attention» to drift from the first.
 *
 * <p><b>Bounded on purpose, and the bound is small.</b> A Home is read every morning; it may not grow
 * with the corpus. Counts are org-wide aggregates (one query each) and every list is capped, with the
 * per-problem context — the most expensive thing here — capped hardest.
 *
 * <p><b>Zero model calls.</b> Every field is SQL over rows already held.
 */
@Service
public class OperationsHomeService {

    /** 확인 필요 in the rank expression. Named rather than written as a literal at the call site. */
    private static final int NEEDS_ATTENTION_RANK = 0;
    private static final int WATCH_RANK = 1;

    /**
     * How many rows each area may put on the Home. A morning screen, not a work queue.
     *
     * <p>Three rather than five, measured: at five the review list alone ran 440px and pushed two of
     * the four areas below the fold on every width — a Home whose own second half needs scrolling is
     * not 「한 화면에서」. The count beside the list says how many there are; 리뷰 기록 열기 opens the rest.
     */
    private static final int MAX_REVIEWS = 3;
    private static final int MAX_PREPARED = 5;
    /**
     * Hardest cap of the four: each problem row costs its own context read (evidence roll-up, the
     * per-product denominators and the rating spread). Three is what a person compares at a glance.
     */
    private static final int MAX_PROBLEMS = 3;

    private final ReviewRepository reviews;
    private final ProductRepository products;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final AiTriagePilotService pilot;
    private final ReviewIssueQueryService issues;
    private final RepeatedIssueWorkspaceService repeatContext;
    private final ChannelCoverageService coverage;
    private final ReviewReplyApprovalRepository replyApprovals;
    private final InquiryWorkItemRepository workItems;
    private final InquiryRepository inquiryRepo;
    private final OpportunityService opportunities;

    public OperationsHomeService(ReviewRepository reviews, ProductRepository products,
                                 SellerAccountRepository accounts, ChannelRepository channels,
                                 AiTriagePilotService pilot, ReviewIssueQueryService issues,
                                 RepeatedIssueWorkspaceService repeatContext,
                                 ChannelCoverageService coverage,
                                 ReviewReplyApprovalRepository replyApprovals,
                                 InquiryWorkItemRepository workItems,
                                 InquiryRepository inquiryRepo,
                                 OpportunityService opportunities) {
        this.reviews = reviews;
        this.products = products;
        this.accounts = accounts;
        this.channels = channels;
        this.pilot = pilot;
        this.issues = issues;
        this.repeatContext = repeatContext;
        this.coverage = coverage;
        this.replyApprovals = replyApprovals;
        this.workItems = workItems;
        this.inquiryRepo = inquiryRepo;
        this.opportunities = opportunities;
    }

    @Transactional(readOnly = true)
    public OperationsHomeView home(UUID orgId, LocalDate referenceDate) {
        LocalDate on = referenceDate == null ? LocalDate.now(ZoneOffset.UTC) : referenceDate;
        return new OperationsHomeView(
                reviewAttention(orgId),
                repeatedProblems(orgId, on),
                // Deliberately NOT widened to data-bearing channels. This feeds 최근 수집 상태, which
                // is about channels a seller connects and can act on — and a widened list rendered
                // 「G마켓/옥션 · 아직 연결되지 않았습니다」 on an org holding an uploaded G마켓 review,
                // which is a connect affordance for a connection that does not exist. Core data
                // presence belongs in the figures (the overview's channel table); it does not belong
                // in a collection status a seller cannot change.
                coverage.coverage(orgId, ProductChannels.VISIBLE_CODES),
                preparedWork(orgId, on));
    }

    // ---- 지금 확인할 리뷰 --------------------------------------------------------------------

    private OperationsHomeView.ReviewAttention reviewAttention(UUID orgId) {
        boolean aiEnabled = pilot.isEnabledFor(orgId);
        // The pair the per-channel summary uses, for the reason it uses it: the opt-in cannot live
        // inside a GROUP BY expression on PostgreSQL, so the caller picks the query.
        Map<Integer, Long> byTier = new HashMap<>();
        List<Object[]> grouped = aiEnabled
                ? reviews.countByOrgGroupedByFinalTierRank(orgId)
                : reviews.countByOrgGroupedByTierRank(orgId);
        for (Object[] row : grouped) {
            byTier.put(((Number) row[0]).intValue(), ((Number) row[1]).longValue());
        }

        long undecided = reviews.countUndecidedByOrgAndTier(orgId, NEEDS_ATTENTION_RANK, aiEnabled);
        List<Review> rows = reviews.findUndecidedByOrgAndTier(
                orgId, NEEDS_ATTENTION_RANK, aiEnabled, PageRequest.of(0, MAX_REVIEWS));

        return new OperationsHomeView.ReviewAttention(
                undecided,
                byTier.getOrDefault(NEEDS_ATTENTION_RANK, 0L),
                byTier.getOrDefault(WATCH_RANK, 0L),
                attentionRows(orgId, rows));
    }

    private List<OperationsHomeView.AttentionReview> attentionRows(UUID orgId, List<Review> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<UUID, SellerAccount> accountByChannel = new HashMap<>();
        for (SellerAccount account : accounts.findAllByOrgId(orgId)) {
            accountByChannel.putIfAbsent(account.getChannelId(), account);
        }
        Map<UUID, String> channelCodes = new HashMap<>();
        for (Channel channel : channels.findAll()) {
            channelCodes.put(channel.getId(), channel.getCode());
        }
        Map<UUID, String> productNames = new HashMap<>();
        for (UUID productId : rows.stream().map(Review::getProductId).filter(Objects::nonNull)
                .distinct().toList()) {
            products.findById(productId).map(Product::getName)
                    .ifPresent(name -> productNames.put(productId, name));
        }

        return rows.stream().map(review -> {
            SellerAccount account = accountByChannel.get(review.getChannelId());
            // The text leaves through the same sanitizer every other review preview uses, and a
            // suppressed preview is null rather than an empty quote — a blank bubble reads as though
            // the customer wrote nothing.
            SafePreviewResult preview = VocPreviewSanitizer.sanitize(review.getBody());
            String quote = preview == null || preview.text() == null || preview.text().isBlank()
                    ? null : preview.text();
            return new OperationsHomeView.AttentionReview(
                    review.getId(),
                    account == null ? null : account.getId(),
                    channelCodes.get(review.getChannelId()),
                    review.getRating(),
                    review.getReceivedAt() == null ? null
                            : review.getReceivedAt().atZone(ZoneOffset.UTC).toLocalDate(),
                    review.getProductId() == null ? null : productNames.get(review.getProductId()),
                    quote);
        }).toList();
    }

    // ---- 반복 문제 --------------------------------------------------------------------------

    private OperationsHomeView.RepeatedProblems repeatedProblems(UUID orgId, LocalDate on) {
        // The canonical list, in IssueOrdering's order, already excluding dismissed and zero-evidence
        // issues. The Home does not re-sort it: the product page and the memory list read the same
        // order, and three screens that disagree about which problem is biggest is the defect this
        // ordering exists to prevent.
        List<ReviewIssueView> all = issues.list(orgId, on);

        long decidable = all.stream().filter(OperationsHomeService::isDecidable).count();
        long observing = all.stream()
                .filter(issue -> IssueLifecycleState.OBSERVING.name().equals(issue.lifecycleState()))
                .count();

        // Problems that are somebody's move lead; the rest follow in the canonical order. This is a
        // presentation rule over an order the server already fixed, not a second ranking: nothing is
        // scored, and within each group the sequence is exactly the one the list screen shows.
        List<ReviewIssueView> shown = java.util.stream.Stream
                .concat(all.stream().filter(OperationsHomeService::isDecidable),
                        all.stream().filter(issue -> !isDecidable(issue)))
                .limit(MAX_PROBLEMS)
                .toList();

        List<OperationsHomeView.HomeProblem> rows = shown.stream()
                .map(issue -> new OperationsHomeView.HomeProblem(
                        issue, repeatContext.context(orgId, issue.id(), on)))
                .toList();

        return new OperationsHomeView.RepeatedProblems(decidable, observing, rows);
    }

    /** 확인 필요 or 조치 중 — a problem that is somebody's move right now. */
    private static boolean isDecidable(ReviewIssueView issue) {
        return IssueLifecycleState.NEEDS_REVIEW.name().equals(issue.lifecycleState())
                || IssueLifecycleState.ACTING.name().equals(issue.lifecycleState());
    }

    // ---- 준비된 작업 ------------------------------------------------------------------------

    private OperationsHomeView.PreparedWork preparedWork(UUID orgId, LocalDate on) {
        List<ReviewReplyApproval> approved =
                replyApprovals.findStandingByOrgId(orgId, PageRequest.of(0, MAX_PREPARED));
        long approvedCount = replyApprovals.countStandingByOrgId(orgId);

        // «Prepared» for an inquiry is a draft that EXISTS, not a phase. `PROPOSED` is written when a
        // proposal is recorded and `InquiryProposal` stores no answer body — measured once at 10
        // PROPOSED against 2 drafts, so eight rows would have sent a seller to read a sentence nobody
        // had written.
        long inquiryReady = workItems.countAwaitingSellerWithDraft(
                orgId, InquiryWorkItemPhase.AWAITING_SELLER);
        List<InquiryWorkItem> inquiries = workItems.findAwaitingSellerWithDraft(
                orgId, InquiryWorkItemPhase.AWAITING_SELLER, PageRequest.of(0, MAX_PREPARED));

        List<OperationsHomeView.PreparedItem> rows = new java.util.ArrayList<>();
        Map<UUID, String> channelCodes = new HashMap<>();
        for (Channel channel : channels.findAll()) {
            channelCodes.put(channel.getId(), channel.getCode());
        }
        for (ReviewReplyApproval approval : approved) {
            Review review = reviews.findById(approval.getReviewId()).orElse(null);
            if (review == null || !orgId.equals(review.getOrgId())) {
                continue;
            }
            // What tells one approved reply from the next. The product is the seller's own catalogue
            // name, already printed on every review surface — not a new disclosure — and the review's
            // date joins it because a shop with three approved replies on one product still could not
            // choose between three rows that said only its name.
            String product = review.getProductId() == null ? null
                    : products.findById(review.getProductId()).map(Product::getName).orElse(null);
            String receivedOn = review.getReceivedAt() == null ? null
                    : review.getReceivedAt().atZone(ZoneOffset.UTC).toLocalDate().toString();
            String detail = product == null ? receivedOn
                    : (receivedOn == null ? product : product + " · " + receivedOn);
            rows.add(new OperationsHomeView.PreparedItem(
                    "REVIEW_REPLY", review.getId(), "승인된 리뷰 답변", detail,
                    channelCodes.get(review.getChannelId()),
                    "/reviews/reply/" + review.getId()));
        }
        for (InquiryWorkItem item : inquiries) {
            // The inquiry's own subject, exactly as the work queue prints it. A NAVER product inquiry
            // has none, and then the row says only what kind of work it is rather than 「제목 없는 문의」.
            String subject = inquiryRepo.findById(item.getInquiryId())
                    .map(Inquiry::getTitle).filter(t -> !t.isBlank()).orElse(null);
            rows.add(new OperationsHomeView.PreparedItem(
                    "INQUIRY_REPLY", item.getId(), "초안이 준비된 문의", subject, null,
                    "/inquiries/" + item.getInquiryId()));
        }
        // An improvement draft the seller asked for. Re-derived by the opportunity service before it
        // gets here, so a draft whose problem stopped repeating is not counted — and an org that has
        // accepted nothing pays one indexed query for this whole block.
        List<OpportunityService.PreparedDraft> improvements = opportunities.preparedDrafts(orgId, on);
        for (OpportunityService.PreparedDraft prepared : improvements.stream().limit(MAX_PREPARED).toList()) {
            // The repeated problem's own title is what tells one improvement draft from the next, and
            // it is extractor vocabulary (「접착 · 탈락」) rather than anything a customer wrote.
            rows.add(new OperationsHomeView.PreparedItem(
                    "IMPROVEMENT_DRAFT", prepared.decisionId(),
                    prepared.opportunity().kindLabelKo() + " 초안", prepared.opportunity().issueTitle(),
                    null, "/memory/" + prepared.opportunity().issueId()));
        }

        return new OperationsHomeView.PreparedWork(
                approvedCount, inquiryReady, improvements.size(),
                rows.stream().limit(MAX_PREPARED).toList());
    }
}
