package com.sellerops.connector.esm;

import com.sellerops.credential.CredentialVault;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the ESM (G마켓/옥션) connector strictly behind the feature flag. With
 * {@code sellerops.connector.esm.enabled=false} (the default) none of these
 * beans exist: the registry sees only the mock connector for GMARKET and
 * runtime behavior is byte-identical to before. Flipping the flag is a
 * deliberate operator act, and even then nothing collects — the Phase 3D-4
 * skeleton advertises no collectable data type.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.connector.esm.enabled", havingValue = "true")
public class EsmConnectorConfiguration {

    @Bean
    EsmHttpClient esmHttpClient() {
        return new JdkEsmHttpClient();
    }

    @Bean
    EsmApiConnector esmApiConnector(EsmHttpClient http, CredentialVault vault) {
        return new EsmApiConnector(http, vault);
    }
}
