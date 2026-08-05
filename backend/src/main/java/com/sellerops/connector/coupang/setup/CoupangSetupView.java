package com.sellerops.connector.coupang.setup;

import java.util.List;

/**
 * Deployment-global setup facts a seller needs BEFORE (and during) the guided Coupang connection —
 * available without an account, so the connection surface can display them at the register-calling-IP
 * step.
 *
 * @param advertisedEgressIps the fixed public egress IPv4(s) to register in the Coupang app's calling-IP
 *                            allowlist. Sanitized, non-secret, and EMPTY when none is configured (the UI
 *                            then shows generic guidance, never a fabricated IP). Never null.
 */
public record CoupangSetupView(List<String> advertisedEgressIps) {

    public CoupangSetupView {
        advertisedEgressIps = advertisedEgressIps == null ? List.of() : List.copyOf(advertisedEgressIps);
    }
}
