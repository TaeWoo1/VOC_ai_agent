package com.sellerops.inquiry.authority;

/**
 * A value a resolution step may need from the customer. Not an authority: the customer supplies a fact, a KNOWLEDGE or
 * ENTITY step closes the need with it.
 *
 * <p><b>Product-owner decision 2026-09-20:</b> on public marketplace Q&A only non-sensitive product context may be asked;
 * identity is never asked there. v3.0 goes one step further and asks identity nowhere — no surface has an authenticated
 * order relation this code can check, and a need that requires an order identity it does not have ends as
 * {@link GapReason#UNBOUND}, routed to the seller.
 */
public enum CustomerInput {
    OPTION(Kind.PRODUCT_CONTEXT),
    SIZE(Kind.PRODUCT_CONTEXT),
    MODEL(Kind.PRODUCT_CONTEXT),
    QUANTITY(Kind.PRODUCT_CONTEXT),
    USE_CONTEXT(Kind.PRODUCT_CONTEXT),
    MEASUREMENT(Kind.PRODUCT_CONTEXT),
    /**
     * A product-context value the v2 judge named in free text only — the bridge cannot say which one, and does not
     * guess. A v3 plan names a specific input; the plan gold never uses this value.
     */
    UNNAMED_PRODUCT_CONTEXT(Kind.PRODUCT_CONTEXT),
    ORDER_NUMBER(Kind.IDENTITY),
    PHONE(Kind.IDENTITY),
    ADDRESS(Kind.IDENTITY),
    EMAIL(Kind.IDENTITY),
    NAME(Kind.IDENTITY);

    public enum Kind { PRODUCT_CONTEXT, IDENTITY }

    private final Kind kind;

    CustomerInput(Kind kind) {
        this.kind = kind;
    }

    public Kind kind() {
        return kind;
    }

    /** Whether this input may be asked of the customer on this surface. Identity: never, on any surface, in v3.0. */
    public boolean askableOn(InquirySurface surface) {
        return kind == Kind.PRODUCT_CONTEXT && surface != null;
    }
}
