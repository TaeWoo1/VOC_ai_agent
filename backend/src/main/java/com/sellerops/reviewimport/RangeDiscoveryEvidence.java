package com.sellerops.reviewimport;

/**
 * How the historical range available in the marketplace was established.
 *
 * <p>Stored rather than inferred because the two are not equally strong and flattening them would let a
 * human's confirmation be presented as something SellerOps verified. Nothing that surfaces this value
 * may describe {@link #OPERATOR_CONFIRMED} as machine-verified.
 */
public enum RangeDiscoveryEvidence {

    /**
     * SellerOps read the available range off the live seller-center controls itself (date input bounds,
     * disabled calendar dates, or a range-limit notice).
     */
    MACHINE_DISCOVERED,

    /**
     * SellerOps could not read the range, so the guided tutorial asked the seller to select the earliest
     * and latest dates the marketplace allowed and confirm them. A human assertion, not a measurement.
     */
    OPERATOR_CONFIRMED
}
