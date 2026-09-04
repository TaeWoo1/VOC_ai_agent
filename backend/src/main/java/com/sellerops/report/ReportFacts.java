package com.sellerops.report;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Everything a report may say, as VALUES with ids — the snapshot that is stored and the only thing a
 * narrative may cite.
 *
 * <p><b>Every fact has an id, and that is the whole design.</b> A sentence in the report — written by
 * our composer or by the model — is admitted only if it names the fact ids it rests on, and every id
 * it names must exist here. So 「접착 관련 리뷰가 이전 기간보다 늘었습니다」 traces to an {@code i-…} row
 * with {@code current} and {@code previous}, and 「생산 품질이 나빠졌습니다」 has nothing to cite and is
 * refused. The seller can click from any line to the object behind it because the object's link is
 * part of the fact.
 *
 * <p>No customer text and no seller row beyond what the screens already print: counts, dates,
 * closed-vocabulary issue titles, the seller's own product names, opportunity labels.
 */
public record ReportFacts(Period period, List<Counter> counters, List<IssueFact> issues,
                          List<OpportunityFact> opportunities, List<NextStep> nextSteps,
                          Instant generatedAt) {

    public record Period(String kind, String kindLabelKo, LocalDate start, LocalDate end, String labelKo,
                         LocalDate previousStart, LocalDate previousEnd) {
    }

    /**
     * One number over the period, with the same number over the previous period when the number is a
     * period figure.
     *
     * <p>{@code periodic=false} is a figure that has no period — 미답변 문의 is what is waiting NOW, and
     * the report says so rather than inventing last week's backlog. {@code previous=null} on a periodic
     * figure means the previous window holds <b>no reading at all</b>: an absent series is not a zero
     * (the live monthly report once said 「주문은 전월 0건에서 317건으로」 because July had no order rows),
     * so no delta is derived and the sentence says the previous period has no data.
     *
     * @param to where this exact figure is shown, or null when no screen shows exactly it
     */
    public record Counter(String id, String labelKo, boolean periodic, long current, Long previous, Long delta,
                          String to) {
    }

    /** One repeated issue's evidence over the period, against the previous period. */
    public record IssueFact(String id, UUID issueId, String title, String severity, String severityLabelKo,
                            long current, long previous, long delta, List<String> changeLabelsKo,
                            UUID productId, String productName, String to) {
    }

    /** One improvement opportunity standing at generation time — its own object, cited by id. */
    public record OpportunityFact(String id, UUID issueId, String kind, String kindLabelKo, String status,
                                  String statusLabelKo, String issueTitle, UUID productId, String productName,
                                  String recommendationKo, String nextActionKo, String to) {
    }

    /**
     * A prepared next step, always pointing at an EXISTING object (a queue, an issue, an opportunity)
     * and always citing the facts it follows from. There is no to-do table behind this.
     */
    public record NextStep(String id, String labelKo, String to, List<String> factIds) {
    }

    /** All fact ids, for the guard that admits sentences. */
    public java.util.Set<String> factIds() {
        java.util.Set<String> ids = new java.util.LinkedHashSet<>();
        counters.forEach(c -> ids.add(c.id()));
        issues.forEach(i -> ids.add(i.id()));
        opportunities.forEach(o -> ids.add(o.id()));
        nextSteps.forEach(n -> ids.add(n.id()));
        return ids;
    }
}
