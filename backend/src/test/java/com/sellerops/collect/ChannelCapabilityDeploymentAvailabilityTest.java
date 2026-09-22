package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.collect.dto.ChannelCapabilityOverview;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * A connected channel whose connector is switched off in this deployment is not a channel that 「does not support
 * auto-collect」 (Full MVP truth fix). The overview keeps {@code autoCollectSupported} exactly as the service computed
 * it and adds, beside it, why nothing resolved.
 */
class ChannelCapabilityDeploymentAvailabilityTest {

    private static ChannelCapabilityOverview unresolved(String code) {
        return new ChannelCapabilityOverview(code, null, null, false, List.of(), List.of(), List.of());
    }

    private static ChannelCapabilityController controller(ChannelCapabilityOverview overview,
                                                          boolean naver, boolean coupang, boolean cafe24) {
        CollectControlService service = mock(CollectControlService.class);
        when(service.channelCapabilityOverview(overview.channelCode())).thenReturn(overview);
        return new ChannelCapabilityController(service, naver, coupang, cafe24);
    }

    @Test
    void anOfficialConnectorSwitchedOffHereSaysSo_andTheCapabilityIsUntouched() {
        for (String code : List.of("NAVER", "COUPANG", "CAFE24")) {
            ChannelCapabilityOverview out = controller(unresolved(code), false, false, false).overview(code);
            assertThat(out.deploymentAvailability()).as(code).isEqualTo("OFF_IN_THIS_DEPLOYMENT");
            assertThat(out.autoCollectSupported()).as(code).isFalse();
            assertThat(out.dataTypes()).as(code).isEmpty();
        }
    }

    @Test
    void aChannelTheProductHasNoConnectorForIsNotCalledSwitchedOff() {
        ChannelCapabilityOverview out = controller(unresolved("GMARKET"), false, false, false).overview("GMARKET");
        assertThat(out.deploymentAvailability()).isEqualTo("NO_OFFICIAL_CONNECTOR");
    }

    @Test
    void aResolvedConnectorIsOn() {
        ChannelCapabilityOverview resolved =
                new ChannelCapabilityOverview("NAVER", null, "NaverCommerceConnector", true, List.of(), List.of(), List.of());
        assertThat(controller(resolved, true, false, false).overview("NAVER").deploymentAvailability()).isEqualTo("ON");
    }

    @Test
    void aSwitchedOnConnectorThatDidNotResolveIsNotCalledOff_itStaysUnstated() {
        // Switched on and still unresolved is a misconfigured process; 「off」 would be the wrong sentence for it.
        assertThat(controller(unresolved("NAVER"), true, false, false).overview("NAVER").deploymentAvailability()).isNull();
    }
}
