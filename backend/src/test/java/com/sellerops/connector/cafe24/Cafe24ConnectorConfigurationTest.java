package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.coupang.CoupangApiConnector;
import com.sellerops.connector.coupang.CoupangConnectorConfiguration;
import com.sellerops.connector.naver.NaverApiConnector;
import com.sellerops.connector.naver.NaverConnectorConfiguration;
import com.sellerops.credential.CredentialVault;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * Phase 3D-3: the feature flag is the bean's existence. Off (default) — no
 * Cafe24 beans at all, so runtime behavior cannot differ from before. On —
 * the connector is wired and dedicated to CAFE24 only; with all three real
 * connector flags on, each dedicated connector serves exactly its own channel.
 */
class Cafe24ConnectorConfigurationTest {

    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
                .withUserConfiguration(Cafe24ConnectorConfiguration.class)
                // The connector only needs a vault reference at fetch time; a
                // repository-less instance satisfies wiring without a database.
                .withBean(CredentialVault.class,
                        () -> new CredentialVault(null, new ObjectMapper(), "", "test"))
                // A pinned Admin-API version is required once the connector is enabled
                // (blank fails closed — see apiVersionMissingFailsClosedWhenEnabled).
                .withPropertyValues("sellerops.connector.cafe24.api-version=2025-12-01");
    }

    @Test
    void apiVersionMissingFailsClosedWhenEnabled() {
        new ApplicationContextRunner()
                .withUserConfiguration(Cafe24ConnectorConfiguration.class)
                .withBean(CredentialVault.class,
                        () -> new CredentialVault(null, new ObjectMapper(), "", "test"))
                .withPropertyValues("sellerops.connector.cafe24.enabled=true")
                .run(ctx -> {
                    assertThat(ctx).hasFailed();
                    assertThat(ctx.getStartupFailure()).hasMessageContaining("API 버전");
                });
    }

    @Test
    void cafe24BeansAbsentByDefault() {
        runner().run(ctx -> {
            assertThat(ctx).doesNotHaveBean(Cafe24ApiConnector.class);
            assertThat(ctx).doesNotHaveBean(Cafe24TokenClient.class);
            assertThat(ctx).doesNotHaveBean(Cafe24HttpClient.class);
        });
    }

    @Test
    void cafe24BeansAbsentWhenFlagExplicitlyFalse() {
        runner().withPropertyValues("sellerops.connector.cafe24.enabled=false")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(Cafe24ApiConnector.class));
    }

    @Test
    void cafe24BeansPresentWhenFlagEnabled() {
        runner().withPropertyValues("sellerops.connector.cafe24.enabled=true")
                .run(ctx -> {
                    assertThat(ctx).hasSingleBean(Cafe24ApiConnector.class);
                    assertThat(ctx).hasSingleBean(Cafe24TokenClient.class);
                    assertThat(ctx.getBean(Cafe24HttpClient.class)).isInstanceOf(JdkCafe24HttpClient.class);
                });
    }

    /** The production bean graph (registry + connectors), not a hand-built registry. */
    private ApplicationContextRunner registryGraph() {
        return runner()
                .withBean(MockApiConnector.class)
                .withBean(ConnectorRegistry.class);
    }

    @Test
    void flagOffBeanGraphResolvesCafe24ToMock() {
        registryGraph().run(ctx -> {
            ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
            assertThat(registry.resolvePullConnector("CAFE24")).get().isInstanceOf(MockApiConnector.class);
            assertThat(registry.resolvePullConnector("NAVER")).get().isInstanceOf(MockApiConnector.class);
            assertThat(registry.resolvePullConnector("COUPANG")).get().isInstanceOf(MockApiConnector.class);
        });
    }

    @Test
    void flagOnBeanGraphResolvesCafe24ToCafe24ConnectorAndOthersToMock() {
        registryGraph().withPropertyValues("sellerops.connector.cafe24.enabled=true")
                .run(ctx -> {
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("CAFE24"))
                            .get().isInstanceOf(Cafe24ApiConnector.class);
                    // Dedication is CAFE24-only: every other channel keeps the mock.
                    for (String other : new String[] {"NAVER", "COUPANG", "GMARKET", "ELEVENST", "SSG"}) {
                        assertThat(registry.resolvePullConnector(other))
                                .as("channel %s must keep resolving to the mock", other)
                                .get().isInstanceOf(MockApiConnector.class);
                    }
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }

    @Test
    void allThreeFlagsOnRouteEachChannelToItsOwnDedicatedConnector() {
        registryGraph()
                .withUserConfiguration(NaverConnectorConfiguration.class, CoupangConnectorConfiguration.class)
                .withPropertyValues(
                        "sellerops.connector.cafe24.enabled=true",
                        "sellerops.connector.naver.enabled=true",
                        "sellerops.connector.coupang.enabled=true")
                .run(ctx -> {
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("CAFE24"))
                            .get().isInstanceOf(Cafe24ApiConnector.class);
                    assertThat(registry.resolvePullConnector("NAVER"))
                            .get().isInstanceOf(NaverApiConnector.class);
                    assertThat(registry.resolvePullConnector("COUPANG"))
                            .get().isInstanceOf(CoupangApiConnector.class);
                    assertThat(registry.resolvePullConnector("GMARKET"))
                            .get().isInstanceOf(MockApiConnector.class);
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }
}
