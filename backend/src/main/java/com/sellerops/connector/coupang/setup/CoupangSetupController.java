package com.sellerops.connector.coupang.setup;

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
 * secret (a seller must register it publicly). It never calls the marketplace and writes nothing.
 */
@RestController
@RequestMapping("/api/connect/coupang")
public class CoupangSetupController {

    private final CoupangAdvertisedEgress advertisedEgress;

    public CoupangSetupController(CoupangAdvertisedEgress advertisedEgress) {
        this.advertisedEgress = advertisedEgress;
    }

    /** The setup facts the Coupang connection surface needs (currently just the advertised calling IP(s)). */
    @GetMapping("/setup")
    public CoupangSetupView setup() {
        return new CoupangSetupView(advertisedEgress.ips());
    }
}
