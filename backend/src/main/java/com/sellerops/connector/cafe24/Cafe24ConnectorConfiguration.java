package com.sellerops.connector.cafe24;

import com.sellerops.credential.CredentialVault;
import java.time.Clock;
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

    @Bean
    Cafe24HttpClient cafe24HttpClient() {
        return new JdkCafe24HttpClient();
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

    @Bean
    Cafe24ApiConnector cafe24ApiConnector(Cafe24TokenClient tokenClient, CredentialVault vault,
                                          Cafe24OrdersClient ordersClient,
                                          Cafe24BoardArticlesClient articlesClient) {
        // System UTC clock; the connector applies the explicit KST zone for date math.
        return new Cafe24ApiConnector(tokenClient, vault, ordersClient, articlesClient, Clock.systemUTC());
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
}
