package com.sellerops.product.dto;

import java.util.List;

/**
 * The 상품 screen's page: the rows it shows, and how many products the org actually has.
 *
 * <p><b>Both numbers, because they are two facts.</b> The screen used to head itself with the length
 * of the list it happened to receive — 「상품 10개」 over a catalogue of 308, with nothing saying more
 * existed. A page is not a total, and a screen that prints one as the other is not shortening a
 * number, it is stating a false one.
 *
 * @param total how many products this org holds
 * @param rows  the page, ordered by operational weight (see {@code ProductRepository.findOperationalHead})
 */
public record ProductCatalogView(long total, List<ProductSummaryView> rows) {
}
