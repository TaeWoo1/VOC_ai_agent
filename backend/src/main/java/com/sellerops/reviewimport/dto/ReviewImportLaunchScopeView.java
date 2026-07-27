package com.sellerops.reviewimport.dto;

import com.sellerops.reviewimport.ReviewImportLaunchService.LaunchScope;
import java.time.LocalDate;

/**
 * What the local-agent RUNTIME is told when it resolves a launch ref.
 *
 * <p>Deliberately identity-free — no plan id, segment id, seller-account id, or org id. The runtime needs
 * only which channel to open, which opaque per-account slot to bind its persistent browser profile to,
 * and, for a segment run, which dates to guide the seller to; everything it does afterwards flows back
 * through the same opaque ref. {@code accountSlot} is a server-owned surrogate that is NOT reversible to
 * the seller-account id, so the wire stays free of identity even though the profile is now account-specific.
 */
public record ReviewImportLaunchScopeView(
        String kind,
        String channelCode,
        String accountSlot,
        LocalDate requiredStart,
        LocalDate requiredEnd) {

    public static ReviewImportLaunchScopeView from(LaunchScope s) {
        return new ReviewImportLaunchScopeView(
                s.kind().name(), s.channelCode(), s.accountSlot(), s.requiredStart(), s.requiredEnd());
    }
}
