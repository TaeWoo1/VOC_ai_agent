package com.sellerops.connector.cafe24;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * Runs the reply-actor observation once, at boot, and only when an operator has said so.
 *
 * <p><b>Three gates and a hard cap.</b> The connector flag, this runner's own flag, and a configured
 * account id; then a request budget that the probe itself refuses to exceed. There is no dry-run
 * switch because there is nothing to switch off: the observation is READ-only end to end and mutates
 * no row in this database or on the platform.
 *
 * <p>Its targets are not searched for. They are read out of rows a previous approved READ already
 * proved — {@code thread_role = 'REPLY'} and the parent each of those rows names — so the set is
 * closed before the first request and a row this repository never proved cannot enter it. A reply
 * whose parent is unknown is dropped rather than guessed at.
 */
public class Cafe24ReplyActorProbeRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(Cafe24ReplyActorProbeRunner.class);
    private static final String TAG = "[cafe24-reply-actor]";

    private final Cafe24Authorizer authorizer;
    private final Cafe24ReplyActorProbe probe;
    private final SellerAccountRepository accounts;
    private final InquiryRepository inquiries;
    private final String accountId;
    private final int boardNo;
    private final int batchSize;
    private final int maxRequests;

    public Cafe24ReplyActorProbeRunner(Cafe24Authorizer authorizer, Cafe24ReplyActorProbe probe,
                                       SellerAccountRepository accounts, InquiryRepository inquiries,
                                       String accountId, int boardNo, int batchSize, int maxRequests) {
        this.authorizer = authorizer;
        this.probe = probe;
        this.accounts = accounts;
        this.inquiries = inquiries;
        this.accountId = accountId;
        this.boardNo = boardNo;
        this.batchSize = batchSize;
        this.maxRequests = maxRequests;
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
        List<Cafe24ReplyActorProbe.Target> targets = targets(account);
        if (targets.isEmpty()) {
            log.info("{} 증명된 답글 0건 — zero marketplace requests made.", TAG);
            return;
        }
        Cafe24Authorizer.Authorized auth;
        try {
            auth = authorizer.authorize(account.getOrgId(), account.getId());
        } catch (RuntimeException e) {
            log.warn("{} AUTH_FAILED; zero marketplace requests made.", TAG);
            return;
        }
        log.info("{} start board={} 답글={}건 batch={} 상한={}회", TAG, boardNo, targets.size(),
                batchSize, maxRequests);
        Cafe24ReplyActorProbe.Report r = probe.observe(auth.accessToken(), auth.mallId(), boardNo,
                targets, batchSize, maxRequests);
        if (!r.ok()) {
            log.warn("{} 결과={} 요청={}회 — 관측 중단.", TAG, r.outcome(), r.requests());
            return;
        }
        log.info("{} 요청={}회 예산소진={} 조회대상={} 응답={} 미응답={}",
                TAG, r.requests(), r.budgetExhausted(), r.requested(), r.returned(), r.unreturned());
        log.info("{} 답글={}건 · writer={} · 회원식별자={} · 상점식별자와동일={} · 작성IP={} "
                        + "· 담당자ID={} · 답변상태={} · writer종류={} · 회원식별자종류={}",
                TAG, r.replies(), r.replyWriterPresent(), r.replyMemberIdPresent(),
                r.replyMemberIdEqualsMallId(), r.replyClientIpPresent(), r.replyUserIdPresentOnReply(),
                r.replyStatusPresentOnReply(), r.distinctReplyWriterClasses(),
                r.distinctReplyMemberIdClasses());
        log.info("{} 부모={}건 · 답변상태 C={} P={} N={} 없음={} · 담당자ID={} "
                        + "· writer={} · 상점식별자와동일={}",
                TAG, r.parents(), r.parentReplyStatusC(), r.parentReplyStatusP(),
                r.parentReplyStatusN(), r.parentReplyStatusAbsent(), r.replyUserIdPresentOnParent(),
                r.parentWriterPresent(), r.parentMemberIdEqualsMallId());
        log.info("{} 제목관계 동일={} 접두={} 기타={} 없음={} · 답글깊이최대={} 답글순번최대={} "
                        + "· 자식이 부모보다 늦음={}",
                TAG, r.titleSameAsParent(), r.titlePrefixed(), r.titleOther(), r.titleAbsent(),
                r.maxReplyDepth(), r.maxReplySequence(), r.childCreatedNotBeforeParent());
    }

    /**
     * The closed target set: each proven reply and the parent it names. A row whose parent reference
     * is missing or is not a Cafe24 board article number is skipped — the observation asks about
     * pairs it can name on both sides, never about a number it reconstructed.
     */
    private List<Cafe24ReplyActorProbe.Target> targets(SellerAccount account) {
        List<Inquiry> replies = inquiries.findProvenThreadRepliesForAccount(
                account.getOrgId(), account.getId());
        List<Cafe24ReplyActorProbe.Target> out = new ArrayList<>();
        for (Inquiry reply : replies) {
            Long child = articleNo(reply.getExternalId());
            Long parent = articleNo(reply.getThreadParentExternalId());
            if (child != null && parent != null) {
                out.add(new Cafe24ReplyActorProbe.Target(child, parent));
            }
        }
        return List.copyOf(out);
    }

    /** {@code cafe24:b6:a247} → {@code 247}; anything else → null (skipped, never guessed). */
    static Long articleNo(String externalId) {
        if (externalId == null) {
            return null;
        }
        int at = externalId.lastIndexOf(":a");
        if (at < 0) {
            return null;
        }
        try {
            long value = Long.parseLong(externalId.substring(at + 2));
            return value > 0 ? value : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
