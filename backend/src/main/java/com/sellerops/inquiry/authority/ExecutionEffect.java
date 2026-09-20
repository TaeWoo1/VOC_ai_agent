package com.sellerops.inquiry.authority;

/**
 * <b>What acting on a capability does to the world outside this system</b> — registry metadata, not a planner judgment
 * (Inquiry v3 WP-3).
 *
 * <p>Until WP-3 this was a field of every planned step, and the planner had to say for itself whether a procedure was an
 * external change or a bounded workflow. The 201-call shadow measured what that bought: {@code BOUNDED_WORKFLOW} 38 times
 * against {@code EXTERNAL_STATE_CHANGE} 4, while the frozen gold says {@code EXTERNAL_STATE_CHANGE} for all 7 of its
 * procedure steps — and nothing downstream separated the two. A distinction no caller acts on and no two readers agree
 * about is not a semantic; it is a field.
 *
 * <p>So the division of labour is the one the architecture already states elsewhere: <b>the model says which capability a
 * need requires; the registry says what that capability does.</b> Every capability declares its effect once
 * ({@link CapabilityId#effect()}), and a plan no longer carries one.
 *
 * <p><b>{@link #BOUNDED_WORKFLOW} has no declaring capability in v3.0</b> and {@code AuthorityVocabularyContractTest}
 * pins that count at zero. The token stays because the vocabulary describes what an effect can be, not only what today's
 * seven capabilities are; the test is the switch that has to be flipped deliberately when something declares it.
 */
public enum ExecutionEffect {
    /** Reading. Every KNOWLEDGE, ENTITY_STATE and SELLER capability. */
    NONE,
    /** A change to state this system does not own — an order cancelled, an address rewritten at the marketplace. */
    EXTERNAL_STATE_CHANGE,
    /** A defined business workflow with steps of its own. No capability declares this in v3.0. */
    BOUNDED_WORKFLOW
}
