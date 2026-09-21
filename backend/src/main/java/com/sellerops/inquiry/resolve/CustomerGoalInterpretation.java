package com.sellerops.inquiry.resolve;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import java.util.Optional;
import java.util.UUID;

/**
 * <b>Where a {@link CustomerGoalSet} would come from</b> — and the honest fact that today it does not.
 *
 * <p>Reading what a customer asked for is a model's job: {@code customer-goal-interpreter/v3} is frozen and
 * evaluated, and it is the only thing in this repository that can turn a sentence into goals. It has no production
 * caller, so <b>this interface has no production implementation</b>, and a structural test fixes that count at
 * zero. Every workflow below therefore behaves exactly as it did before: the resolution step is skipped, nothing
 * is written, and the absence is visible rather than simulated.
 *
 * <p>The seam exists anyway because the alternative is worse. Without it, wiring the interpreter later means
 * finding every place resolution should have happened; with it, the wiring is one bean. And writing a
 * deterministic keyword interpreter to fill the gap is the exact failure this contract was built to end — a goal
 * is what the customer asked for, and a word list does not read a sentence.
 *
 * <h2>It returns an absence, not an empty set</h2>
 *
 * <p>{@link Optional#empty()} means <b>nobody read this message</b>; an empty {@link CustomerGoalSet} means it was
 * read and asked for nothing. Those settle differently — the first resolves nothing at all, and the second is the
 * {@code NO_GOAL} case, which is a finding. Collapsing them would let "we never looked" be reported as "the
 * customer wanted nothing".
 */
public interface CustomerGoalInterpretation {

    /**
     * The goals this inquiry's message carries, or empty when nothing has read it.
     *
     * <p>Implementations must not throw: a caller in the middle of preparing a draft cannot fail because an
     * interpretation was unavailable, and an unavailable interpretation is an absence like any other.
     */
    Optional<CustomerGoalSet> interpret(UUID orgId, Inquiry inquiry);
}
