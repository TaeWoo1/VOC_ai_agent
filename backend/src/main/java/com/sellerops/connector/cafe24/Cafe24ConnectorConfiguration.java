package com.sellerops.connector.cafe24;

import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.lifecycle.InquiryOperationalStateProjector;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Wires the Cafe24 connector strictly behind the feature flag. With
 * {@code sellerops.connector.cafe24.enabled=false} (the default) none of these
 * beans exist: the registry sees only the mock connector for CAFE24 and
 * runtime behavior is byte-identical to before. Flipping the flag is a
 * deliberate operator act; the connector then collects {@code ORDER_SUMMARY}
 * via the Admin orders API.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.connector.cafe24.enabled", havingValue = "true")
public class Cafe24ConnectorConfiguration {

    /**
     * The transport pins the Cafe24 Admin-API version. A blank value fails closed
     * (the client throws at construction, so the enabled connector never issues an
     * admin call against an unspecified version). Current verified value: 2025-12-01.
     */
    @Bean
    Cafe24HttpClient cafe24HttpClient(
            @Value("${sellerops.connector.cafe24.api-version:}") String apiVersion) {
        return new JdkCafe24HttpClient(apiVersion);
    }

    @Bean
    Cafe24TokenClient cafe24TokenClient(Cafe24HttpClient http) {
        return new Cafe24TokenClient(http);
    }

    @Bean
    Cafe24OrdersClient cafe24OrdersClient(Cafe24HttpClient http) {
        return new Cafe24OrdersClient(http);
    }

    @Bean
    Cafe24BoardArticlesClient cafe24BoardArticlesClient(Cafe24HttpClient http) {
        return new Cafe24BoardArticlesClient(http);
    }

    /**
     * The shared refresh + single-use rotation write-back seam. One instance is
     * injected into both the connector and the diagnostic runner so they use the
     * exact same credential path. App OAuth credentials are server config, shared
     * across malls, never vaulted.
     */
    @Bean
    Cafe24Authorizer cafe24Authorizer(
            Cafe24TokenClient tokenClient, CredentialVault vault,
            @Value("${sellerops.connector.cafe24.oauth.client-id:}") String appClientId,
            @Value("${sellerops.connector.cafe24.oauth.client-secret:}") String appClientSecret) {
        return new Cafe24Authorizer(tokenClient, vault, appClientId, appClientSecret);
    }

    @Bean
    Cafe24ProductsClient cafe24ProductsClient(Cafe24HttpClient http) {
        return new Cafe24ProductsClient(http);
    }

    @Bean
    Cafe24ApiConnector cafe24ApiConnector(
            Cafe24Authorizer authorizer, Cafe24OrdersClient ordersClient,
            Cafe24BoardArticlesClient articlesClient, Cafe24ProductsClient productsClient) {
        // System UTC clock; the connector applies the explicit KST zone for date math.
        return new Cafe24ApiConnector(authorizer, ordersClient, articlesClient, productsClient,
                Clock.systemUTC());
    }

    /**
     * The exact single-order READ, contracted by
     * {@code docs/vendor/cafe24-admin-api/get-orders-order-id.md} and scoped by the
     * {@code mall.read_order} grant the ORDER_SUMMARY routine already holds.
     *
     * <p>It is a bean here, and not a component, so that it exists exactly when the connector does.
     * Nothing schedules it: it is reached only when an inquiry that NAMES an order is opened or
     * drafted — one order, one request, no window.
     */
    @Bean
    Cafe24ExactOrderReader cafe24ExactOrderReader(Cafe24Authorizer authorizer,
                                                  Cafe24OrdersClient ordersClient) {
        return new Cafe24ExactOrderReader(authorizer, ordersClient, Clock.systemUTC());
    }

    /**
     * The Cafe24 answer-semantics probe — five (at most seven) read-only requests that decide which
     * resource holds a seller's answer on this mall's inquiry board. Triple-gated: this whole
     * configuration needs the connector flag, this bean needs
     * {@code sellerops.connector.cafe24.diagnostic.answer-semantics.enabled=true}, and even then the
     * runner is inert until an account id and a target article number are configured. Not wired into
     * the scheduler or any collection path; it writes nothing anywhere.
     */
    @Bean
    Cafe24AnswerSemanticProbe cafe24AnswerSemanticProbe(Cafe24HttpClient http) {
        return new Cafe24AnswerSemanticProbe(http);
    }

    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.diagnostic.answer-semantics.enabled",
            havingValue = "true")
    Cafe24AnswerSemanticProbeRunner cafe24AnswerSemanticProbeRunner(
            Cafe24Authorizer authorizer, Cafe24AnswerSemanticProbe probe,
            SellerAccountRepository accounts,
            @Value("${sellerops.connector.cafe24.diagnostic.answer-semantics.account-id:}") String accountId,
            @Value("${sellerops.connector.cafe24.diagnostic.answer-semantics.board-no:6}") int boardNo,
            @Value("${sellerops.connector.cafe24.diagnostic.answer-semantics.target-article-no:0}") long target,
            @Value("${sellerops.connector.cafe24.diagnostic.answer-semantics.processing-control-no:0}") long processing,
            @Value("${sellerops.connector.cafe24.diagnostic.answer-semantics.unanswered-control-no:0}") long unanswered,
            @Value("${sellerops.connector.cafe24.diagnostic.answer-semantics.target-date:}") String targetDate,
            @Value("${sellerops.connector.cafe24.diagnostic.answer-semantics.window-days:7}") int windowDays) {
        return new Cafe24AnswerSemanticProbeRunner(authorizer, probe, accounts, accountId, boardNo,
                target, processing, unanswered, targetDate, windowDays);
    }

    /**
     * The bounded thread reclassification — an exact-id re-read of the rows the seller is currently
     * shown as unanswered, to record the thread role the connector had been discarding. Gated by the
     * connector flag, its own flag, a configured account, and a {@code dry-run} that defaults ON.
     * Nothing schedules it and no HTTP surface reaches it.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.diagnostic.thread-reclassify.enabled",
            havingValue = "true")
    Cafe24ThreadReclassifier cafe24ThreadReclassifier(Cafe24BoardArticlesClient articlesClient,
                                                      InquiryRepository inquiries,
                                                      InquiryWorkItemWriter workItems) {
        return new Cafe24ThreadReclassifier(articlesClient, inquiries, workItems);
    }

    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.diagnostic.thread-reclassify.enabled",
            havingValue = "true")
    Cafe24ThreadReclassificationRunner cafe24ThreadReclassificationRunner(
            Cafe24Authorizer authorizer, Cafe24ThreadReclassifier reclassifier,
            SellerAccountRepository accounts, InquiryRepository inquiries,
            @Value("${sellerops.connector.cafe24.diagnostic.thread-reclassify.account-id:}") String accountId,
            @Value("${sellerops.connector.cafe24.diagnostic.thread-reclassify.board-no:6}") int boardNo,
            @Value("${sellerops.connector.cafe24.diagnostic.thread-reclassify.batch-size:20}") int batchSize,
            @Value("${sellerops.connector.cafe24.diagnostic.thread-reclassify.max-requests:6}") int maxRequests,
            @Value("${sellerops.connector.cafe24.diagnostic.thread-reclassify.dry-run:true}") boolean dryRun) {
        return new Cafe24ThreadReclassificationRunner(authorizer, reclassifier, accounts, inquiries,
                accountId, boardNo, batchSize, maxRequests, dryRun);
    }

    /**
     * The reply-actor observation — a bounded, read-only look at seller answers this mall already
     * has, to decide what a SellerOps-written reply would have to carry in {@code writer},
     * {@code member_id}, {@code client_ip} and {@code title}. Triple-gated (connector flag, its own
     * flag, a configured account) and capped in requests. It writes nothing anywhere; its targets are
     * rows a previous approved READ already proved, not a search.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.diagnostic.reply-actor.enabled",
            havingValue = "true")
    Cafe24ReplyActorProbe cafe24ReplyActorProbe(Cafe24HttpClient http) {
        return new Cafe24ReplyActorProbe(http);
    }

    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.diagnostic.reply-actor.enabled",
            havingValue = "true")
    Cafe24ReplyActorProbeRunner cafe24ReplyActorProbeRunner(
            Cafe24Authorizer authorizer, Cafe24ReplyActorProbe probe,
            SellerAccountRepository accounts, InquiryRepository inquiries,
            @Value("${sellerops.connector.cafe24.diagnostic.reply-actor.account-id:}") String accountId,
            @Value("${sellerops.connector.cafe24.diagnostic.reply-actor.board-no:6}") int boardNo,
            @Value("${sellerops.connector.cafe24.diagnostic.reply-actor.batch-size:25}") int batchSize,
            @Value("${sellerops.connector.cafe24.diagnostic.reply-actor.max-requests:6}") int maxRequests) {
        return new Cafe24ReplyActorProbeRunner(authorizer, probe, accounts, inquiries, accountId,
                boardNo, batchSize, maxRequests);
    }

    /**
     * The shop-scope observation — one bounded, read-only LIST call that answers where an article
     * actually lives. It exists because the create contract's body names {@code shop_no} and this
     * deployment had no observed value for it; two live POSTs omitted the field rather than assert
     * one. Gated by the connector flag, its own flag, a configured account and an explicit article
     * list, and capped at a single request. It writes nothing anywhere.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.diagnostic.shop-scope.enabled",
            havingValue = "true")
    Cafe24ShopScopeProbe cafe24ShopScopeProbe(Cafe24HttpClient http) {
        return new Cafe24ShopScopeProbe(http);
    }

    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.diagnostic.shop-scope.enabled",
            havingValue = "true")
    Cafe24ShopScopeProbeRunner cafe24ShopScopeProbeRunner(
            Cafe24Authorizer authorizer, Cafe24ShopScopeProbe probe,
            SellerAccountRepository accounts,
            @Value("${sellerops.connector.cafe24.diagnostic.shop-scope.account-id:}") String accountId,
            @Value("${sellerops.connector.cafe24.diagnostic.shop-scope.board-no:6}") int boardNo,
            @Value("${sellerops.connector.cafe24.diagnostic.shop-scope.article-nos:}") String articleNos) {
        return new Cafe24ShopScopeProbeRunner(authorizer, probe, accounts, accountId, boardNo,
                articleNos);
    }

    /**
     * The offline thread repair — replays the observation a bounded live READ already produced onto
     * exactly the rows it named. <b>It makes no marketplace call</b>, which is why it takes no
     * authorizer and no client. Gated by the connector flag, its own flag, a configured account, a
     * manifest whose hash matches, and a {@code dry-run} that defaults ON.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.diagnostic.thread-repair.enabled",
            havingValue = "true")
    Cafe24ThreadRepair cafe24ThreadRepair(InquiryRepository inquiries,
                                          InquiryWorkItemRepository workItems,
                                          InquiryWorkItemAuditRepository audits,
                                          ChannelRepository channels,
                                          InquiryOperationalStateProjector projector,
                                          PlatformTransactionManager txManager) {
        return new Cafe24ThreadRepair(inquiries, workItems, audits, channels, projector, txManager);
    }

    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.diagnostic.thread-repair.enabled",
            havingValue = "true")
    Cafe24ThreadRepairRunner cafe24ThreadRepairRunner(
            Cafe24ThreadRepair repair, SellerAccountRepository accounts,
            @Value("${sellerops.connector.cafe24.diagnostic.thread-repair.account-id:}") String accountId,
            @Value("${sellerops.connector.cafe24.diagnostic.thread-repair.board-no:6}") int boardNo,
            @Value("${sellerops.connector.cafe24.diagnostic.thread-repair.manifest:}") String manifest,
            @Value("${sellerops.connector.cafe24.diagnostic.thread-repair.expected-hash:}") String expectedHash,
            @Value("${sellerops.connector.cafe24.diagnostic.thread-repair.dry-run:true}") boolean dryRun) {
        return new Cafe24ThreadRepairRunner(repair, accounts, accountId, boardNo, manifest,
                expectedHash, dryRun);
    }

    // Board Discovery (community read) infrastructure — wired behind the same
    // flag, CONFIRMED by a supervised live /boards run. Not part of the
    // DataType/scheduling backbone, so no runtime path reaches these by default.
    @Bean
    Cafe24BoardsClient cafe24BoardsClient(Cafe24HttpClient http) {
        return new Cafe24BoardsClient(http);
    }

    @Bean
    Cafe24BoardClassifier cafe24BoardClassifier() {
        return new Cafe24BoardClassifier();
    }

    @Bean
    Cafe24BoardDiscovery cafe24BoardDiscovery(Cafe24BoardsClient boardsClient,
                                              Cafe24BoardClassifier classifier) {
        return new Cafe24BoardDiscovery(boardsClient, classifier);
    }

    /**
     * Committed live-proof diagnostic — refresh + rotation write-back (via the
     * shared {@link Cafe24Authorizer}) and one read-only {@code /boards}
     * discovery. Double-gated: this whole configuration requires
     * {@code cafe24.enabled=true}, and this bean additionally requires
     * {@code cafe24.diagnostic.boards.enabled=true}, so it never exists on a
     * normal bootRun. Even then it acts only when {@code ...account-id} is set.
     * Not wired into the scheduler or any collection path.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.diagnostic.boards.enabled",
            havingValue = "true")
    Cafe24BoardDiagnosticRunner cafe24BoardDiagnosticRunner(
            Cafe24Authorizer authorizer, Cafe24BoardDiscovery discovery,
            SellerAccountRepository accounts, ConnectorCredentialRepository credentials,
            @Value("${sellerops.connector.cafe24.diagnostic.boards.account-id:}") String accountId) {
        return new Cafe24BoardDiagnosticRunner(authorizer, discovery, accounts, credentials, accountId);
    }
}
