package com.sellerops.inquiry.resolve;

import com.sellerops.inquiry.authority.ObservedField;
import com.sellerops.inquiry.authority.Resolution;
import com.sellerops.inquiry.goal.GoalResolution;
import com.sellerops.inquiry.goal.GoalSetResolution;
import com.sellerops.inquiry.goal.ResolverOutcome;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * <b>A resolved goal set, flattened to what a screen and a case can read.</b>
 *
 * <p>{@link GoalSetResolution.Outcome} is the loop's own record: traces, observations, provenance, the whole walk.
 * That is the right shape for deciding and the wrong shape for crossing an API boundary, so this is the reading of
 * it — tokens and counts, no nested resolutions, no customer text, no identifiers.
 *
 * <h2>{@link #consulted()} is the evidence link</h2>
 *
 * <p>Each goal records which capabilities actually answered it — {@code KNOWLEDGE.PRODUCT}, {@code ENTITY.ORDER}
 * and so on — and what they observed. That is how a case can say <i>what this conclusion rests on</i> without
 * anyone searching again: the capability names the lane, and the draft's own evidence rows name the passages that
 * lane returned. One gather, two readings of it.
 *
 * @param goals    how many goals the message carried
 * @param withheld how many were held behind a customer-stated condition and never asked about
 */
public record InquiryResolutionView(String state, String gap, int goals, int withheld, List<Goal> resolved) {

    /**
     * One goal's terminal reading.
     *
     * @param consulted the capabilities that answered, in the order they were asked
     * @param observed  what an entity read actually saw, as {@code FIELD=VALUE}; empty for a knowledge answer
     * @param ask       what the customer would have to supply, as {@link com.sellerops.inquiry.authority.CustomerInput}
     *                  tokens; identity can never appear, because {@link Resolution} refuses to carry it
     */
    public record Goal(String goalId, String requestedOutcome, String subject, String state, String gap,
                       List<String> consulted, List<String> observed, List<String> ask) {

        public Goal {
            consulted = consulted == null ? List.of() : List.copyOf(consulted);
            observed = observed == null ? List.of() : List.copyOf(observed);
            ask = ask == null ? List.of() : List.copyOf(ask);
        }
    }

    public InquiryResolutionView {
        resolved = resolved == null ? List.of() : List.copyOf(resolved);
    }

    /** The flattening. Withheld goals appear only in the count — no resolver was asked, so there is nothing to read. */
    public static InquiryResolutionView of(GoalSetResolution.Outcome outcome) {
        if (outcome == null) {
            return null;
        }
        List<Goal> goals = new ArrayList<>();
        int withheld = 0;
        String worst = null;
        String worstGap = null;
        int worstRank = -1;
        for (GoalSetResolution.Entry entry : outcome.entries()) {
            GoalResolution.Trace trace = entry.trace();
            if (trace == null) {
                withheld++;
                continue;
            }
            goals.add(goalOf(entry.goalId(), trace));
            int rank = BLOCKING.indexOf(trace.state().name());
            if (rank > worstRank) {
                worstRank = rank;
                worst = trace.state().name();
                worstGap = trace.gap() == null ? null : trace.gap().name();
            }
        }
        return new InquiryResolutionView(worst, worstGap, outcome.entries().size(), withheld, goals);
    }

    /** Least blocking first — the same order {@code CaseFromResolution} reads, kept as tokens for this boundary. */
    public static final List<String> BLOCKING = List.of("RESOLVED", "RESOLVED_CONDITIONAL", "NEEDS_CUSTOMER_INPUT",
            "NEEDS_SELLER", "CAPABILITY_GAP", "FAILED");

    private static Goal goalOf(String goalId, GoalResolution.Trace trace) {
        List<String> consulted = new ArrayList<>();
        List<String> observed = new ArrayList<>();
        Set<String> ask = new LinkedHashSet<>();
        for (ResolverOutcome step : trace.observed()) {
            Resolution r = step.resolution();
            consulted.add(r.capability().wire());
            for (ObservedField field : r.observed()) {
                observed.add(field.field().name() + "=" + field.value());
            }
            r.ask().forEach(input -> ask.add(input.name()));
        }
        return new Goal(goalId, trace.goal().requestedOutcome().name(), trace.goal().subject().name(),
                trace.state().name(), trace.gap() == null ? null : trace.gap().name(),
                consulted, observed, List.copyOf(ask));
    }
}
