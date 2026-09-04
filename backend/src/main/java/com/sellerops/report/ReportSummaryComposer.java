package com.sellerops.report;

import com.sellerops.report.ReportSummary.Kind;
import com.sellerops.report.ReportSummary.Line;
import java.util.ArrayList;
import java.util.List;

/**
 * The deterministic reading of a {@link ReportFacts} — every sentence a pure function of the values,
 * typed as fact, interpretation or limit, and citing the ids it reads.
 *
 * <p>This is what the seller sees when the narrative capability is off, has failed, or wrote nothing
 * admissible — and it is also the ceiling of what the narrative may claim: nothing here names a cause
 * or an outcome, and the guard refuses the model the same words. 「원인은 리뷰가 말해주지 않습니다」 is
 * the one sentence about causes the report ever prints, and it says the opposite of one.
 */
public final class ReportSummaryComposer {

    /** How many repeated issues the summary names before pointing at the list. */
    static final int ISSUE_LINES = 3;

    private ReportSummaryComposer() {
    }

    public static ReportSummary compose(ReportFacts facts) {
        List<Line> lines = new ArrayList<>();
        boolean anything = false;

        ReportFacts.Counter reviews = counter(facts, ReportFactsBuilder.COUNTER_REVIEWS);
        ReportFacts.Counter inquiries = counter(facts, ReportFactsBuilder.COUNTER_INQUIRIES);
        ReportFacts.Counter negative = counter(facts, ReportFactsBuilder.COUNTER_NEGATIVE_REVIEWS);
        ReportFacts.Counter orders = counter(facts, ReportFactsBuilder.COUNTER_ORDERS);
        ReportFacts.Counter unanswered = counter(facts, ReportFactsBuilder.COUNTER_UNANSWERED_NOW);

        if (reviews != null && inquiries != null) {
            lines.add(new Line(String.format("%s에 리뷰 %d건, 문의 %d건이 들어왔습니다 (이전 기간 리뷰 %s, 문의 %s).",
                    facts.period().labelKo(), reviews.current(), inquiries.current(),
                    previousWord(reviews), previousWord(inquiries)), Kind.FACT, List.of(reviews.id(), inquiries.id())));
            anything |= reviews.current() > 0 || inquiries.current() > 0;
        }
        for (ReportFacts.Counter c : List.of(negative, orders)) {
            if (c != null && c.delta() != null && c.delta() != 0) {
                lines.add(new Line(String.format("%s은(는) 이전 기간보다 %d건 %s (%d건 → %d건).", c.labelKo(),
                        Math.abs(c.delta()), c.delta() > 0 ? "늘었습니다" : "줄었습니다", c.previous(), c.current()),
                        Kind.FACT, List.of(c.id())));
                anything = true;
            }
        }

        boolean anyRose = false;
        int named = 0;
        for (ReportFacts.IssueFact issue : facts.issues()) {
            if (named >= ISSUE_LINES) {
                break;
            }
            if (issue.current() == 0) {
                continue;
            }
            lines.add(new Line(String.format("「%s」 관련 리뷰가 %d건 있었습니다 (이전 기간 %d건).", issue.title(),
                    issue.current(), issue.previous()), Kind.FACT, List.of(issue.id())));
            if (issue.delta() > 0 && issue.current() >= 2) {
                lines.add(new Line(String.format("「%s」 관련 리뷰 증가를 확인할 필요가 있습니다.", issue.title()),
                        Kind.INTERPRETATION, List.of(issue.id())));
                anyRose = true;
            }
            named++;
            anything = true;
        }
        if (anyRose) {
            lines.add(new Line("늘어난 원인은 리뷰가 말해주지 않습니다. 근거 리뷰를 직접 확인해 주세요.", Kind.LIMIT,
                    facts.issues().stream().filter(i -> i.delta() > 0 && i.current() >= 2)
                            .map(ReportFacts.IssueFact::id).toList()));
        }
        if (facts.issues().size() > named && named > 0) {
            lines.add(new Line(String.format("그 외 반복된 문제 %d건은 아래 목록에 있습니다.", facts.issues().size() - named),
                    Kind.FACT, facts.issues().stream().skip(named).map(ReportFacts.IssueFact::id).toList()));
        }

        if (!facts.opportunities().isEmpty()) {
            long open = facts.opportunities().stream().filter(o -> "OPEN".equals(o.status())).count();
            lines.add(new Line(String.format("개선 기회 %d건이 제안되어 있습니다%s.", facts.opportunities().size(),
                    open > 0 ? " (검토 전 " + open + "건)" : ""), Kind.FACT,
                    facts.opportunities().stream().map(ReportFacts.OpportunityFact::id).toList()));
            anything = true;
        }
        if (unanswered != null && unanswered.current() > 0) {
            lines.add(new Line(String.format("지금 답변이 필요한 문의가 %d건 있습니다.", unanswered.current()), Kind.FACT,
                    List.of(unanswered.id())));
        }
        if (!anything) {
            // One sentence replaces the zero-count restatement: 「리뷰 0건, 문의 0건」 under 「달라진 것이
            // 없습니다」 says the same thing twice. The standing unanswered line, if any, stays.
            lines.removeIf(l -> l.kind() == Kind.FACT && l.factIds().contains(ReportFactsBuilder.COUNTER_REVIEWS));
            lines.add(0, new Line(String.format("%s에는 달라진 것이 없습니다 — 새 리뷰·문의·반복 문제가 확인되지 않았습니다.",
                    facts.period().labelKo()), Kind.FACT, factIdsOf(facts)));
        }
        return new ReportSummary(List.copyOf(lines));
    }

    /** 「65건」, or 「자료 없음」 when the previous window held no reading — never 「0건」 for an absence. */
    private static String previousWord(ReportFacts.Counter c) {
        return c.previous() == null ? "자료 없음" : c.previous() + "건";
    }

    private static ReportFacts.Counter counter(ReportFacts facts, String id) {
        for (ReportFacts.Counter c : facts.counters()) {
            if (c.id().equals(id)) {
                return c;
            }
        }
        return null;
    }

    private static List<String> factIdsOf(ReportFacts facts) {
        return facts.counters().stream().map(ReportFacts.Counter::id).toList();
    }
}
