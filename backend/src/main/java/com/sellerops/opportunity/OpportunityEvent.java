package com.sellerops.opportunity;

/**
 * One thing a seller did about a derived opportunity — the closed vocabulary of
 * {@code improvement_opportunity_event.event}.
 *
 * <p><b>These are decisions, not outcomes.</b> None of them says the problem changed, that anything
 * was sent, or that the action worked. {@code ACCEPTED} means «prepare this»; it does not mean the
 * FAQ was written. What happened to the problem itself is the issue lifecycle's to say, and this
 * vocabulary deliberately has no word that could be mistaken for it.
 *
 * <p>{@code EDITED} is the odd one: it leaves the status where it was. It is here because the seller
 * rewriting the prepared text is a thing they did, and a trail that recorded only status changes
 * would say a draft was «준비됨» on a date and never that the seller made it theirs.
 */
public enum OpportunityEvent {
    /** The seller asked for this action to be prepared. */
    ACCEPTED("채택"),
    /** The seller rewrote the prepared text. Status unchanged. */
    EDITED("수정"),
    /** 지금은 보류 — not now. */
    DISMISSED("보류"),
    /** The seller took their decision back; the opportunity is open again. */
    REOPENED("되돌림");

    private final String labelKo;

    OpportunityEvent(String labelKo) {
        this.labelKo = labelKo;
    }

    public String labelKo() {
        return labelKo;
    }
}
