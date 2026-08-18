package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.naver.NaverApiConnector;
import com.sellerops.connector.naver.NaverConnectorConfiguration;
import com.sellerops.credential.CredentialVault;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * Phase 3D-2: the feature flag is the bean's existence. Off (default) — no
 * Coupang beans at all, so runtime behavior cannot differ from before. On —
 * the connector is wired and dedicated to COUPANG only; with the Naver flag
 * also on, each dedicated connector serves exactly its own channel.
 */
class CoupangConnectorConfigurationTest {

    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
                .withUserConfiguration(CoupangConnectorConfiguration.class)
                // The connector only needs a vault reference at fetch time; a
                // repository-less instance satisfies wiring without a database.
                .withBean(CredentialVault.class,
                        () -> new CredentialVault(null, new ObjectMapper(), "", "test"));
    }

    @Test
    void coupangBeansAbsentByDefault() {
        runner().run(ctx -> {
            assertThat(ctx).doesNotHaveBean(CoupangApiConnector.class);
            assertThat(ctx).doesNotHaveBean(CoupangHttpClient.class);
        });
    }

    @Test
    void coupangBeansAbsentWhenFlagExplicitlyFalse() {
        runner().withPropertyValues("sellerops.connector.coupang.enabled=false")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(CoupangApiConnector.class));
    }

    @Test
    void coupangBeansPresentWhenFlagEnabled() {
        runner().withPropertyValues("sellerops.connector.coupang.enabled=true")
                .run(ctx -> {
                    assertThat(ctx).hasSingleBean(CoupangApiConnector.class);
                    assertThat(ctx.getBean(CoupangHttpClient.class)).isInstanceOf(JdkCoupangHttpClient.class);
                });
    }

    /**
     * Self-Pilot v1 independent review: a standing READ grant left in the environment while the runtime is
     * OFF must arm nothing — otherwise it is a global read key for every org and every deployment.
     */
    @Test
    void standingReadGrantIsInertUnlessSelfPilotIsEnabled() {
        assertThat(CoupangConnectorConfiguration.effectiveReadGrant(false, "spr-0123456789abcdef")).isEmpty();
        assertThat(CoupangConnectorConfiguration.effectiveReadGrant(true, "spr-0123456789abcdef"))
                .isEqualTo("spr-0123456789abcdef");
        assertThat(CoupangConnectorConfiguration.effectiveReadGrant(true, "")).isEmpty();
    }

    /** The auth verdict type must stay catchable by every existing IllegalStateException handler. */
    @Test
    void connectorAuthExceptionIsAnIllegalStateException() {
        assertThat(new com.sellerops.connector.ConnectorAuthException("쿠팡",
                com.sellerops.connector.ConnectorAuthException.Cause.CREDENTIAL_REJECTED))
                .isInstanceOf(IllegalStateException.class);
    }

    /** The production bean graph (registry + connectors), not a hand-built registry. */
    private ApplicationContextRunner registryGraph() {
        return runner()
                .withBean(MockApiConnector.class)
                .withBean(ConnectorRegistry.class);
    }

    @Test
    void flagOffBeanGraphResolvesCoupangToMock() {
        registryGraph().run(ctx -> {
            ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
            assertThat(registry.resolvePullConnector("COUPANG")).get().isInstanceOf(MockApiConnector.class);
            assertThat(registry.resolvePullConnector("NAVER")).get().isInstanceOf(MockApiConnector.class);
        });
    }

    @Test
    void flagOnBeanGraphResolvesCoupangToCoupangConnectorAndOthersToMock() {
        registryGraph().withPropertyValues("sellerops.connector.coupang.enabled=true")
                .run(ctx -> {
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("COUPANG"))
                            .get().isInstanceOf(CoupangApiConnector.class);
                    // Dedication is COUPANG-only: every other channel keeps the mock.
                    for (String other : new String[] {"NAVER", "GMARKET", "ELEVENST", "CAFE24", "SSG"}) {
                        assertThat(registry.resolvePullConnector(other))
                                .as("channel %s must keep resolving to the mock", other)
                                .get().isInstanceOf(MockApiConnector.class);
                    }
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }

    @Test
    void bothFlagsOnRouteEachChannelToItsOwnDedicatedConnector() {
        registryGraph()
                .withUserConfiguration(NaverConnectorConfiguration.class)
                .withPropertyValues(
                        "sellerops.connector.coupang.enabled=true",
                        "sellerops.connector.naver.enabled=true")
                .run(ctx -> {
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("COUPANG"))
                            .get().isInstanceOf(CoupangApiConnector.class);
                    assertThat(registry.resolvePullConnector("NAVER"))
                            .get().isInstanceOf(NaverApiConnector.class);
                    assertThat(registry.resolvePullConnector("GMARKET"))
                            .get().isInstanceOf(MockApiConnector.class);
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }
}
