package com.sellerops.reviewissue;

/** Who performed a lifecycle transition. Stored on {@code review_issue_state_events.actor}. */
public enum IssueStateActor {

    /**
     * SellerOps. May only perform the transitions {@link IssueLifecycleState#systemMayTransitionTo}
     * allows — everything else requires a person, because SellerOps cannot know that work was done.
     */
    SYSTEM,
    /** The seller/operator. */
    OPERATOR
}
