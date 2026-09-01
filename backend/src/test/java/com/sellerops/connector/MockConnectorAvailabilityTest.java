package com.sellerops.connector;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * <b>The offline fixture is opt-in, in both of the places it could be reached</b> — Pilot Connection
 * &amp; External Proof Gate v1 §3.
 *
 * <p>Two fences, deliberately independent, because they fail in different ways. The first is the
 * bean's existence: an absent bean cannot be resolved by any code path, including one written later
 * by someone who never read {@link ConnectorRegistry}. The second is resolution: even with a generic
 * connector bean present, a channel whose own connector is off resolves to nothing rather than to
 * whatever happens to declare no channel.
 *
 * <p>The last test reads {@code application.yml} as text. Defaults are not observable from a unit
 * test of the classes themselves — they live in the string inside {@code @Value} and in the YAML —
 * and "OFF unless asked" is the entire claim of this package's §3.
 */
class MockConnectorAvailabilityTest {

    @Test
    void theMockBeanDoesNotExistUnlessTheDeploymentAsksForIt() {
        new ApplicationContextRunner()
                .withUserConfiguration(MockApiConnector.class)
                .run(ctx -> assertThat(ctx).doesNotHaveBean(MockApiConnector.class));
    }

    @Test
    void anExplicitDevOrTestDeploymentGetsIt() {
        new ApplicationContextRunner()
                .withUserConfiguration(MockApiConnector.class)
                .withPropertyValues("sellerops.connector.mock.enabled=true")
                .run(ctx -> assertThat(ctx).hasSingleBean(MockApiConnector.class));
    }

    @Test
    void resolutionFallsBackToNothingByDefault_evenWithAGenericConnectorPresent() {
        ConnectorRegistry production = new ConnectorRegistry(List.of(new MockApiConnector()), false);

        assertThat(production.resolvePullConnector("CAFE24")).isEmpty();
        assertThat(production.resolvePullConnector("NAVER")).isEmpty();
        assertThat(production.resolvePullConnector("COUPANG")).isEmpty();
    }

    @Test
    void aChannelsOwnConnectorIsNeverHiddenByTheFence() {
        PullConnector cafe24 = new PullConnector() {
            @Override
            public String kind() {
                return "STUB_CAFE24";
            }

            @Override
            public java.util.Set<String> dedicatedChannels() {
                return java.util.Set.of("CAFE24");
            }

            @Override
            public ConnectorCapabilities capabilities(String channelCode) {
                return new ConnectorCapabilities("API", java.util.Set.of(), java.util.Map.of(), "stub");
            }

            @Override
            public FetchPage fetch(FetchRequest request) {
                throw new AssertionError("resolution must never fetch");
            }
        };
        ConnectorRegistry production = new ConnectorRegistry(List.of(new MockApiConnector(), cafe24), false);

        assertThat(production.resolvePullConnector("CAFE24")).containsSame(cafe24);
        assertThat(production.resolvePullConnector("NAVER")).isEmpty();
    }

    @Test
    void bothSwitchesAreOffInTheShippedConfiguration() throws Exception {
        String yml = Files.readString(Path.of("src/main/resources/application.yml"));

        assertThat(yml)
                .as("the fixture connector's bean")
                .contains("enabled: ${SELLEROPS_CONNECTOR_MOCK_ENABLED:false}")
                .as("the generic-connector fallback")
                .contains("enabled: ${SELLEROPS_CONNECTOR_MOCK_FALLBACK_ENABLED:false}");
    }
}
