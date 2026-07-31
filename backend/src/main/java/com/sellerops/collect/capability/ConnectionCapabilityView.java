package com.sellerops.collect.capability;

import java.util.List;
import java.util.UUID;

/**
 * Sanitized result of a read-only connection-capability check for one connected API account,
 * shaped for a guided-connection wizard's capability-result screen. Channel-neutral in shape
 * (currently produced for the NAVER guided connection); the feature/state/reason vocabularies are
 * closed and every string is a fixed label or a safe machine code.
 *
 * <p><b>Privacy invariant.</b> Nothing here leaks a secret or identifies an external store: no
 * token, no client id/secret, no order id, no personal data. The seller's identity is reported
 * ONLY as the boolean {@link #identityConfirmed()} — "the stored credential decrypted, authenticated
 * against the provider, and a first order sync reached this seller" — never as a fetched store name.
 * The NAVER commerce API exposes no whoami, so a successful first sync is the honest ceiling for
 * identity confirmation; nothing here fabricates a store identity.
 *
 * @param sellerAccountId   the account this report is about
 * @param channelCode       the account's channel code (e.g. {@code "NAVER"})
 * @param connectionStatus  {@code ChannelStatus.name()} of the account, or null
 * @param credentialPresent a credential row exists for this account (no decrypt implied)
 * @param identityConfirmed the credential authenticated and a first ORDER sync reached this seller
 * @param firstSyncStatus   latest {@code ORDER_SUMMARY} sync outcome:
 *                          {@code NONE} | {@code SUCCESS} | {@code PARTIAL} | {@code FAILED} | {@code RUNNING}
 * @param overall           {@code AVAILABLE} when the order connection is live, else {@code NEEDS_ATTENTION}
 * @param reason            closed top-level reason code when not {@code AVAILABLE}; else null
 * @param features          per-feature statuses (order read / review import / review reply / inquiry read)
 */
public record ConnectionCapabilityView(
        UUID sellerAccountId,
        String channelCode,
        String connectionStatus,
        boolean credentialPresent,
        boolean identityConfirmed,
        String firstSyncStatus,
        String overall,
        String reason,
        List<ConnectionCapabilityFeature> features) {
}
