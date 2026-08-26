package com.sellerops.connector.cafe24;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * The approval-gated execution of the historical comment reconciliation
 * ({@code apr-c24-hist-comments}).
 *
 * <p><b>Triple-gated and inert by default.</b> The bean exists only when the connector is enabled AND
 * {@code sellerops.connector.cafe24.reconcile.historical-comments.enabled=true}, and even then it
 * does nothing unless an account id and a board number are configured. It is not wired into the
 * scheduler or any collection path.
 *
 * <p><b>The candidate set is derived, never typed.</b> The manifest names 25 articles; re-typing them
 * into configuration would create a second copy of the truth that could drift from the database
 * between approval and execution. Instead the runner asks the store the same question the audit asked
 * — this org's ACTIVE, REAL, UNANSWERED rows on this board — and then refuses to proceed if the answer
 * exceeds {@link Cafe24InquiryAnswerObserver#MAX_EXACT_COMMENT_READS}. A run that found more rows than
 * its approval covered is not a run that should quietly do the first 25.
 *
 * <p><b>The budget is reported from what happened.</b> {@code requests()} is computed from the actual
 * number of comment reads, not asserted from the plan, so a report cannot claim a bound the run did
 * not keep.
 */
public class Cafe24HistoricalCommentRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(Cafe24HistoricalCommentRunner.class);
    private static final String TAG = "[cafe24-historical-comments]";
    private static final String CHANNEL_CODE = "CAFE24";

    private final Cafe24Authorizer authorizer;
    private final Cafe24HistoricalCommentReconciler reconciler;
    private final SellerAccountRepository accounts;
    private final InquiryRepository inquiries;
    private final ChannelRepository channels;
    private final String accountIdProperty;
    private final int boardNo;

    public Cafe24HistoricalCommentRunner(Cafe24Authorizer authorizer,
                                         Cafe24HistoricalCommentReconciler reconciler,
                                         SellerAccountRepository accounts,
                                         InquiryRepository inquiries, ChannelRepository channels,
                                         String accountIdProperty, int boardNo) {
        this.authorizer = authorizer;
        this.reconciler = reconciler;
        this.accounts = accounts;
        this.inquiries = inquiries;
        this.channels = channels;
        this.accountIdProperty = accountIdProperty;
        this.boardNo = boardNo;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (accountIdProperty == null || accountIdProperty.isBlank() || boardNo <= 0) {
            log.warn("{} enabled but not configured (account-id / board-no); skipping.", TAG);
            return;
        }
        try {
            execute(UUID.fromString(accountIdProperty.trim()));
        } catch (RuntimeException e) {
            // A one-off reconciliation must never crash the backend it boots in, and never echo a body.
            log.warn("{} aborted ({}); backend continues.", TAG, e.getClass().getSimpleName());
        }
    }

    private void execute(UUID accountId) {
        Optional<SellerAccount> account = accounts.findById(accountId);
        if (account.isEmpty()) {
            log.warn("{} ACCOUNT_NOT_FOUND; nothing called.", TAG);
            return;
        }
        UUID orgId = account.get().getOrgId();
        Optional<Channel> channel = channels.findByCode(CHANNEL_CODE);
        if (channel.isEmpty()) {
            log.warn("{} CHANNEL_NOT_FOUND; nothing called.", TAG);
            return;
        }
        UUID channelId = channel.get().getId();

        List<Long> candidates = candidates(orgId, channelId);
        if (candidates.isEmpty()) {
            log.info("{} outcome=NO_CANDIDATES requests_used=0 — 미답변 백로그가 비어 있습니다.", TAG);
            return;
        }
        if (candidates.size() > Cafe24InquiryAnswerObserver.MAX_EXACT_COMMENT_READS) {
            log.warn("{} REFUSED candidates={} cap={} — 승인 범위를 넘는 대상 수. 요청 0회.",
                    TAG, candidates.size(), Cafe24InquiryAnswerObserver.MAX_EXACT_COMMENT_READS);
            return;
        }

        Cafe24Authorizer.Authorized auth = authorizer.authorize(orgId, accountId);
        log.info("{} start board={} candidates={} budget<={}",
                TAG, boardNo, candidates.size(), 1 + candidates.size());
        Cafe24HistoricalCommentReconciler.Outcome outcome =
                reconciler.reconcile(auth.accessToken(), auth.mallId(), orgId, channelId, boardNo,
                        candidates);
        int remaining = inquiries.findRealUnansweredForCoverage(orgId, channelId).size();
        log.info("{} OUTCOME requests_used={} candidates={} answered_by_shop_comment={} "
                        + "no_shop_comment={} row_missing={} true_unanswered_now={}",
                TAG, outcome.requests(), outcome.candidates(), outcome.answeredByShopComment(),
                outcome.noShopComment(), outcome.unreadable(), remaining);
    }

    /**
     * The rows this org still holds as 미답변 on this board — the same question the DB audit asked,
     * through the finder that already exists for it.
     *
     * <p>{@code findRealUnansweredForCoverage} is channel-scoped rather than account-scoped on
     * purpose. One of these rows carries a null {@code seller_account_id}, and the account-scoped
     * finder would silently drop it — but the article belongs to this mall's board 6 whatever that
     * column holds, and a bounded run that quietly asked about 24 of the 25 rows its manifest named
     * would report a "true" count derived from a set nobody approved. Rows without a readable article
     * number are skipped rather than guessed at.
     */
    private List<Long> candidates(UUID orgId, UUID channelId) {
        List<Long> out = new ArrayList<>();
        String prefix = "cafe24:b" + boardNo + ":a";
        int accountless = 0;
        for (Inquiry row : inquiries.findRealUnansweredForCoverage(orgId, channelId)) {
            String externalId = row.getExternalId();
            if (externalId == null || !externalId.startsWith(prefix)) {
                continue;
            }
            try {
                out.add(Long.parseLong(externalId.substring(prefix.length())));
                if (row.getSellerAccountId() == null) {
                    accountless++;
                }
            } catch (NumberFormatException e) {
                // An identity we cannot address is not one we ask about.
                log.info("{} skipped one row whose article number could not be read.", TAG);
            }
        }
        if (accountless > 0) {
            log.info("{} candidates include {} row(s) with no seller_account_id — same mall, "
                    + "attributed by board and article identity.", TAG, accountless);
        }
        return List.copyOf(out);
    }
}
