package com.sellerops.collect.dto;

/**
 * What the agent learns back from a credential handoff. Value-free by construction: there is no field here that
 * can hold a secret, a ciphertext, an IV, a provider body, or a seller-account id.
 *
 * @param stored           whether the credential was encrypted and persisted
 * @param connectionStatus the read-only connection check: {@code SUCCESS | FAILED | UNSUPPORTED | NOT_CONFIGURED}
 * @param connectionReason a safe reason constant when the check did not succeed, else null
 */
public record AgentCredentialHandoffResultView(
        boolean stored,
        String connectionStatus,
        String connectionReason) {
}
