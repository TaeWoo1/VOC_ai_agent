package com.sellerops.connector.cafe24.spike;

import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * Operator-gated one-shot entrypoint for the board-6 reply spike. By default it is
 * inert-safe: it logs the dry-run plan and, if a spike account is configured,
 * performs a READ-ONLY readiness probe (spike token refresh → granted-scope boolean;
 * read the target article's reply_status and comment count). It posts a comment ONLY
 * when the operator additionally sets {@code ...spike.reply.execute-write=true} and
 * supplies a single-use {@code ...spike.reply.approval} value — and even then every
 * engine gate still applies (board 6, test article, pre-status N, no duplicate).
 *
 * <p><b>Triple-gated, never on a normal path.</b> The bean exists only when the
 * connector flag AND {@code sellerops.connector.cafe24.spike.reply.enabled=true} are
 * set; the write additionally needs {@code execute-write=true} + a matching approval.
 * All output is sanitized: booleans, counts, closed-vocabulary status tokens, and the
 * verdict — never a token, mall id, comment body, writer, or password.
 */
public class Cafe24ReplySpikeRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(Cafe24ReplySpikeRunner.class);

    private final SpikeReplyEngine engine;
    private final SpikeReplyTransport transport;
    private final SpikeAuthorizer authorizer;
    private final SellerAccountRepository accounts;

    private final String accountIdProperty;
    private final long articleNo;
    private final String commandId;
    private final boolean executeWrite;
    private final SpikeReplyCommand.ContentSource contentSource;
    private final String operatorContent;
    private final String approval;

    public Cafe24ReplySpikeRunner(SpikeReplyEngine engine, SpikeReplyTransport transport,
                                  SpikeAuthorizer authorizer, SellerAccountRepository accounts,
                                  String accountIdProperty, long articleNo, String commandId,
                                  boolean executeWrite, SpikeReplyCommand.ContentSource contentSource,
                                  String operatorContent, String approval) {
        this.engine = engine;
        this.transport = transport;
        this.authorizer = authorizer;
        this.accounts = accounts;
        this.accountIdProperty = accountIdProperty;
        this.articleNo = articleNo;
        this.commandId = commandId;
        this.executeWrite = executeWrite;
        this.contentSource = contentSource;
        this.operatorContent = operatorContent;
        this.approval = approval;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            runSpike();
        } catch (RuntimeException e) {
            // Defense in depth: a spike must never crash the backend it boots in.
            log.warn("[cafe24-reply-spike] aborted (unexpected error); backend continues.");
        }
    }

    private void runSpike() {
        SpikeReplyCommand cmd = new SpikeReplyCommand(
                commandId == null || commandId.isBlank() ? "spike-boot" : commandId.trim(),
                Cafe24Boards.PRODUCT_INQUIRY_BOARD_NO, articleNo,
                true, /*dryRun*/ !executeWrite, approval, contentSource, operatorContent);

        SpikeReplyPlan plan = engine.plan(cmd);
        log.info("[cafe24-reply-spike] PLAN board={} article={} content_source={} preflight={} approval_required={}",
                plan.boardNo(), plan.articleNo(), plan.contentSource(), plan.preflightNote(),
                plan.approvalWouldBeRequired());

        if (accountIdProperty == null || accountIdProperty.isBlank()) {
            log.info("[cafe24-reply-spike] no spike account configured; dry-run plan only (no network).");
            return;
        }
        UUID accountId;
        try {
            accountId = UUID.fromString(accountIdProperty.trim());
        } catch (IllegalArgumentException e) {
            log.warn("[cafe24-reply-spike] configured account-id is not a valid UUID; skipping.");
            return;
        }
        Optional<SellerAccount> account = accounts.findById(accountId);
        if (account.isEmpty()) {
            log.warn("[cafe24-reply-spike] configured account not found; skipping.");
            return;
        }
        UUID orgId = account.get().getOrgId();

        // Spike token refresh → granted-scope boolean (read + write consent path).
        SpikeAuthorization auth = authorizer.authorizeForSpike(orgId, accountId);
        log.info("[cafe24-reply-spike] write_scope_granted={}", auth.writeCommunityGranted());

        if (!executeWrite) {
            readOnlyProbe(auth);
            return;
        }
        SpikeReplyResult result = engine.execute(auth, cmd);
        logResult(result);
    }

    /** Read-only readiness probe — never posts a comment. */
    private void readOnlyProbe(SpikeAuthorization auth) {
        try {
            SpikeReplyTransport.ArticleObservation a = transport.observeArticle(
                    auth.mallId(), auth.accessToken(), Cafe24Boards.PRODUCT_INQUIRY_BOARD_NO, articleNo);
            List<SpikeReplyTransport.CommentObservation> comments = transport.listComments(
                    auth.mallId(), auth.accessToken(), Cafe24Boards.PRODUCT_INQUIRY_BOARD_NO, articleNo);
            log.info("[cafe24-reply-spike] READ_ONLY_PROBE pre_status_token={} comment_count={}",
                    SpikeReplyResult.tokenClass(a.rawReplyStatus()), comments.size());
        } catch (SpikeTransportException e) {
            log.warn("[cafe24-reply-spike] read-only probe transport error; halting (no post).");
        }
        log.info("[cafe24-reply-spike] execute-write=false → no comment posted.");
    }

    private void logResult(SpikeReplyResult r) {
        log.info("[cafe24-reply-spike] OUTCOME={} VERDICT={} replay={}",
                r.outcome(), r.verdict(), r.idempotentReplay());
        log.info("[cafe24-reply-spike] write_scope_granted={} board_ok={} test_article={} approval_present={}",
                r.writeScopeGranted(), r.boardOk(), r.testArticleConfirmed(), r.approvalPresent());
        log.info("[cafe24-reply-spike] pre_status={} pre_token={} existing_spike_comment={} comments_before={} comments_after={} spike_created={} post_status={} post_token={}",
                r.preStatus(), r.preStatusToken(), r.existingSpikeCommentFound(),
                r.commentsBefore(), r.commentsAfter(), r.spikeCommentsCreated(),
                r.postStatus(), r.postStatusToken());
    }
}
