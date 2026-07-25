package com.sellerops.reviewissue.dto;

import java.util.List;

/**
 * The change judgements for one issue, plus the two numbers a quantified surge line needs.
 *
 * <p>Numbers are structured rather than baked into prose so the frontend can render
 * "최근 7일 9건 · 이전 8주 평균 주 2.1건" itself — the same split of responsibilities as
 * {@code AttentionSignal} + {@code SpikeComparison}, where the server owns the values and the
 * frontend owns every word.
 *
 * @param kinds fired judgements in display order, as enum names
 * @param labelsKo the same judgements as operator-facing labels, so a client cannot invent a
 *     fifth category by mistranslating an enum
 * @param highSurge false whenever SURGING did not fire
 * @param surgeWindowCount evidence in the most recent surge window
 * @param surgeBaselineWeekly mean weekly evidence over the preceding baseline
 */
public record IssueChangeView(List<String> kinds, List<String> labelsKo, boolean highSurge,
                              long surgeWindowCount, double surgeBaselineWeekly) {
}
