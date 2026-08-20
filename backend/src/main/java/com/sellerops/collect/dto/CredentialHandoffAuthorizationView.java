package com.sellerops.collect.dto;

/**
 * The issued authorization, as the seller's browser sees it.
 *
 * <p>{@code authorizationId} is a CAPABILITY — whoever holds it can spend this one handoff — so it is minted
 * from a secure source, lives for minutes, and is never logged. It is deliberately the only thing returned: no
 * seller-account id, no channel detail, nothing about what it resolved to. A caller learns that their request
 * was authorized and nothing further about the account it was authorized for.
 *
 * @param authorizationId the opaque one-shot id the agent presents with the handoff
 * @param expiresInMs     how long it stays usable, so the surface can say so rather than guess
 */
public record CredentialHandoffAuthorizationView(String authorizationId, long expiresInMs) {

    /** Masked: this record's whole point is that the id is a capability. */
    @Override
    public String toString() {
        return "CredentialHandoffAuthorizationView[authorizationId=<masked>, expiresInMs=" + expiresInMs + "]";
    }
}
