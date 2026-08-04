package com.sellerops.connector.naver.setup;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Unit tests for the deployment-global NAVER setup surface: config sanitization + the endpoint shape. */
class NaverSetupControllerTest {

    @Test
    void sanitizeTrimsKeepsIpV4OnlyDeDupesAndCapsAtThree() {
        // Blanks, junk, a bad octet, a duplicate, then a 4th+ valid IP beyond NAVER's 3-IP cap.
        List<String> out = NaverAdvertisedEgress.sanitize(
                " 203.0.113.10 , not-an-ip, 999.1.1.1, 203.0.113.10, 203.0.113.11, 203.0.113.12, 203.0.113.13");
        assertThat(out).containsExactly("203.0.113.10", "203.0.113.11", "203.0.113.12");
    }

    @Test
    void sanitizeDefaultsEmptyWhenUnsetOrAllInvalid() {
        assertThat(NaverAdvertisedEgress.sanitize(null)).isEmpty();
        assertThat(NaverAdvertisedEgress.sanitize("")).isEmpty();
        assertThat(NaverAdvertisedEgress.sanitize("  ")).isEmpty();
        assertThat(NaverAdvertisedEgress.sanitize("nope, 999.999.999.999, 10.0.0")).isEmpty();
    }

    @Test
    void setupEndpointReturnsTheSanitizedAdvertisedIps() {
        NaverSetupController controller =
                new NaverSetupController(new NaverAdvertisedEgress("203.0.113.10, 203.0.113.11"));

        NaverSetupView view = controller.setup();

        assertThat(view.advertisedEgressIps()).containsExactly("203.0.113.10", "203.0.113.11");
    }

    @Test
    void setupEndpointEmptyByDefaultAndViewNeverNull() {
        assertThat(new NaverSetupController(new NaverAdvertisedEgress("")).setup().advertisedEgressIps())
                .isEmpty();
        // The view normalizes a null list to empty so a client never sees null.
        assertThat(new NaverSetupView(null).advertisedEgressIps()).isEmpty();
    }
}
