package com.sellerops.connector.cafe24;

import com.sellerops.connector.cafe24.Cafe24AnswerSemanticProbe.ArticleStructure;
import com.sellerops.connector.cafe24.Cafe24AnswerSemanticProbe.CommentStructure;
import com.sellerops.connector.cafe24.Cafe24AnswerSemanticProbe.ProbeResult;
import com.sellerops.connector.cafe24.Cafe24AnswerSemanticProbe.UrgentInquiryStructure;
import com.sellerops.connector.cafe24.Cafe24AnswerSemanticProbe.UrgentReplyStructure;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * The bounded, approval-gated live proof for "which Cafe24 resource holds a seller's answer".
 *
 * <p><b>Triple-gated and inert by default.</b> The bean exists only when the connector is enabled
 * AND {@code sellerops.connector.cafe24.diagnostic.answer-semantics.enabled=true}, and even then it
 * does nothing unless an account id and a target article number are configured. It is not wired
 * into the scheduler or any collection path, and it never writes to the marketplace or the store.
 *
 * <p><b>Read-only, and bounded by construction.</b> Five requests, each named in the approved
 * manifest; two more are permitted and are spent only when R2 finds comments, because a comment on
 * the answered article means nothing until the unanswered control is known to lack one. The cap is
 * enforced here rather than trusted: {@link #MAX_REQUESTS} is checked before every call.
 *
 * <p><b>Nothing a customer wrote leaves this class.</b> The probe's projections carry no writer,
 * email, member id, phone or ip, and a body is reported as one of {@code NONE / SHORT / MEDIUM /
 * LONG}. That is enough to answer "can the answer body be read back from here", which is the whole
 * product question, and not enough to reproduce anyone's words.
 */
public class Cafe24AnswerSemanticProbeRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(Cafe24AnswerSemanticProbeRunner.class);
    private static final String TAG = "[cafe24-answer-semantics]";

    /** The approved marketplace GET budget for this diagnostic. */
    static final int MAX_REQUESTS = 7;

    private final Cafe24Authorizer authorizer;
    private final Cafe24AnswerSemanticProbe probe;
    private final SellerAccountRepository accounts;
    private final String accountIdProperty;
    private final int boardNo;
    private final long targetArticleNo;
    private final long processingControlNo;
    private final long unansweredControlNo;
    private final String targetDateProperty;
    private final int windowDays;

    private int requests;

    public Cafe24AnswerSemanticProbeRunner(Cafe24Authorizer authorizer,
                                           Cafe24AnswerSemanticProbe probe,
                                           SellerAccountRepository accounts,
                                           String accountIdProperty, int boardNo,
                                           long targetArticleNo, long processingControlNo,
                                           long unansweredControlNo, String targetDateProperty,
                                           int windowDays) {
        this.authorizer = authorizer;
        this.probe = probe;
        this.accounts = accounts;
        this.accountIdProperty = accountIdProperty;
        this.boardNo = boardNo;
        this.targetArticleNo = targetArticleNo;
        this.processingControlNo = processingControlNo;
        this.unansweredControlNo = unansweredControlNo;
        this.targetDateProperty = targetDateProperty;
        this.windowDays = windowDays;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (accountIdProperty == null || accountIdProperty.isBlank() || targetArticleNo <= 0) {
            log.warn("{} enabled but not configured (account-id / target-article-no); skipping.", TAG);
            return;
        }
        UUID accountId;
        LocalDate targetDate;
        try {
            accountId = UUID.fromString(accountIdProperty.trim());
            targetDate = LocalDate.parse(targetDateProperty.trim());
        } catch (RuntimeException e) {
            log.warn("{} configured account-id or target-date is malformed; skipping.", TAG);
            return;
        }
        try {
            execute(accountId, targetDate);
        } catch (RuntimeException e) {
            // A diagnostic must never crash the backend it boots in, and must never echo a body.
            log.warn("{} aborted (unexpected error); backend continues.", TAG);
        }
    }

    private void execute(UUID accountId, LocalDate targetDate) {
        Optional<SellerAccount> account = accounts.findById(accountId);
        if (account.isEmpty()) {
            log.warn("{} ACCOUNT_NOT_FOUND; nothing called.", TAG);
            return;
        }
        Cafe24Authorizer.Authorized auth;
        try {
            auth = authorizer.authorize(account.get().getOrgId(), accountId);
        } catch (RuntimeException e) {
            // Fail closed: no probe request is made after a refresh/rotation failure.
            log.warn("{} AUTH_FAILED; zero marketplace requests made.", TAG);
            return;
        }
        log.info("{} start board={} target={} p_control={} n_control={} window_days={} budget={}",
                TAG, boardNo, targetArticleNo, processingControlNo, unansweredControlNo,
                windowDays, MAX_REQUESTS);

        // R1 — C / P / N in one request.
        List<Long> trio = List.of(targetArticleNo, processingControlNo, unansweredControlNo);
        ProbeResult<List<ArticleStructure>> r1 = spend("R1",
                () -> probe.articlesByNumber(auth.accessToken(), auth.mallId(), boardNo, trio));
        logArticles("R1", r1);

        // R2 — comments on the answered target.
        ProbeResult<List<CommentStructure>> r2 = spend("R2",
                () -> probe.comments(auth.accessToken(), auth.mallId(), boardNo, targetArticleNo));
        logComments("R2", targetArticleNo, r2);

        // R3 — one week of the same board, to find a reply ARTICLE hanging off the target.
        ProbeResult<List<ArticleStructure>> r3 = spend("R3",
                () -> probe.articlesInWindow(auth.accessToken(), auth.mallId(), boardNo,
                        targetDate, targetDate.plusDays(windowDays), 100));
        List<ArticleStructure> children = childrenOf(r3, targetArticleNo);
        log.info("{} R3 outcome={} window_rows={} children_of_target={}", TAG, r3.outcome(),
                r3.ok() ? r3.value().size() : 0, children.size());
        for (ArticleStructure child : children) {
            log.info("{} R3 child article_no={} parent={} depth={} seq={} reply_status={} "
                            + "reply_user_id_present={} body={} created={}",
                    TAG, child.articleNo(), child.parentArticleNo(), child.replyDepth(),
                    child.replySequence(), child.replyStatus(), child.replyUserIdPresent(),
                    child.bodyBucket(), child.createdDate());
        }

        // R4 — the urgentinquiry reply at the same numeric id.
        ProbeResult<List<UrgentReplyStructure>> r4 = spend("R4",
                () -> probe.urgentReply(auth.accessToken(), auth.mallId(), targetArticleNo));
        log.info("{} R4 outcome={} http={} replies={}", TAG, r4.outcome(), r4.httpStatus(),
                r4.ok() ? r4.value().size() : 0);
        if (r4.ok()) {
            for (UrgentReplyStructure reply : r4.value()) {
                log.info("{} R4 reply article_no={} status={} user_id_present={} count={} "
                                + "method={} body={} created={}",
                        TAG, reply.articleNo(), reply.status(), reply.userIdPresent(), reply.count(),
                        reply.method(), reply.bodyBucket(), reply.createdDate());
            }
        }

        // R5 — same-day urgentinquiry list: does this article exist in that resource at all.
        ProbeResult<List<UrgentInquiryStructure>> r5 = spend("R5",
                () -> probe.urgentInquiriesOn(auth.accessToken(), auth.mallId(), targetDate, 100));
        boolean identityConfirmed = false;
        if (r5.ok()) {
            for (UrgentInquiryStructure row : r5.value()) {
                if (row.articleNo() != null && row.articleNo() == targetArticleNo) {
                    identityConfirmed = true;
                    log.info("{} R5 MATCH article_no={} type={} reply_status={} search_type={}",
                            TAG, row.articleNo(), row.articleType(), row.replyStatus(),
                            row.searchType());
                }
            }
        }
        log.info("{} R5 outcome={} same_day_rows={} target_present_in_urgentinquiry={}", TAG,
                r5.outcome(), r5.ok() ? r5.value().size() : 0, identityConfirmed);

        // Controls for the comment lane — spent only when a comment actually exists on the target,
        // because until then there is nothing for a control to disprove.
        boolean commentsOnTarget = r2.ok() && !r2.value().isEmpty();
        long mallCommentsOnTarget = !r2.ok() ? 0
                : r2.value().stream().filter(CommentStructure::memberIsMall).count();
        boolean commentsOnUnansweredControl = false;
        boolean commentsOnProcessingControl = false;
        if (commentsOnTarget) {
            ProbeResult<List<CommentStructure>> cn = spend("R2-N",
                    () -> probe.comments(auth.accessToken(), auth.mallId(), boardNo,
                            unansweredControlNo));
            logComments("R2-N", unansweredControlNo, cn);
            commentsOnUnansweredControl = cn.ok() && !cn.value().isEmpty();
            ProbeResult<List<CommentStructure>> cp = spend("R2-P",
                    () -> probe.comments(auth.accessToken(), auth.mallId(), boardNo,
                            processingControlNo));
            logComments("R2-P", processingControlNo, cp);
            commentsOnProcessingControl = cp.ok() && !cp.value().isEmpty();
        }

        boolean a1 = !children.isEmpty();
        // A2 is claimed by ACTOR, not by presence. A comment on the target proves a comment exists;
        // only member_id == mall_id proves the SHOP wrote it, and a board comment may equally be a
        // customer's ("comments added by a shopping mall customer or manager" — the reference's own
        // sentence). The two control reads below stay in the record as observations; they are no
        // longer what the verdict rests on, because a proxy for authorship is not authorship.
        boolean a2 = mallCommentsOnTarget > 0;
        boolean b = r4.ok() && !r4.value().isEmpty() && identityConfirmed;

        log.info("{} evidence A1_reply_article={} A2_comment={} (target_comments={} "
                        + "target_mall_comments={} n_control={} p_control={}) B_urgent_reply={} "
                        + "(reply_present={} identity_confirmed={})",
                TAG, a1, a2, commentsOnTarget, mallCommentsOnTarget, commentsOnUnansweredControl,
                commentsOnProcessingControl, b, r4.ok() && !r4.value().isEmpty(), identityConfirmed);
        log.info("{} VERDICT={} requests_used={}", TAG, verdict(a1, a2, b), requests);
    }

    /**
     * The classification, and the two ways it refuses to become a claim: more than one
     * representation present is not a choice between them, and none present is not "the platform
     * does not support it".
     */
    static String verdict(boolean replyArticle, boolean comment, boolean urgentReply) {
        int found = (replyArticle ? 1 : 0) + (comment ? 1 : 0) + (urgentReply ? 1 : 0);
        if (found > 1) {
            return "MULTIPLE_REPRESENTATIONS";
        }
        if (replyArticle) {
            return "STANDARD_BOARD_REPLY_ARTICLE";
        }
        if (comment) {
            return "STANDARD_BOARD_COMMENT";
        }
        if (urgentReply) {
            return "URGENT_INQUIRY_REPLY";
        }
        return "UNPROVEN";
    }

    /** A child is an article whose parent IS the target — proximity in the window is not a relation. */
    private static List<ArticleStructure> childrenOf(ProbeResult<List<ArticleStructure>> window,
                                                     long targetArticleNo) {
        if (!window.ok()) {
            return List.of();
        }
        List<ArticleStructure> out = new ArrayList<>();
        for (ArticleStructure row : window.value()) {
            if (row.parentArticleNo() != null && row.parentArticleNo() == targetArticleNo
                    && (row.articleNo() == null || row.articleNo() != targetArticleNo)) {
                out.add(row);
            }
        }
        return List.copyOf(out);
    }

    private <T> ProbeResult<T> spend(String label, java.util.function.Supplier<ProbeResult<T>> call) {
        if (requests >= MAX_REQUESTS) {
            log.warn("{} {} SKIPPED — request budget {} exhausted.", TAG, label, MAX_REQUESTS);
            return new ProbeResult<>("BUDGET_EXHAUSTED", 0, null);
        }
        requests++;
        return call.get();
    }

    private static void logArticles(String label, ProbeResult<List<ArticleStructure>> result) {
        log.info("{} {} outcome={} http={} rows={}", TAG, label, result.outcome(),
                result.httpStatus(), result.ok() ? result.value().size() : 0);
        if (!result.ok()) {
            return;
        }
        for (ArticleStructure row : result.value()) {
            log.info("{} {} article_no={} parent={} reply_status={} reply={} "
                            + "reply_user_id_present={} seq={} depth={} title={} body={} created={}",
                    TAG, label, row.articleNo(), row.parentArticleNo(), row.replyStatus(),
                    row.reply(), row.replyUserIdPresent(), row.replySequence(), row.replyDepth(),
                    row.titleBucket(), row.bodyBucket(), row.createdDate());
        }
    }

    private static void logComments(String label, long articleNo,
                                    ProbeResult<List<CommentStructure>> result) {
        log.info("{} {} article_no={} outcome={} http={} comment_count={}", TAG, label, articleNo,
                result.outcome(), result.httpStatus(), result.ok() ? result.value().size() : 0);
        if (!result.ok()) {
            return;
        }
        for (CommentStructure row : result.value()) {
            log.info("{} {} comment_no={} on_article={} parent_comment={} body={} created={} "
                            + "member_is_mall={}",
                    TAG, label, row.commentNo(), row.articleNo(), row.parentCommentNo(),
                    row.bodyBucket(), row.createdDate(), row.memberIsMall());
        }
    }
}
