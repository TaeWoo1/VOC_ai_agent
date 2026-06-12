package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.credential.CredentialVault;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * Slice 1a: the feature flag is the bean's existence. Off (default) — no Naver
 * beans at all, so runtime behavior cannot differ from Phase 3B. On — the
 * connector and its collaborators are wired.
 */
class NaverConnectorConfigurationTest {

    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
                .withUserConfiguration(NaverConnectorConfiguration.class)
                // The connector only needs a vault reference at fetch time; a
                // repository-less instance satisfies wiring without a database.
                .withBean(CredentialVault.class,
                        () -> new CredentialVault(null, new ObjectMapper(), "", "test"));
    }

    @Test
    void naverBeansAbsentByDefault() {
        runner().run(ctx -> {
            assertThat(ctx).doesNotHaveBean(NaverApiConnector.class);
            assertThat(ctx).doesNotHaveBean(NaverTokenClient.class);
            assertThat(ctx).doesNotHaveBean(NaverHttpClient.class);
        });
    }

    @Test
    void naverBeansAbsentWhenFlagExplicitlyFalse() {
        runner().withPropertyValues("sellerops.connector.naver.enabled=false")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(NaverApiConnector.class));
    }

    @Test
    void naverBeansPresentWhenFlagEnabled() {
        runner().withPropertyValues("sellerops.connector.naver.enabled=true")
                .run(ctx -> {
                    assertThat(ctx).hasSingleBean(NaverApiConnector.class);
                    assertThat(ctx).hasSingleBean(NaverTokenClient.class);
                    assertThat(ctx).hasSingleBean(NaverOrdersClient.class);
                    assertThat(ctx.getBean(NaverHttpClient.class)).isInstanceOf(JdkNaverHttpClient.class);
                });
    }

    @Test
    void nonPositiveDetailBatchSizeFailsStartup() {
        runner().withPropertyValues(
                        "sellerops.connector.naver.enabled=true",
                        "sellerops.connector.naver.order-detail-batch-size=0")
                .run(ctx -> assertThat(ctx).hasFailed());
    }

    @Test
    void detailBatchSizeAboveDefensiveCeilingFailsStartup() {
        // The official per-request maximum is unconfirmed — 300 is the ceiling.
        runner().withPropertyValues(
                        "sellerops.connector.naver.enabled=true",
                        "sellerops.connector.naver.order-detail-batch-size=301")
                .run(ctx -> assertThat(ctx).hasFailed());
    }

    /** The production bean graph (registry + connectors), not a hand-built registry. */
    private ApplicationContextRunner registryGraph() {
        return runner()
                .withBean(MockApiConnector.class)
                .withBean(ConnectorRegistry.class);
    }

    @Test
    void flagOffBeanGraphResolvesNaverToMock() {
        registryGraph().run(ctx -> {
            ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
            assertThat(registry.resolvePullConnector("NAVER")).get().isInstanceOf(MockApiConnector.class);
            assertThat(registry.resolvePullConnector("COUPANG")).get().isInstanceOf(MockApiConnector.class);
        });
    }

    @Test
    void flagOnBeanGraphResolvesNaverToNaverConnectorAndOthersToMock() {
        registryGraph().withPropertyValues("sellerops.connector.naver.enabled=true")
                .run(ctx -> {
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("NAVER")).get().isInstanceOf(NaverApiConnector.class);
                    // Dedication is NAVER-only: every other channel keeps the mock.
                    for (String other : new String[] {"COUPANG", "GMARKET", "ELEVENST", "CAFE24"}) {
                        assertThat(registry.resolvePullConnector(other))
                                .as("channel %s must keep resolving to the mock", other)
                                .get().isInstanceOf(MockApiConnector.class);
                    }
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }
}
