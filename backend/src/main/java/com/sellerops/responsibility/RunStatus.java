package com.sellerops.responsibility;

/**
 * Status of one logical window's run.
 *
 * <p>{@link #PENDING} exists because a window can be due before it can be worked — it is queued behind a run of
 * the same responsibility that is still RUNNING (R2 forbids overlap). The five the brief names are the other
 * five; {@code PARTIAL}/{@code FAILED} can be re-entered by a retry of the same row.
 */
public enum RunStatus {
    PENDING,
    RUNNING,
    /** Every required source was observed to completion (or to an explicit bound). */
    SUCCESS,
    /** Some source was observed and some was not, or was observed only partly. */
    PARTIAL,
    /** No required source was observed. */
    FAILED,
    /** Not worked — the responsibility was paused/stopped, or the window passed before work started. */
    CANCELLED
}
