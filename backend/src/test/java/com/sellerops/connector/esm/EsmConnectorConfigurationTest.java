package com.sellerops.connector.esm;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.cafe24.Cafe24ApiConnector;
import com.sellerops.connector.cafe24.Cafe24ConnectorConfiguration;
import com.sellerops.connector.coupang.CoupangApiConnector;
import com.sellerops.connector.coupang.CoupangConnectorConfiguration;
import com.sellerops.connector.naver.NaverApiConnector;
import com.sellerops.connector.naver.NaverConnectorConfiguration;
import com.sellerops.credential.CredentialVault;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * Phase 3D-4: the feature flag is the bean's existence. Off (default) — no
 * ESM beans at all, so runtime behavior cannot differ from before. On — the
 * connector is wired and dedicated to GMARKET only; with all four real
 * connector flags on, each dedicated connector serves exactly its own channel.
 */
class EsmConnectorConfigurationTest {

    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
                .withUserConfiguration(EsmConnectorConfiguration.class)
                // The connector only needs a vault reference at fetch time; a
                // repository-less instance satisfies wiring without a database.
                .withBean(CredentialVault.class,
                        () -> new CredentialVault(null, new ObjectMapper(), "", "test"));
    }

    @Test
    void esmBeansAbsentByDefault() {
        runner().run(ctx -> {
            assertThat(ctx).doesNotHaveBean(EsmApiConnector.class);
            assertThat(ctx).doesNotHaveBean(EsmHttpClient.class);
        });
    }

    @Test
    void esmBeansAbsentWhenFlagExplicitlyFalse() {
        runner().withPropertyValues("sellerops.connector.esm.enabled=false")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(EsmApiConnector.class));
    }

    @Test
    void esmBeansPresentWhenFlagEnabled() {
        runner().withPropertyValues("sellerops.connector.esm.enabled=true")
                .run(ctx -> {
                    assertThat(ctx).hasSingleBean(EsmApiConnector.class);
                    assertThat(ctx.getBean(EsmHttpClient.class)).isInstanceOf(JdkEsmHttpClient.class);
                });
    }

    /** The production bean graph (registry + connectors), not a hand-built registry. */
    private ApplicationContextRunner registryGraph() {
        return runner()
                .withBean(MockApiConnector.class)
                .withBean(ConnectorRegistry.class);
    }

    @Test
    void flagOffBeanGraphResolvesGmarketToMock() {
        registryGraph().run(ctx -> {
            ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
            assertThat(registry.resolvePullConnector("GMARKET")).get().isInstanceOf(MockApiConnector.class);
            assertThat(registry.resolvePullConnector("NAVER")).get().isInstanceOf(MockApiConnector.class);
        });
    }

    @Test
    void flagOnBeanGraphResolvesGmarketToEsmConnectorAndOthersToMock() {
        registryGraph().withPropertyValues("sellerops.connector.esm.enabled=true")
                .run(ctx -> {
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("GMARKET"))
                            .get().isInstanceOf(EsmApiConnector.class);
                    // Dedication is GMARKET-only: every other channel keeps the mock.
                    for (String other : new String[] {"NAVER", "COUPANG", "CAFE24", "ELEVENST", "SSG"}) {
                        assertThat(registry.resolvePullConnector(other))
                                .as("channel %s must keep resolving to the mock", other)
                                .get().isInstanceOf(MockApiConnector.class);
                    }
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }

    @Test
    void allFourFlagsOnRouteEachChannelToItsOwnDedicatedConnector() {
        registryGraph()
                .withUserConfiguration(NaverConnectorConfiguration.class,
                        CoupangConnectorConfiguration.class, Cafe24ConnectorConfiguration.class)
                .withPropertyValues(
                        "sellerops.connector.esm.enabled=true",
                        "sellerops.connector.naver.enabled=true",
                        "sellerops.connector.coupang.enabled=true",
                        "sellerops.connector.cafe24.enabled=true",
                        "sellerops.connector.cafe24.api-version=2025-12-01")
                .run(ctx -> {
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("GMARKET"))
                            .get().isInstanceOf(EsmApiConnector.class);
                    assertThat(registry.resolvePullConnector("NAVER"))
                            .get().isInstanceOf(NaverApiConnector.class);
                    assertThat(registry.resolvePullConnector("COUPANG"))
                            .get().isInstanceOf(CoupangApiConnector.class);
                    assertThat(registry.resolvePullConnector("CAFE24"))
                            .get().isInstanceOf(Cafe24ApiConnector.class);
                    // Channels with no dedicated connector keep the mock.
                    assertThat(registry.resolvePullConnector("ELEVENST"))
                            .get().isInstanceOf(MockApiConnector.class);
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }
}
