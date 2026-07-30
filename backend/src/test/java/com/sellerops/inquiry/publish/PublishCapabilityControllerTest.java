package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.publish.dto.PublishCapabilityView;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit test for the read-only publish-capability surface. On the fail-closed default —
 * execution disabled and no reply adapters registered — it must report exactly that, so
 * an orchestration client can verify the send path is off. (Live-verified against a real
 * backend; this pins the contract in the gate.)
 */
class PublishCapabilityControllerTest {

    @Test
    void reportsFailClosedWhenExecutionDisabledAndNoAdapters() {
        // No adapters registered (the default when execution-enabled is off). channels is
        // unused by registeredChannelCodes(), so a null repository is fine here.
        ChannelReplyAdapterRegistry registry = new ChannelReplyAdapterRegistry(null, List.of());
        PublishCapabilityController controller = new PublishCapabilityController(registry, false);

        PublishCapabilityView view = controller.capability();

        assertThat(view.executionEnabled()).isFalse();
        assertThat(view.replyAdapterChannelCodes()).isEmpty();
    }

    @Test
    void registryReportsNoRegisteredChannelsWhenEmpty() {
        ChannelReplyAdapterRegistry registry = new ChannelReplyAdapterRegistry(null, List.of());
        assertThat(registry.registeredChannelCodes()).isEmpty();
    }

    @Test
    void reportsExecutionEnabledWhenFlagOn() {
        // The config the orchestration client's fail-closed guard must reject.
        ChannelReplyAdapterRegistry registry = new ChannelReplyAdapterRegistry(null, List.of());
        PublishCapabilityController controller = new PublishCapabilityController(registry, true);

        PublishCapabilityView view = controller.capability();

        assertThat(view.executionEnabled()).isTrue();
    }
}
