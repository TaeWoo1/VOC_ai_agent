package com.sellerops.connector.coupang.setup;

import com.sellerops.collect.CredentialHandoffArming;
import java.util.List;

/**
 * Deployment-global setup facts a seller needs BEFORE (and during) the guided Coupang connection —
 * available without an account, so the connection surface can display them at the register-calling-IP
 * step.
 *
 * @param advertisedEgressIps the fixed public egress IPv4(s) to register in the Coupang app's calling-IP
 *                            allowlist. Sanitized, non-secret, and EMPTY when none is configured (the UI
 *                            then shows generic guidance, never a fabricated IP). Never null.
 * @param credentialHandoff   the sanitized CREDENTIAL-HANDOFF interlock readiness — a different interlock from
 *                            {@code liveApproval} and deliberately so: that one asks whether SOME approval id is
 *                            armed for a read-only marketplace GET, this one asks whether THIS run, at THIS
 *                            commit, for the credential phase, still has its one unspent handoff. Value-free:
 *                            two id prefixes, a phase literal, two booleans. Never null.
 * @param liveApproval        the sanitized backend live-run readiness — never a credential. Lets a live
 *                            proof's preflight confirm the running backend is armed with the approved run's
 *                            approval id (binding proof), the gap a green health check cannot close. Never
 *                            null.
 */
public record CoupangSetupView(List<String> advertisedEgressIps, LiveApprovalReadiness liveApproval,
                              CredentialHandoffArming.Readiness credentialHandoff) {

    public CoupangSetupView {
        advertisedEgressIps = advertisedEgressIps == null ? List.of() : List.copyOf(advertisedEgressIps);
        liveApproval = liveApproval == null ? LiveApprovalReadiness.notArmed(false) : liveApproval;
        // Absent reads as UNARMED, never as "unknown". A readiness field that can be missing is one a preflight
        // can mistake for a check it did not run.
        credentialHandoff = credentialHandoff == null
                ? new CredentialHandoffArming.Readiness(false, false, null, null, null)
                : credentialHandoff;
    }

    /**
     * Sanitized backend live-run interlock readiness (see
     * {@code com.sellerops.connector.coupang.CoupangLiveCallGuard}).
     *
     * @param connectorEnabled whether the Coupang connector feature flag is on (else COUPANG is the mock
     *                         and no live call is even wired).
     * @param approvalArmed    whether a non-blank live-run approval id is armed AND the connector is enabled
     *                         — i.e. a live call to the real gateway would pass the interlock.
     * @param approvalIdPrefix a short prefix of the armed approval id (env-binding token, not a secret) so
     *                         preflight can match it against the bootstrapped id; {@code null} when unarmed.
     */
    public record LiveApprovalReadiness(boolean connectorEnabled, boolean approvalArmed, String approvalIdPrefix) {

        /** The length of the surfaced approval-id prefix — enough to bind a run, short enough to reveal nothing. */
        public static final int PREFIX_LENGTH = 12;

        public static LiveApprovalReadiness notArmed(boolean connectorEnabled) {
            return new LiveApprovalReadiness(connectorEnabled, false, null);
        }

        /**
         * Build the readiness from the raw config. A blank approval id, or a disabled connector, yields
         * an unarmed view with no prefix. Otherwise the first {@link #PREFIX_LENGTH} chars of the id are
         * surfaced (an environment-binding token, never a credential).
         */
        public static LiveApprovalReadiness of(boolean connectorEnabled, String liveApprovalId) {
            if (!connectorEnabled || liveApprovalId == null || liveApprovalId.isBlank()) {
                return notArmed(connectorEnabled);
            }
            String trimmed = liveApprovalId.trim();
            String prefix = trimmed.length() <= PREFIX_LENGTH ? trimmed : trimmed.substring(0, PREFIX_LENGTH);
            return new LiveApprovalReadiness(true, true, prefix);
        }
    }
}
