package com.sellerops.inquiry.authority;

/** Whether a capability can act for THIS inquiry — decided by code from stored facts, never by a model. */
public enum CapabilityStatus {
    /** It can run now. */
    AVAILABLE,
    /** It exists and is switched off here. */
    DISABLED,
    /** This channel, surface or listing does not provide it (no reader, no field, no listing). */
    NOT_SUPPORTED,
    /** The authority is real and named, and no executor exists yet (every PROCEDURE in v3.0). */
    DECLARED_NO_EXECUTOR
}
