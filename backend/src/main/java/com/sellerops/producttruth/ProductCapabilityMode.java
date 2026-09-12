package com.sellerops.producttruth;

import java.util.List;
import java.util.Map;

/**
 * The shape of a capability, per axis. A closed vocabulary so a contradictory row
 * ({@code SUPPORTED} + {@code NONE}, or an execution mode written on an acquisition row) is a load
 * failure rather than a sentence a seller eventually reads.
 */
public enum ProductCapabilityMode {

    // ---- ACQUISITION -------------------------------------------------------------------------
    /** The channel's own API, unattended-capable: a schedule can run it with nobody present. */
    AUTOMATIC,
    /** The seller's own confirmed action on the marketplace — export or Action Window. Repeatable
     *  as often as they choose; nothing arrives on its own. */
    SELLER_GUIDED,
    /** A file the seller hands over. */
    MANUAL_UPLOAD,

    // ---- READ --------------------------------------------------------------------------------
    /** Everything this object means for this channel is readable. */
    FULL_READ,
    /** Readable within a stated boundary; {@code limitations} names it. */
    LIMITED_READ,

    // ---- DRAFT -------------------------------------------------------------------------------
    /** A grounded draft is prepared for the seller. */
    DRAFT_PREPARED,

    // ---- EXECUTION ---------------------------------------------------------------------------
    /** After the seller approves, reviewnary posts it through the channel's API and verifies. */
    DIRECT_WITH_APPROVAL,
    /** After the seller approves, reviewnary fills the channel's own composer; the seller presses
     *  the channel's own submit. */
    GUIDED_WITH_APPROVAL,
    /** reviewnary prepares; the seller carries it to the channel themselves. */
    SELLER_FINAL_SUBMIT,

    // ---- any axis ----------------------------------------------------------------------------
    /** There is no such path. Only ever paired with {@link ProductCapabilityStatus#NOT_SUPPORTED}
     *  or {@link ProductCapabilityStatus#UNKNOWN}. */
    NONE;

    private static final Map<ProductCapabilityAxis, List<ProductCapabilityMode>> ALLOWED = Map.of(
            ProductCapabilityAxis.ACQUISITION, List.of(AUTOMATIC, SELLER_GUIDED, MANUAL_UPLOAD, NONE),
            ProductCapabilityAxis.READ, List.of(FULL_READ, LIMITED_READ, NONE),
            ProductCapabilityAxis.DRAFT, List.of(DRAFT_PREPARED, NONE),
            ProductCapabilityAxis.EXECUTION,
            List.of(DIRECT_WITH_APPROVAL, GUIDED_WITH_APPROVAL, SELLER_FINAL_SUBMIT, NONE));

    /** The modes this axis may carry. */
    public static List<ProductCapabilityMode> allowedOn(ProductCapabilityAxis axis) {
        return ALLOWED.getOrDefault(axis, List.of());
    }
}
