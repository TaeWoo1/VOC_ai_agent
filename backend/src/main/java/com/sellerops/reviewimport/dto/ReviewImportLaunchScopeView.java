package com.sellerops.reviewimport.dto;

import com.sellerops.reviewimport.ReviewImportLaunchService.LaunchScope;
import java.time.LocalDate;

/**
 * What the local-agent RUNTIME is told when it resolves a launch ref.
 *
 * <p>Deliberately identity-free — no plan id, segment id, seller-account id, or org id. The runtime needs
 * only which channel to open and, for a segment run, which dates to guide the seller to; everything it does
 * afterwards flows back through the same opaque ref. Keeping this view minimal is what lets the Action
 * Window wire stay free of identity even though the run is bound to a specific segment.
 */
public record ReviewImportLaunchScopeView(
        String kind,
        String channelCode,
        LocalDate requiredStart,
        LocalDate requiredEnd) {

    public static ReviewImportLaunchScopeView from(LaunchScope s) {
        return new ReviewImportLaunchScopeView(s.kind().name(), s.channelCode(), s.requiredStart(), s.requiredEnd());
    }
}
