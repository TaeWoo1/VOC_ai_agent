package com.sellerops.connector.elevenst;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.cafe24.Cafe24ApiConnector;
import com.sellerops.connector.cafe24.Cafe24ConnectorConfiguration;
import com.sellerops.connector.coupang.CoupangApiConnector;
import com.sellerops.connector.coupang.CoupangConnectorConfiguration;
import com.sellerops.connector.esm.EsmApiConnector;
import com.sellerops.connector.esm.EsmConnectorConfiguration;
import com.sellerops.connector.naver.NaverApiConnector;
import com.sellerops.connector.naver.NaverConnectorConfiguration;
import com.sellerops.credential.CredentialVault;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * Phase 3D-5: the feature flag is the bean's existence. Off (default) — no
 * 11st beans at all, so runtime behavior cannot differ from before. On — the
 * connector is wired and dedicated to ELEVENST only; with all five real
 * connector flags on, each dedicated connector serves exactly its own channel.
 */
class ElevenstConnectorConfigurationTest {

    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
                .withUserConfiguration(ElevenstConnectorConfiguration.class)
                // The connector only needs a vault reference at fetch time; a
                // repository-less instance satisfies wiring without a database.
                .withBean(CredentialVault.class,
                        () -> new CredentialVault(null, new ObjectMapper(), "", "test"));
    }

    @Test
    void elevenstBeansAbsentByDefault() {
        runner().run(ctx -> {
            assertThat(ctx).doesNotHaveBean(ElevenstApiConnector.class);
            assertThat(ctx).doesNotHaveBean(ElevenstHttpClient.class);
        });
    }

    @Test
    void elevenstBeansAbsentWhenFlagExplicitlyFalse() {
        runner().withPropertyValues("sellerops.connector.elevenst.enabled=false")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(ElevenstApiConnector.class));
    }

    @Test
    void elevenstBeansPresentWhenFlagEnabled() {
        runner().withPropertyValues("sellerops.connector.elevenst.enabled=true")
                .run(ctx -> {
                    assertThat(ctx).hasSingleBean(ElevenstApiConnector.class);
                    assertThat(ctx.getBean(ElevenstHttpClient.class))
                            .isInstanceOf(JdkElevenstHttpClient.class);
                });
    }

    /** The production bean graph (registry + connectors), not a hand-built registry. */
    private ApplicationContextRunner registryGraph() {
        return runner()
                .withBean(MockApiConnector.class)
                .withBean(ConnectorRegistry.class);
    }

    @Test
    void flagOffBeanGraphResolvesElevenstToMock() {
        registryGraph().run(ctx -> {
            ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
            assertThat(registry.resolvePullConnector("ELEVENST")).get().isInstanceOf(MockApiConnector.class);
            assertThat(registry.resolvePullConnector("NAVER")).get().isInstanceOf(MockApiConnector.class);
        });
    }

    @Test
    void flagOnBeanGraphResolvesElevenstToElevenstConnectorAndOthersToMock() {
        registryGraph().withPropertyValues("sellerops.connector.elevenst.enabled=true")
                .run(ctx -> {
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("ELEVENST"))
                            .get().isInstanceOf(ElevenstApiConnector.class);
                    // Dedication is ELEVENST-only: every other channel keeps the mock.
                    for (String other : new String[] {"NAVER", "COUPANG", "CAFE24", "GMARKET", "SSG"}) {
                        assertThat(registry.resolvePullConnector(other))
                                .as("channel %s must keep resolving to the mock", other)
                                .get().isInstanceOf(MockApiConnector.class);
                    }
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }

    @Test
    void allFiveFlagsOnRouteEachChannelToItsOwnDedicatedConnector() {
        registryGraph()
                .withUserConfiguration(NaverConnectorConfiguration.class,
                        CoupangConnectorConfiguration.class, Cafe24ConnectorConfiguration.class,
                        EsmConnectorConfiguration.class)
                .withPropertyValues(
                        "sellerops.connector.elevenst.enabled=true",
                        "sellerops.connector.naver.enabled=true",
                        "sellerops.connector.coupang.enabled=true",
                        "sellerops.connector.cafe24.enabled=true",
                        "sellerops.connector.cafe24.api-version=2025-12-01",
                        "sellerops.connector.esm.enabled=true")
                .run(ctx -> {
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("ELEVENST"))
                            .get().isInstanceOf(ElevenstApiConnector.class);
                    assertThat(registry.resolvePullConnector("NAVER"))
                            .get().isInstanceOf(NaverApiConnector.class);
                    assertThat(registry.resolvePullConnector("COUPANG"))
                            .get().isInstanceOf(CoupangApiConnector.class);
                    assertThat(registry.resolvePullConnector("CAFE24"))
                            .get().isInstanceOf(Cafe24ApiConnector.class);
                    assertThat(registry.resolvePullConnector("GMARKET"))
                            .get().isInstanceOf(EsmApiConnector.class);
                    // Channels with no dedicated connector keep the mock.
                    assertThat(registry.resolvePullConnector("SSG"))
                            .get().isInstanceOf(MockApiConnector.class);
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }
}
