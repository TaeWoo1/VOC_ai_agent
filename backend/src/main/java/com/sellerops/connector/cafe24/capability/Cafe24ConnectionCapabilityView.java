package com.sellerops.connector.cafe24.capability;

import java.util.List;
import java.util.UUID;

/**
 * The sanitized result of a read-only Cafe24 connection capability check, shaped for the
 * first-connection tutorial's verification + completion screens.
 *
 * <p><b>Privacy invariant.</b> Nothing here identifies the mall or leaks a secret: no mall
 * id, no access/refresh token, no OAuth code/state, no board name or number, no personal
 * data. The mall's identity is reported only as the boolean {@link #identityConfirmed()}
 * ("the stored credential really belongs to a reachable Cafe24 mall"), never as the id
 * itself. Every string field is a closed vocabulary or a fixed Korean label.
 *
 * @param sellerAccountId      the account this report is about
 * @param connectionStatus     {@code ChannelStatus.name()} of the seller account
 * @param credentialPresent    a credential row exists for this account (no decrypt implied)
 * @param credentialDecryptable the vault opened and a live token was granted
 * @param identityConfirmed    a live authenticated read reached the mall this credential names
 * @param excludedBoardHidden  the 1:1 board is never exposed as a collectable feature (always true)
 * @param connectionVerified   credential + identity + review/inquiry board mapping all AVAILABLE
 * @param overall              {@code AVAILABLE} when connectionVerified, else {@code NEEDS_ATTENTION}
 * @param reason               closed top-level reason code when not verified; else null
 * @param features             per-feature statuses (order/inquiry/review/issue/reply/excluded)
 */
public record Cafe24ConnectionCapabilityView(
        UUID sellerAccountId,
        String connectionStatus,
        boolean credentialPresent,
        boolean credentialDecryptable,
        boolean identityConfirmed,
        boolean excludedBoardHidden,
        boolean connectionVerified,
        String overall,
        String reason,
        List<Cafe24CapabilityFeature> features) {
}
