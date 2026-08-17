package com.sellerops.review.triage.feedback;

/**
 * The reading of a correction, and the separation this whole spine exists for.
 *
 * <p>The correction row is <b>byte-identical</b> in both cases. A 배송 지연 review that one seller
 * triages as urgent and another treats as noise produces exactly the same
 * {@code review_triage_corrections} row. Nothing in the data distinguishes them, so nothing
 * automatic can, and a heuristic that guessed would let one seller's preference become the global
 * classifier's definition of accuracy.
 *
 * <p>Assigned by a person holding the rubric. That is a cost, and it is the cost of the guarantee.
 */
public enum CorrectionDispositionKind {

    /**
     * The rubric says X, the classifier said Y, the seller said X. Accumulates into a frozen,
     * numbered feedback snapshot used to evaluate the NEXT classifier version offline — never to
     * train the running one, and never as a gold label
     * ({@code contracts/review-eval/naver/v2/RUBRIC.md} §9: a human confirming a label a model
     * showed them measures agreement with the model, and that does not become untrue because the
     * human is a customer).
     */
    CLASSIFIER_ERROR,

    /**
     * The rubric says X and this seller wants Y for their own catalog. Recorded, scoped to that
     * seller, and kept out of the global gold set. Acting on it is a product that does not exist
     * yet; recording it is required either way, because a preference silently filed as an error is
     * how a classifier drifts toward whoever complained most.
     */
    SELLER_PREFERENCE
}
