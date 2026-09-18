package com.sellerops.knowledge.bootstrap;

import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * <b>The automatic lane:</b> a seller who connects a channel gets their history learned without pressing anything.
 *
 * <p>Each tick looks for organisations with a connected API account whose history has not been read yet — the same
 * question the connected-sellers collection scope asks ({@code findOrgIdsWithConnectedApiAccount}), because connecting
 * a channel is the seller's instruction to read it — and runs {@link KnowledgeBootstrapService#bootstrap} once for each.
 * An organisation whose accounts all carry a finished history read is skipped without a request.
 *
 * <p><b>Off by default</b> ({@code sellerops.knowledge.bootstrap.auto.enabled}). It reaches the marketplace with READ
 * requests on a seller's behalf and has not run live; turning it on is a deployment decision, the same way the
 * routine collection scope is. The seller-pressed path ({@code POST /api/knowledge/learned/bootstrap}) needs no switch
 * beyond the connection itself, exactly as 지금 동기화 does.
 */
@Component
@ConditionalOnProperty(name = "sellerops.knowledge.bootstrap.auto.enabled", havingValue = "true")
public class KnowledgeBootstrapReconciler {

    private static final Logger log = LoggerFactory.getLogger(KnowledgeBootstrapReconciler.class);

    private final KnowledgeBootstrapService bootstrap;
    private final SellerAccountRepository accounts;

    public KnowledgeBootstrapReconciler(KnowledgeBootstrapService bootstrap, SellerAccountRepository accounts) {
        this.bootstrap = bootstrap;
        this.accounts = accounts;
    }

    @Scheduled(initialDelayString = "${sellerops.knowledge.bootstrap.auto.initial-delay-ms:120000}",
            fixedDelayString = "${sellerops.knowledge.bootstrap.auto.interval-ms:3600000}")
    public void tick() {
        for (UUID orgId : accounts.findOrgIdsWithConnectedApiAccount()) {
            try {
                if (bootstrap.historyAccounts(orgId).stream()
                        .anyMatch(a -> bootstrap.lastSuccessfulRead(a.getId()) == null)) {
                    bootstrap.bootstrap(orgId);
                }
            } catch (RuntimeException e) {
                // One organisation's failure never stops the next one's.
                log.warn("knowledge bootstrap tick failed org={} cause={}", orgId, e.getClass().getSimpleName());
            }
        }
    }
}
