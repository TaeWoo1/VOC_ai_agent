package com.sellerops.connector.coupang.setup;

import com.sellerops.connector.coupang.setup.CoupangSetupView.LiveApprovalReadiness;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Deployment-global Coupang setup facts for the guided connection surface. Unlike the account-scoped
 * capability check, this is NOT account-scoped: a first-time seller needs the advertised calling IP(s)
 * BEFORE an account exists, so the value cannot ride the account-scoped capability view.
 *
 * <p>Read-only, side-effect-free GET; requires authentication (default for {@code /api/**}) but returns
 * the same deployment-global value to any authenticated caller — the advertised egress IP is not a
 * secret (a seller must register it publicly). It also surfaces the sanitized live-run interlock
 * readiness (connector flag + whether an approval id is armed + a short id prefix) so a live proof's
 * preflight can prove the running backend is bound to the approved run. It never calls the marketplace
 * and writes nothing.
 */
@RestController
@RequestMapping("/api/connect/coupang")
public class CoupangSetupController {

    private final CoupangAdvertisedEgress advertisedEgress;
    private final boolean connectorEnabled;
    private final String liveApprovalId;

    public CoupangSetupController(
            CoupangAdvertisedEgress advertisedEgress,
            @Value("${sellerops.connector.coupang.enabled:false}") boolean connectorEnabled,
            @Value("${sellerops.connector.coupang.live-approval-id:}") String liveApprovalId) {
        this.advertisedEgress = advertisedEgress;
        this.connectorEnabled = connectorEnabled;
        this.liveApprovalId = liveApprovalId;
    }

    /** The setup facts the Coupang connection surface needs: advertised calling IP(s) + live-run readiness. */
    @GetMapping("/setup")
    public CoupangSetupView setup() {
        return new CoupangSetupView(
                advertisedEgress.ips(),
                LiveApprovalReadiness.of(connectorEnabled, liveApprovalId));
    }
}
