package com.sellerops.connector.cafe24;

import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

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
    Cafe24ApiConnector cafe24ApiConnector(
            Cafe24Authorizer authorizer,
            Cafe24OrdersClient ordersClient, Cafe24BoardArticlesClient articlesClient) {
        // System UTC clock; the connector applies the explicit KST zone for date math.
        return new Cafe24ApiConnector(authorizer, ordersClient, articlesClient, Clock.systemUTC());
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
