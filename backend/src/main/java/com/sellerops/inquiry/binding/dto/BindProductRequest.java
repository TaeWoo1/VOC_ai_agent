package com.sellerops.inquiry.binding.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/**
 * "This inquiry is about this product."
 *
 * @param productId the canonical product, which must belong to the caller's org
 * @param override  required only to replace a binding the SOURCE made. Without it, replacing a
 *                  {@code SOURCE_EXACT} attribution is a 409 rather than a quiet overwrite: the
 *                  channel's own identifier matched a listing, and a person disagreeing with that
 *                  is a decision worth making twice
 */
public record BindProductRequest(@NotNull UUID productId, boolean override) {
}
