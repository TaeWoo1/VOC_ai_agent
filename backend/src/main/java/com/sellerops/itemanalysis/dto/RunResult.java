package com.sellerops.itemanalysis.dto;

/** Outcome of a manual batch analyze run: how many items were newly analyzed vs
 *  skipped because an analysis already existed (idempotent skip-if-exists). */
public record RunResult(int analyzed, int skipped) {
}
