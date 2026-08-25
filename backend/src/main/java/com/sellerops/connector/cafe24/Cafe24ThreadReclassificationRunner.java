package com.sellerops.connector.cafe24;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * Runs the bounded thread reclassification once, at boot, and only when an operator has said so.
 *
 * <p><b>Four gates, and the last one is on by default.</b> The connector flag, this runner's own
 * flag, a configured account id, and {@code dry-run} — which defaults to {@code true}, so flipping
 * the flag observes and reports without writing a row. Turning the write on is a separate, deliberate
 * act, and it is the one that needs a live approval with a manifest.
 *
 * <p>It is not wired into the scheduler, the collection path, or any HTTP surface. It reads exactly
 * the rows the seller is currently shown as unanswered work, asks the source about those article
 * numbers and no others, and stops at a hard request cap. Every number it logs is a count.
 */
public class Cafe24ThreadReclassificationRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(Cafe24ThreadReclassificationRunner.class);
    private static final String TAG = "[cafe24-thread-reclassify]";

    private final Cafe24Authorizer authorizer;
    private final Cafe24ThreadReclassifier reclassifier;
    private final SellerAccountRepository accounts;
    private final InquiryRepository inquiries;
    private final String accountId;
    private final int boardNo;
    private final int batchSize;
    private final int maxRequests;
    private final boolean dryRun;

    public Cafe24ThreadReclassificationRunner(Cafe24Authorizer authorizer,
                                              Cafe24ThreadReclassifier reclassifier,
                                              SellerAccountRepository accounts,
                                              InquiryRepository inquiries,
                                              String accountId, int boardNo, int batchSize,
                                              int maxRequests, boolean dryRun) {
        this.authorizer = authorizer;
        this.reclassifier = reclassifier;
        this.accounts = accounts;
        this.inquiries = inquiries;
        this.accountId = accountId;
        this.boardNo = boardNo;
        this.batchSize = batchSize;
        this.maxRequests = maxRequests;
        this.dryRun = dryRun;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (accountId == null || accountId.isBlank()) {
            log.info("{} account-id 미설정 — 아무 요청도 하지 않음.", TAG);
            return;
        }
        SellerAccount account = accounts.findById(UUID.fromString(accountId.strip())).orElse(null);
        if (account == null) {
            log.warn("{} 계정을 찾지 못함 — zero marketplace requests made.", TAG);
            return;
        }
        List<Inquiry> rows = inquiries.findActiveUnansweredForAccount(
                account.getOrgId(), account.getId());
        if (rows.isEmpty()) {
            log.info("{} 대상 0건 — zero marketplace requests made.", TAG);
            return;
        }
        Cafe24Authorizer.Authorized auth;
        try {
            auth = authorizer.authorize(account.getOrgId(), account.getId());
        } catch (RuntimeException e) {
            log.warn("{} AUTH_FAILED; zero marketplace requests made.", TAG);
            return;
        }
        log.info("{} start board={} 대상={}건 batch={} 상한={}회 dry_run={}",
                TAG, boardNo, rows.size(), batchSize, maxRequests, dryRun);
        Cafe24ThreadReclassifier.Outcome outcome = reclassifier.reclassify(
                auth.accessToken(), auth.mallId(), boardNo, rows, batchSize, maxRequests, dryRun);
        log.info("{} 요청={}회 조회대상={} 응답={} 미응답={} 답글판정={} 원글확인={} 신호불일치={} 예산소진={} dry_run={}",
                TAG, outcome.requests(), outcome.requested(), outcome.returned(), outcome.unreturned(),
                outcome.reclassified(), outcome.confirmedRoot(), outcome.disagreements(),
                outcome.budgetExhausted(), dryRun);
    }
}
