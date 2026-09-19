package com.sellerops.inquiry.authority;

/** The instance-state fields an ENTITY_STATE step may ask for. Each belongs to exactly one capability. */
public enum EntityField {
    ORDER_PAYMENT(CapabilityId.ENTITY_ORDER),
    ORDER_CANCELLATION(CapabilityId.ENTITY_ORDER),
    ORDER_FULFILLMENT(CapabilityId.ENTITY_ORDER),
    /** Carrier and invoice numbers. No source in this repository reads them: NOT_SUPPORTED on every channel. */
    ORDER_TRACKING(CapabilityId.ENTITY_ORDER),
    LISTING_SALE_STATUS(CapabilityId.ENTITY_LISTING),
    LISTING_OPTION_SALE_STATUS(CapabilityId.ENTITY_LISTING);

    private final CapabilityId capability;

    EntityField(CapabilityId capability) {
        this.capability = capability;
    }

    public CapabilityId capability() {
        return capability;
    }
}
