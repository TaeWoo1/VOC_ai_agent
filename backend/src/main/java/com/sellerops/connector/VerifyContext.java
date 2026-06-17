package com.sellerops.connector;

import java.util.UUID;

/**
 * Secret-free inputs handed to a {@link ConnectionVerifier}. It carries only the
 * identifiers a verifier needs to locate the credential — <b>never plaintext
 * secrets</b>. A verifier decrypts in memory itself via
 * {@link com.sellerops.credential.CredentialVault#open(UUID, UUID)
 * vault.open(orgId, sellerAccountId)}, so secrets never travel through this DTO,
 * the service, or any log.
 */
public record VerifyContext(UUID orgId, UUID sellerAccountId, String channelCode) {
}
