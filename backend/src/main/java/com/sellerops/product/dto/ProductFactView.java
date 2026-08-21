package com.sellerops.product.dto;

import com.sellerops.product.FactConfidence;
import java.time.Instant;

/**
 * One stated product fact as an agent may cite it — value, and where it came from.
 *
 * <p>{@code source}/{@code sourceRef}/{@code observedAt} are not optional decoration: Operator Graph v2
 * treats a product fact as evidence, and the Evidence Judge refuses a sentence resting on a fact whose
 * origin it cannot name. A view that dropped them would be a value an agent could assert and nobody
 * could check.
 */
public record ProductFactView(String factKey, String value, String unit, String source,
                              String sourceRef, Instant observedAt, FactConfidence confidence) {
}
