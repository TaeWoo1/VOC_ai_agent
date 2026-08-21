package com.sellerops.common;

/**
 * Names for the {@code realDataOnly} Hibernate filter declared in {@code package-info}.
 *
 * <p>Applied with {@code @Filter(name = RealDataOnly.NAME, condition = RealDataOnly.CONDITION)} on
 * every entity that can hold manufactured rows. Because the filter is auto-enabled, an annotated
 * entity is excluded from ordinary reads by default and a deployment must opt in to see synthetic
 * data — the safe direction. Reads that must see everything regardless (audit, re-classification,
 * the seeder's own bookkeeping) use {@code findById} or a native query, neither of which a Hibernate
 * filter touches.
 */
public final class RealDataOnly {

    public static final String NAME = "realDataOnly";
    public static final String PARAM = "syntheticVisible";

    /**
     * Rows whose origin is real, plus everything when a demo deployment has opted in.
     *
     * <p>{@code data_origin is null} is deliberately absent: the column is NOT NULL with a REAL
     * default, so there is no third state to accommodate, and admitting one would let an
     * unclassified row through as though it had been vouched for.
     */
    public static final String CONDITION = "(:" + PARAM + " = true or data_origin = 'REAL')";

    private RealDataOnly() {
    }
}
