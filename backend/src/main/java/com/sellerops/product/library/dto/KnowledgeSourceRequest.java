package com.sellerops.product.library.dto;

import com.sellerops.product.library.KnowledgeSourceType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/**
 * What the seller submits. Validation is here so an empty document can never be indexed.
 *
 * <p>{@code variantId} is the id of one of THIS product's stored variants, or null for 전체 상품
 * 공통. It is deliberately an id and not a name: the service rejects a variant that does not belong
 * to the product, so a scope can only ever be one the channel itself stated.
 */
public record KnowledgeSourceRequest(@NotNull KnowledgeSourceType sourceType,
                                     @NotBlank @Size(max = 200) String title,
                                     @NotBlank @Size(max = 40_000) String body,
                                     @Size(max = 1000) String sourceUrl,
                                     UUID variantId) {

    /** Back-compat for callers written before knowledge had a 규격 scope: product-level. */
    public KnowledgeSourceRequest(KnowledgeSourceType sourceType, String title, String body,
                                  String sourceUrl) {
        this(sourceType, title, body, sourceUrl, null);
    }
}
