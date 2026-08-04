package com.sellerops.connector.naver.setup;

import java.util.List;

/**
 * Deployment-global setup facts a seller needs BEFORE (and during) the guided NAVER connection —
 * available without an account, so the issuance tutorial can display them at the register-call-IP step.
 *
 * @param advertisedEgressIps the fixed public egress IPv4(s) to register in the app's 'API 호출 IP'.
 *                            Sanitized, non-secret, and EMPTY when none is configured (the UI then shows
 *                            generic guidance, never a fabricated IP). Never null.
 */
public record NaverSetupView(List<String> advertisedEgressIps) {

    public NaverSetupView {
        advertisedEgressIps = advertisedEgressIps == null ? List.of() : List.copyOf(advertisedEgressIps);
    }
}
