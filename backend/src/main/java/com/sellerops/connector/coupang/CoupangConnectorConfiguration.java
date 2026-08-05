package com.sellerops.connector.coupang;

import com.sellerops.credential.CredentialVault;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the real Coupang connector strictly behind the feature flag. With
 * {@code sellerops.connector.coupang.enabled=false} (the default) none of these beans exist:
 * the registry sees only the mock connector for COUPANG and runtime behavior is byte-identical
 * to before. Flipping the flag is a deliberate operator act — and even then a live call needs a
 * valid stored credential AND the deployment's egress IP registered in the seller's Coupang app.
 *
 * <p>The deployment-global setup endpoint ({@code CoupangSetupController}) and the account
 * connection lifecycle ({@code CoupangConnectionLifecycle}) are {@code @Component}s that exist
 * regardless of this flag — both are read-only / no-op until a real Coupang account is present,
 * so they are safe to always expose.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.connector.coupang.enabled", havingValue = "true")
public class CoupangConnectorConfiguration {

    @Bean
    CoupangHttpClient coupangHttpClient() {
        return new JdkCoupangHttpClient();
    }

    @Bean
    CoupangSigner coupangSigner() {
        return new CoupangSigner(Clock.systemUTC());
    }

    @Bean
    CoupangOrdersClient coupangOrdersClient(
            CoupangHttpClient http, CoupangSigner signer,
            @Value("${sellerops.connector.coupang.base-url:https://api-gateway.coupang.com}") String baseUrl) {
        return new CoupangOrdersClient(http, signer, Clock.systemUTC(), baseUrl);
    }

    @Bean
    CoupangApiConnector coupangApiConnector(CoupangOrdersClient ordersClient, CredentialVault vault) {
        return new CoupangApiConnector(ordersClient, vault);
    }
}
