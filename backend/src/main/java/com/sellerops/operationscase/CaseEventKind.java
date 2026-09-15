package com.sellerops.operationscase;

/** The closed vocabulary of {@code operations_case_event.kind}. */
public enum CaseEventKind {
    /** A new case, with the rule or agent conclusion it was written with. */
    OPENED,
    /** The subject's observed state changed under an open case; the case was updated rather than duplicated. */
    CONTEXT_UPDATED,
    /** The investigator produced a schema-valid conclusion (provenance carries model, versions, tools, usage). */
    INVESTIGATED,
    /** Investigation was needed and did not produce a conclusion; the case fell back to the seller. */
    INVESTIGATION_FAILED,
    /** Investigation was needed and was not attempted (capability off for the org, budget spent). */
    INVESTIGATION_SKIPPED,
    /** A reply draft was written through the existing production draft path. It is not an approval. */
    DRAFT_PREPARED,
    /** The draft path was asked and wrote nothing (no answer basis, draft capability off, refused). */
    DRAFT_NOT_PREPARED,
    /** A gap's source failed again for the same reason in a later run — the same case, not a new one. */
    OBSERVED_AGAIN,
    /** A gap's source was read completely again; the gap is closed. */
    RECOVERED,
    /** The reconciler read a seller action on the canonical record. */
    SELLER_ACTED,
    /** The reconciler closed the case from canonical truth (answered elsewhere, gone, excluded, watch ended). */
    RECONCILED_CLOSED,
    /** The case was included in the run's one exception summary mail. */
    NOTIFIED
}
