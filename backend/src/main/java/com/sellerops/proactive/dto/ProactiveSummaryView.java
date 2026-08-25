package com.sellerops.proactive.dto;

/**
 * The one line 홈 shows: how much SellerOps has already looked into, waiting for the seller.
 *
 * <p>Counts only. The home screen's job here is to be an entry point, not a second list — a
 * dashboard that reprinted the cards would make the seller read them twice and decide nowhere.
 */
public record ProactiveSummaryView(long open, long high, long draftsPrepared) {
}
