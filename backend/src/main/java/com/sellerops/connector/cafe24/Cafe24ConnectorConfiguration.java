package com.sellerops.connector.cafe24;

import com.sellerops.credential.CredentialVault;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the Cafe24 connector strictly behind the feature flag. With
 * {@code sellerops.connector.cafe24.enabled=false} (the default) none of these
 * beans exist: the registry sees only the mock connector for CAFE24 and
 * runtime behavior is byte-identical to before. Flipping the flag is a
 * deliberate operator act, and even then nothing collects — the Phase 3D-3
 * skeleton advertises no collectable data type.
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
    Cafe24ApiConnector cafe24ApiConnector(Cafe24TokenClient tokenClient, CredentialVault vault) {
        return new Cafe24ApiConnector(tokenClient, vault);
    }
}
