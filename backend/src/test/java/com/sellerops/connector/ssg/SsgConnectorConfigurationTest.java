package com.sellerops.connector.ssg;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.cafe24.Cafe24ApiConnector;
import com.sellerops.connector.cafe24.Cafe24ConnectorConfiguration;
import com.sellerops.connector.coupang.CoupangApiConnector;
import com.sellerops.connector.coupang.CoupangConnectorConfiguration;
import com.sellerops.connector.elevenst.ElevenstApiConnector;
import com.sellerops.connector.elevenst.ElevenstConnectorConfiguration;
import com.sellerops.connector.esm.EsmApiConnector;
import com.sellerops.connector.esm.EsmConnectorConfiguration;
import com.sellerops.connector.naver.NaverApiConnector;
import com.sellerops.connector.naver.NaverConnectorConfiguration;
import com.sellerops.credential.CredentialVault;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * Phase 3D-6: the feature flag is the bean's existence — and, uniquely in
 * Phase 3D, flag-on additionally requires an explicit https base-url because
 * the SSG production host is not publicly printed (startup fails closed
 * without one). With all six real connector flags on, each dedicated
 * connector serves exactly its own channel.
 */
class SsgConnectorConfigurationTest {

    private static final String BASE_URL = "https://ssg-host-from-key-issuance.example";

    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
                .withUserConfiguration(SsgConnectorConfiguration.class)
                // The connector only needs a vault reference at fetch time; a
                // repository-less instance satisfies wiring without a database.
                .withBean(CredentialVault.class,
                        () -> new CredentialVault(null, new ObjectMapper(), "", "test"));
    }

    @Test
    void ssgBeansAbsentByDefault() {
        runner().run(ctx -> {
            assertThat(ctx).doesNotHaveBean(SsgApiConnector.class);
            assertThat(ctx).doesNotHaveBean(SsgHttpClient.class);
        });
    }

    @Test
    void ssgBeansAbsentWhenFlagExplicitlyFalse() {
        runner().withPropertyValues("sellerops.connector.ssg.enabled=false")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(SsgApiConnector.class));
    }

    @Test
    void flagOnWithoutBaseUrlFailsStartupClosed() {
        // The SSG production host is not publicly printed in the official docs
        // — there is no default, so enabling the connector without an explicit
        // base-url must refuse to start, with a message that says why.
        runner().withPropertyValues("sellerops.connector.ssg.enabled=true")
                .run(ctx -> {
                    assertThat(ctx).hasFailed();
                    assertThat(ctx.getStartupFailure())
                            .rootCause()
                            .hasMessageContaining("base-url")
                            .hasMessageContaining("공개되어 있지 않아");
                });
    }

    @Test
    void flagOnWithPlaintextBaseUrlFailsStartupClosed() {
        // The static vendor key travels in the Authorization header — a
        // plaintext host must be refused even if explicitly configured.
        runner().withPropertyValues(
                        "sellerops.connector.ssg.enabled=true",
                        "sellerops.connector.ssg.base-url=http://ssg-host.example")
                .run(ctx -> {
                    assertThat(ctx).hasFailed();
                    assertThat(ctx.getStartupFailure())
                            .rootCause()
                            .hasMessageContaining("https");
                });
    }

    @Test
    void ssgBeansPresentWhenFlagEnabledWithExplicitBaseUrl() {
        runner().withPropertyValues(
                        "sellerops.connector.ssg.enabled=true",
                        "sellerops.connector.ssg.base-url=" + BASE_URL)
                .run(ctx -> {
                    assertThat(ctx).hasSingleBean(SsgApiConnector.class);
                    assertThat(ctx.getBean(SsgHttpClient.class)).isInstanceOf(JdkSsgHttpClient.class);
                });
    }

    /** The production bean graph (registry + connectors), not a hand-built registry. */
    private ApplicationContextRunner registryGraph() {
        return runner()
                .withBean(MockApiConnector.class)
                .withBean(ConnectorRegistry.class);
    }

    @Test
    void flagOffBeanGraphResolvesSsgToMock() {
        registryGraph().run(ctx -> {
            ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
            assertThat(registry.resolvePullConnector("SSG")).get().isInstanceOf(MockApiConnector.class);
            assertThat(registry.resolvePullConnector("NAVER")).get().isInstanceOf(MockApiConnector.class);
        });
    }

    @Test
    void flagOnBeanGraphResolvesSsgToSsgConnectorAndOthersToMock() {
        registryGraph().withPropertyValues(
                        "sellerops.connector.ssg.enabled=true",
                        "sellerops.connector.ssg.base-url=" + BASE_URL)
                .run(ctx -> {
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("SSG"))
                            .get().isInstanceOf(SsgApiConnector.class);
                    // Dedication is SSG-only: every other channel keeps the mock.
                    for (String other : new String[] {"NAVER", "COUPANG", "CAFE24", "GMARKET", "ELEVENST"}) {
                        assertThat(registry.resolvePullConnector(other))
                                .as("channel %s must keep resolving to the mock", other)
                                .get().isInstanceOf(MockApiConnector.class);
                    }
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }

    @Test
    void allSixFlagsOnRouteEachChannelToItsOwnDedicatedConnector() {
        registryGraph()
                .withUserConfiguration(NaverConnectorConfiguration.class,
                        CoupangConnectorConfiguration.class, Cafe24ConnectorConfiguration.class,
                        EsmConnectorConfiguration.class, ElevenstConnectorConfiguration.class)
                .withPropertyValues(
                        "sellerops.connector.ssg.enabled=true",
                        "sellerops.connector.ssg.base-url=" + BASE_URL,
                        "sellerops.connector.naver.enabled=true",
                        "sellerops.connector.coupang.enabled=true",
                        "sellerops.connector.cafe24.enabled=true",
                        "sellerops.connector.cafe24.api-version=2025-12-01",
                        "sellerops.connector.esm.enabled=true",
                        "sellerops.connector.elevenst.enabled=true")
                .run(ctx -> {
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("SSG"))
                            .get().isInstanceOf(SsgApiConnector.class);
                    assertThat(registry.resolvePullConnector("NAVER"))
                            .get().isInstanceOf(NaverApiConnector.class);
                    assertThat(registry.resolvePullConnector("COUPANG"))
                            .get().isInstanceOf(CoupangApiConnector.class);
                    assertThat(registry.resolvePullConnector("CAFE24"))
                            .get().isInstanceOf(Cafe24ApiConnector.class);
                    assertThat(registry.resolvePullConnector("GMARKET"))
                            .get().isInstanceOf(EsmApiConnector.class);
                    assertThat(registry.resolvePullConnector("ELEVENST"))
                            .get().isInstanceOf(ElevenstApiConnector.class);
                    // Channels with no dedicated connector keep the mock.
                    assertThat(registry.resolvePullConnector("OHOUSE"))
                            .get().isInstanceOf(MockApiConnector.class);
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }
}
