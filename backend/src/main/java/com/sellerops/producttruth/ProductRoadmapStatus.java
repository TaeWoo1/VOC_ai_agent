package com.sellerops.producttruth;

/** How committed a roadmap item is. None of these is a current capability. */
public enum ProductRoadmapStatus {
    /** Decided and intended; not built. */
    PLANNED,
    /** Being investigated; the decision has not been made. */
    EXPLORING,
    /** Written down so it is not re-proposed as new. Explicitly not committed to. */
    NOT_COMMITTED,
}
