package com.sellerops.connector.coupang.setup;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.coupang.setup.CoupangSetupView.LiveApprovalReadiness;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Unit tests for the deployment-global Coupang setup surface: config sanitization, the endpoint shape,
 *  and the sanitized live-run approval readiness (binding proof for a live-proof preflight). */
class CoupangSetupControllerTest {

    private static CoupangSetupController controller(String ips, boolean enabled, String approvalId) {
        // The credential-handoff interlock is a SEPARATE arming from the live-call approval id, so this
        // controller test hands it an unarmed one: a live-call grant must not read as a credential grant.
        return new CoupangSetupController(new CoupangAdvertisedEgress(ips),
                new com.sellerops.collect.CredentialHandoffArming("", "", "", "", 0), enabled, approvalId);
    }

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
        CoupangSetupView view = controller("203.0.113.20, 203.0.113.21", false, "").setup();

        assertThat(view.advertisedEgressIps()).containsExactly("203.0.113.20", "203.0.113.21");
    }

    @Test
    void setupEndpointEmptyByDefaultAndViewNeverNull() {
        assertThat(controller("", false, "").setup().advertisedEgressIps()).isEmpty();
        // The view normalizes a null list to empty and a null readiness to a not-armed value.
        CoupangSetupView view = new CoupangSetupView(null, null, null);
        assertThat(view.advertisedEgressIps()).isEmpty();
        assertThat(view.liveApproval()).isNotNull();
        assertThat(view.liveApproval().approvalArmed()).isFalse();
        assertThat(view.liveApproval().approvalIdPrefix()).isNull();
        // …and an absent credential-handoff readiness reads as UNARMED, never as "unknown".
        assertThat(view.credentialHandoff()).isNotNull();
        assertThat(view.credentialHandoff().armed()).isFalse();
        assertThat(view.credentialHandoff().approvalIdPrefix()).isNull();
    }

    @Test
    void liveApprovalIsArmedOnlyWhenEnabledAndIdPresent_andSurfacesOnlyAShortPrefix() {
        CoupangSetupView armed = controller("", true, "apr-0123456789abcdef-secret-tail").setup();
        assertThat(armed.liveApproval().connectorEnabled()).isTrue();
        assertThat(armed.liveApproval().approvalArmed()).isTrue();
        // Only a short, non-revealing prefix crosses the wire — never the full env-binding id.
        assertThat(armed.liveApproval().approvalIdPrefix())
                .isEqualTo("apr-01234567")
                .hasSize(LiveApprovalReadiness.PREFIX_LENGTH);
    }

    @Test
    void liveApprovalUnarmedWhenFlagOffEvenWithId_orWhenFlagOnButNoId() {
        // Flag off + id present → NOT armed (COUPANG is the mock; no live path wired).
        CoupangSetupView flagOff = controller("", false, "apr-abcdef123456").setup();
        assertThat(flagOff.liveApproval().connectorEnabled()).isFalse();
        assertThat(flagOff.liveApproval().approvalArmed()).isFalse();
        assertThat(flagOff.liveApproval().approvalIdPrefix()).isNull();

        // Flag on + blank id → NOT armed (a real-gateway call would fail closed).
        CoupangSetupView noId = controller("", true, "   ").setup();
        assertThat(noId.liveApproval().connectorEnabled()).isTrue();
        assertThat(noId.liveApproval().approvalArmed()).isFalse();
        assertThat(noId.liveApproval().approvalIdPrefix()).isNull();
    }
}
