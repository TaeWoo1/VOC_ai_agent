package com.sellerops.connector.coupang.setup;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Unit tests for the deployment-global Coupang setup surface: config sanitization + the endpoint shape. */
class CoupangSetupControllerTest {

    @Test
    void sanitizeTrimsKeepsIpV4OnlyDeDupesAndCaps() {
        // Blanks, junk, a bad octet, a duplicate, then a 4th valid IP beyond the deployment-egress cap.
        List<String> out = CoupangAdvertisedEgress.sanitize(
                " 203.0.113.20 , not-an-ip, 999.1.1.1, 203.0.113.20, 203.0.113.21, 203.0.113.22, 203.0.113.23");
        assertThat(out).containsExactly("203.0.113.20", "203.0.113.21", "203.0.113.22");
    }

    @Test
    void sanitizeDefaultsEmptyWhenUnsetOrAllInvalid() {
        assertThat(CoupangAdvertisedEgress.sanitize(null)).isEmpty();
        assertThat(CoupangAdvertisedEgress.sanitize("")).isEmpty();
        assertThat(CoupangAdvertisedEgress.sanitize("  ")).isEmpty();
        assertThat(CoupangAdvertisedEgress.sanitize("nope, 999.999.999.999, 10.0.0")).isEmpty();
    }

    @Test
    void setupEndpointReturnsTheSanitizedAdvertisedIps() {
        CoupangSetupController controller =
                new CoupangSetupController(new CoupangAdvertisedEgress("203.0.113.20, 203.0.113.21"));

        CoupangSetupView view = controller.setup();

        assertThat(view.advertisedEgressIps()).containsExactly("203.0.113.20", "203.0.113.21");
    }

    @Test
    void setupEndpointEmptyByDefaultAndViewNeverNull() {
        assertThat(new CoupangSetupController(new CoupangAdvertisedEgress("")).setup().advertisedEgressIps())
                .isEmpty();
        // The view normalizes a null list to empty so a client never sees null.
        assertThat(new CoupangSetupView(null).advertisedEgressIps()).isEmpty();
    }
}
