package com.sellerops.connector.coupang;

import com.sellerops.credential.CredentialVault;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the Coupang connector strictly behind the feature flag. With
 * {@code sellerops.connector.coupang.enabled=false} (the default) none of these
 * beans exist: the registry sees only the mock connector for COUPANG and
 * runtime behavior is byte-identical to before. Flipping the flag is a
 * deliberate operator act, and even then nothing collects — the Phase 3D-2
 * skeleton advertises no collectable data type.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.connector.coupang.enabled", havingValue = "true")
public class CoupangConnectorConfiguration {

    @Bean
    CoupangHttpClient coupangHttpClient() {
        return new JdkCoupangHttpClient();
    }

    @Bean
    CoupangApiConnector coupangApiConnector(CoupangHttpClient http, CredentialVault vault) {
        return new CoupangApiConnector(http, vault);
    }
}
