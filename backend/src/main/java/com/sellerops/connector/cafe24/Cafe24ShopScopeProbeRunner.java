package com.sellerops.connector.cafe24;

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
 * Runs the shop-scope observation once, at boot, and only when an operator has named the exact
 * articles to look at.
 *
 * <p><b>Three gates and a hard cap.</b> The connector flag, this runner's own flag, and both a
 * configured account and an explicit article list; then a single request. Nothing here searches: an
 * article number that an operator did not write down cannot be read, so this runner has no way to
 * become a walk of the board.
 */
public class Cafe24ShopScopeProbeRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(Cafe24ShopScopeProbeRunner.class);
    private static final String TAG = "[cafe24-shop-scope]";

    private final Cafe24Authorizer authorizer;
    private final Cafe24ShopScopeProbe probe;
    private final SellerAccountRepository accounts;
    private final String accountId;
    private final int boardNo;
    private final String articleNos;

    public Cafe24ShopScopeProbeRunner(Cafe24Authorizer authorizer, Cafe24ShopScopeProbe probe,
                                      SellerAccountRepository accounts, String accountId,
                                      int boardNo, String articleNos) {
        this.authorizer = authorizer;
        this.probe = probe;
        this.accounts = accounts;
        this.accountId = accountId;
        this.boardNo = boardNo;
        this.articleNos = articleNos;
    }

    @Override
    public void run(ApplicationArguments args) {
        List<Long> targets = parse(articleNos);
        if (accountId == null || accountId.isBlank() || targets.isEmpty()) {
            log.info("{} 대상 미설정 — zero marketplace requests made.", TAG);
            return;
        }
        SellerAccount account = accounts.findById(UUID.fromString(accountId.strip())).orElse(null);
        if (account == null) {
            log.warn("{} 계정을 찾지 못함 — zero marketplace requests made.", TAG);
            return;
        }
        Cafe24Authorizer.Authorized auth;
        try {
            auth = authorizer.authorize(account.getOrgId(), account.getId());
        } catch (RuntimeException e) {
            log.warn("{} AUTH_FAILED; zero marketplace requests made.", TAG);
            return;
        }
        Cafe24ShopScopeProbe.Report r = probe.observe(auth.accessToken(), auth.mallId(), boardNo,
                targets, 1);
        if (!r.ok()) {
            log.warn("{} 결과={} 요청={}회 — 관측 중단.", TAG, r.outcome(), r.requests());
            return;
        }
        log.info("{} 요청={}회 조회대상={} 응답={}", TAG, r.requests(), r.requested(), r.returned());
        for (Cafe24ShopScopeProbe.Placement p : r.placements()) {
            log.info("{} article={} shop_no={} board_no={} parent={} reply_depth={} reply_status={}",
                    TAG, p.articleNo(), p.shopNo(), p.boardNo(), p.parentArticleNo(),
                    p.replyDepth(), p.replyStatus());
        }
    }

    private static List<Long> parse(String csv) {
        List<Long> out = new ArrayList<>();
        if (csv == null || csv.isBlank()) {
            return out;
        }
        for (String token : csv.split(",")) {
            String t = token.strip();
            if (t.isEmpty()) {
                continue;
            }
            try {
                long value = Long.parseLong(t);
                if (value > 0) {
                    out.add(value);
                }
            } catch (NumberFormatException e) {
                // A malformed id is dropped, never widened into a range.
            }
        }
        return out;
    }
}
