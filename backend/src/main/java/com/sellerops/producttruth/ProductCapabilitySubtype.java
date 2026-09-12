package com.sellerops.producttruth;

import java.util.List;

/**
 * A refinement of one capability row, for a channel whose object is really several contracts.
 *
 * <p>NAVER's 문의 is the case that forced this: 상품 문의, 고객 문의 and 톡톡 have different
 * acquisition paths, different answer contracts with non-overlapping identifier spaces, and different
 * evidence. One parent row saying SUPPORTED for all three over-generalises exactly the way this
 * ledger exists to prevent.
 *
 * <p><b>The seller-facing operating object stays 문의.</b> A subtype is a refinement of a row, not a
 * fifth object: it carries no channel, no object and no axis, so nothing can walk subtypes as if they
 * were capability rows, and the 3×4×4 coverage rule does not see them.
 */
public record ProductCapabilitySubtype(
        /** {@code CHANNEL.OBJECT.AXIS.KEY} — the parent's id plus this subtype's key. */
        String id,
        /** Uppercase token, unique inside the parent row. */
        String key,
        /** What a seller calls this. */
        String label,
        ProductCapabilityStatus status,
        ProductCapabilityMode mode,
        ProductEvidence evidence,
        String evidenceRef,
        List<String> sellerFacingNotes,
        List<String> limitations) {
}
