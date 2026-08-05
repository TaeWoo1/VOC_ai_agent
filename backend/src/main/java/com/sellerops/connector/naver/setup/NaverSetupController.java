package com.sellerops.connector.naver.setup;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Deployment-global NAVER setup facts for the guided-connection tutorial. Unlike the capability check,
 * this is NOT account-scoped: the guided walkthrough needs the advertised call IP(s) BEFORE an account
 * exists (first-time issuance), so the value cannot ride the account-scoped capability view.
 *
 * <p>Read-only, side-effect-free GET; requires authentication (default for {@code /api/**}) but returns
 * the same deployment-global value to any authenticated caller — the advertised egress IP is not a
 * secret (a seller must register it publicly). It never calls the marketplace and writes nothing.
 */
@RestController
@RequestMapping("/api/connect/naver")
public class NaverSetupController {

    private final NaverAdvertisedEgress advertisedEgress;

    public NaverSetupController(NaverAdvertisedEgress advertisedEgress) {
        this.advertisedEgress = advertisedEgress;
    }

    /** The setup facts the issuance tutorial needs (currently just the advertised call IP(s)). */
    @GetMapping("/setup")
    public NaverSetupView setup() {
        return new NaverSetupView(advertisedEgress.ips());
    }
}
