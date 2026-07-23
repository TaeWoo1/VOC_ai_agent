package com.sellerops.itemanalysis.dto;

import java.util.List;

/**
 * The outcome of one bounded re-analysis batch — and, with {@code dryRun}, of one bounded
 * PREDICTION of that batch.
 *
 * <p>Deliberately the SAME shape for both, so an operator compares a prediction against an outcome
 * rather than reading two differently-shaped reports and eyeballing the correspondence. The only
 * field that distinguishes them is {@code dryRun} itself.
 *
 * <p>{@code examined} is how many stored analyses this batch looked at; {@code changed} how many
 * produced a different verdict; {@code unchanged} how many recomputed to exactly what was already
 * stored (common and healthy — a version bump rarely moves every row); {@code skipped} how many
 * could not be recomputed at all, which today means an analysis whose source row is gone.
 * {@code remaining} is how many outdated rows are still waiting AFTER this batch, and it is what an
 * operator re-calls against until it reaches zero.
 *
 * <p><b>{@code remaining} is measured differently in the two modes, and the difference is not a
 * defect.</b> After an apply it counts down, because the rows just written are no longer outdated.
 * After a dry run it does NOT, because nothing was written — so a dry run reports the same
 * {@code remaining} however many times it is called. A client must therefore never drive a
 * re-call loop on a dry run: it would not terminate.
 *
 * <p>{@code unrecomputable} is how many outdated rows can NEVER be recomputed — the source row is
 * missing or belongs to another org. They are deliberately absent from {@code remaining}, because a
 * termination count that includes rows no further call can fix does not terminate; they are reported
 * here instead so a residue that will never clear is visible rather than inferred from a number that
 * stops moving.
 *
 * <p>{@code fieldChanges} and {@code categoryTransitions} are the comparison story. The per-field
 * counts say WHAT KIND of change a version bump produced; the transitions say where the category
 * rows moved. That second one is not decoration: categories drive the review-queue facet counts
 * ({@code IngestedReviewVocItemSource}), so a re-analysis re-buckets an operator's facets. Reporting
 * the movement up front is the difference between a change that was decided and one that was
 * discovered.
 *
 * <p>Counts only — no ids, no bodies, no per-row detail. The report is safe to log and to show.
 */
public record ReanalysisResult(
        boolean dryRun,
        int examined,
        int changed,
        int unchanged,
        int skipped,
        long remaining,
        long unrecomputable,
        FieldChanges fieldChanges,
        List<CategoryTransition> categoryTransitions) {

    /**
     * How many rows changed in each derived field. A row can appear in more than one count — one
     * re-analysis may move both category and urgency — so these do NOT sum to {@code changed}.
     */
    public record FieldChanges(int category, int sentiment, int urgency, int recommendedAction) {
    }

    /**
     * One category's population before and after: {@code 배송 12 → 9}.
     *
     * <p>Covers only the rows this batch RECOMPUTED, so it is a statement about the batch and never
     * about the org's whole corpus. A category appears when it had rows before OR after, so a
     * category emptied to zero is still shown — a disappearance is exactly the kind of movement an
     * operator needs to see.
     */
    public record CategoryTransition(String category, int before, int after) {
    }
}
