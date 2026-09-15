package com.sellerops.responsibility;

/**
 * Why a run exists. {@link #SCHEDULED} is the only trigger no person caused — the acceptance proof counts those.
 */
public enum RunTrigger {
    /** The seller activated the responsibility; its current window is worked once, immediately. */
    ACTIVATION,
    /** The scheduler reached a window boundary. */
    SCHEDULED,
    /** The seller resumed a paused responsibility; its current window is worked. */
    RESUME
}
