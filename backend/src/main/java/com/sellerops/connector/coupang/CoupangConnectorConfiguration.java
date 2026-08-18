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
            @Value("${sellerops.connector.coupang.base-url:https://api-gateway.coupang.com}") String baseUrl,
            @Value("${sellerops.connector.coupang.live-approval-id:}") String liveApprovalId,
            @Value("${sellerops.self-pilot.read-grant-id:}") String standingReadGrantId) {
        // liveApprovalId arms the backend live-call interlock (CoupangLiveCallGuard). Empty by default →
        // a real-gateway call fails closed; an operator-approved run injects the bootstrapped id. The
        // Self-Pilot standing READ grant is the second key for this READ-only client (never for a write);
        // its shape is validated at boot by SelfPilotProperties, read here as the same property.
        return new CoupangOrdersClient(http, signer, Clock.systemUTC(), baseUrl, liveApprovalId,
                standingReadGrantId);
    }

    @Bean
    CoupangInquiriesClient coupangInquiriesClient(
            CoupangHttpClient http, CoupangSigner signer,
            @Value("${sellerops.connector.coupang.base-url:https://api-gateway.coupang.com}") String baseUrl,
            @Value("${sellerops.connector.coupang.live-approval-id:}") String liveApprovalId,
            @Value("${sellerops.self-pilot.read-grant-id:}") String standingReadGrantId) {
        // Same base URL and same live-call interlock as the order client — one armed approval (or the
        // standing READ grant) covers the account's read-only collection; neither stream can reach a real
        // host without one of them.
        return new CoupangInquiriesClient(http, signer, Clock.systemUTC(), baseUrl, liveApprovalId,
                standingReadGrantId);
    }

    @Bean
    CoupangApiConnector coupangApiConnector(CoupangOrdersClient ordersClient,
                                            CoupangInquiriesClient inquiriesClient,
                                            CredentialVault vault) {
        return new CoupangApiConnector(ordersClient, inquiriesClient, vault);
    }
}
