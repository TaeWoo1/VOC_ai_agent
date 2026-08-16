package com.sellerops.review.triage;

import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The thirteen reason codes of {@code contracts/review-eval/naver/v2/RUBRIC.md} §3.1.
 *
 * <p>Held in Java because three things now need the same list and a drifted copy would be invisible
 * until it had already mis-scored something: the labeling tool's {@code vocabulary.mjs}, the
 * evaluation harness, and the classifier's output schema.
 * {@code TriageReasonCodeTest} pins this enum against the rubric's own table, so the contract stays
 * the declaration and this stays the copy.
 *
 * <p><b>{@link #actionable} describes the code; it does not decide a tier.</b> §3.1 is explicit that
 * a labeler may pair any code with any tier and that a pairing crossing the column is a finding
 * about the rubric, reported and never auto-corrected. 16 of the 218 gold rows do cross it. Anything
 * here that started enforcing the column would silently rewrite those 16 human judgments.
 */
public enum TriageReasonCode {

    DEFECT_OR_DAMAGE(true),
    WRONG_OR_MISSING(true),
    DELIVERY_PROBLEM(true),
    PACKAGING_PROBLEM(true),
    NOT_AS_DESCRIBED(true),
    CANNOT_USE(true),
    EXPLICIT_REQUEST(true),
    PRAISE_WITH_CONCESSION(true),
    PRAISE_ONLY(false),
    CRITIQUE_NO_REQUEST(false),
    NEUTRAL_DESCRIPTION(false),
    TEXTLESS_OR_NOISE(false),
    OFF_TOPIC(false);

    private final boolean actionable;

    TriageReasonCode(boolean actionable) {
        this.actionable = actionable;
    }

    /** Which side of §3.1's description column this code sits on. Descriptive only. */
    public boolean actionable() {
        return actionable;
    }

    public static final Set<String> NAMES =
            java.util.Arrays.stream(values()).map(Enum::name).collect(Collectors.toUnmodifiableSet());

    /** Refuses anything off the list, and never substitutes a default — RUBRIC §8.5. */
    public static Optional<TriageReasonCode> parse(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        for (TriageReasonCode code : values()) {
            if (code.name().equals(raw.strip())) {
                return Optional.of(code);
            }
        }
        return Optional.empty();
    }
}
