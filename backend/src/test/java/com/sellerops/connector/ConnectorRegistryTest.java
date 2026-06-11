package com.sellerops.connector;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** Slice 2: ConnectorRegistry resolution + the file/pull connector separation. */
class ConnectorRegistryTest {

    /** Minimal non-pull connector standing in for the file-upload connector. */
    static final class StubFileConnector implements ChannelConnector {
        @Override
        public String kind() {
            return ConnectorRegistry.FILE_CHANNEL_CODE;
        }
    }

    private ConnectorRegistry registryWithMockAndFile() {
        return new ConnectorRegistry(List.of(new MockApiConnector(), new StubFileConnector()));
    }

    @Test
    void resolvesMockApiConnectorForNonFileChannels() {
        ConnectorRegistry registry = registryWithMockAndFile();
        assertThat(registry.resolvePullConnector("COUPANG")).get().isInstanceOf(MockApiConnector.class);
        assertThat(registry.resolvePullConnector("NAVER")).get().isInstanceOf(MockApiConnector.class);
        assertThat(registry.resolvePullConnector("GMARKET")).get().isInstanceOf(MockApiConnector.class);
    }

    @Test
    void fileChannelHasNoPullConnector() {
        ConnectorRegistry registry = registryWithMockAndFile();
        assertThat(registry.isFileChannel("FILE_UPLOAD")).isTrue();
        assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
    }

    @Test
    void fileUploadConnectorIsNotAPullConnector() {
        // The real connector class must not be schedulable as a pull connector.
        assertThat(PullConnector.class.isAssignableFrom(FileUploadConnector.class)).isFalse();
    }

    @Test
    void resolveByConnectorClassMapsApiToPullAndManualToFile() {
        ConnectorRegistry registry = registryWithMockAndFile();
        assertThat(registry.resolve("COUPANG", "API")).get().isInstanceOf(MockApiConnector.class);
        assertThat(registry.resolve("FILE_UPLOAD", "MANUAL")).get().isInstanceOf(StubFileConnector.class);
        // A class the channel does not offer resolves to empty rather than guessing.
        assertThat(registry.resolve("COUPANG", "MANUAL")).isEmpty();
        assertThat(registry.resolve("FILE_UPLOAD", "API")).isEmpty();
    }

    @Test
    void springInjectsAllConnectorsAndOnlyMockIsTreatedAsPull() {
        // Exercises the real List<ChannelConnector> constructor injection path with
        // two coexisting connector beans, without booting the full application.
        new ApplicationContextRunner()
                .withBean(MockApiConnector.class)
                .withBean(StubFileConnector.class)
                .withBean(ConnectorRegistry.class)
                .run(ctx -> {
                    assertThat(ctx).hasSingleBean(ConnectorRegistry.class);
                    assertThat(ctx.getBeansOfType(ChannelConnector.class)).hasSize(2);
                    ConnectorRegistry registry = ctx.getBean(ConnectorRegistry.class);
                    assertThat(registry.resolvePullConnector("COUPANG")).get().isInstanceOf(MockApiConnector.class);
                    assertThat(registry.resolvePullConnector("FILE_UPLOAD")).isEmpty();
                });
    }
}
