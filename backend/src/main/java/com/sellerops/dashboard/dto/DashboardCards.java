package com.sellerops.dashboard.dto;

/**
 * The legacy home-dashboard summary cards — <b>six, since {@code urgentCount} and
 * {@code unhandledCount} were removed (2026-09-13).</b>
 *
 * <p><b>Why those two went.</b> {@code urgentCount} was
 * {@code unansweredInquiries + negativeReviews} — two different populations added into a third that
 * nobody counted, and then called urgent. Measured on the demo org it read 43 (24 + 19), a number
 * that describes no set of rows: a seller acting on it could not open «the 43». {@code unhandledCount}
 * was a second name for {@code unansweredInquiries}, so a reader had to know they were the same to
 * avoid adding them.
 *
 * <p><b>Removed rather than deprecated in place, because the audit found no consumer.</b> No screen
 * calls {@code getDashboardSummary} at all; the agent runtime's own {@code DashboardSummary} type
 * declares exactly {@code topProductIssues} and {@code cards.negativeReviews} and reads neither
 * field. A field kept "for compatibility" with nothing is a field the next person will use.
 *
 * <p>Every surviving card answers one question over one population and says in its name which one.
 * {@code DashboardCardsShapeTest} holds that: no combined or ranked quantity may be added back here.
 */
public record DashboardCards(
        int todayOrders,
        long todaySales,
        long newInquiries,
        long unansweredInquiries,
        long newReviews,
        long negativeReviews) {
}
