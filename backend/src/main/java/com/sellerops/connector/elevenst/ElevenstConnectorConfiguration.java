package com.sellerops.connector.elevenst;

import com.sellerops.credential.CredentialVault;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the 11st (11번가) connector strictly behind the feature flag. With
 * {@code sellerops.connector.elevenst.enabled=false} (the default) none of
 * these beans exist: the registry sees only the mock connector for ELEVENST
 * and runtime behavior is byte-identical to before. Flipping the flag is a
 * deliberate operator act, and even then nothing collects — the Phase 3D-5
 * skeleton advertises no collectable data type.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.connector.elevenst.enabled", havingValue = "true")
public class ElevenstConnectorConfiguration {

    @Bean
    ElevenstHttpClient elevenstHttpClient() {
        return new JdkElevenstHttpClient();
    }

    @Bean
    ElevenstApiConnector elevenstApiConnector(ElevenstHttpClient http, CredentialVault vault) {
        return new ElevenstApiConnector(http, vault);
    }
}
