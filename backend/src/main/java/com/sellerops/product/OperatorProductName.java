package com.sellerops.product;

/**
 * Whether a product has a name worth showing an operator, and what that name is.
 *
 * <p>Extracted so the two operator surfaces that resolve a product display name — the attention
 * drill-down row and the reply-preparation panel — share ONE rule. They make the same promise (a
 * display name, never an identifier) about the same rows, and two copies of a rule this subtle drift
 * apart silently: the drifted surface keeps rendering, it just starts rendering a SKU.
 *
 * <p><b>The guarantee is the OPERATOR SURFACES', not the product model's.</b> Ingest keeps minting
 * SKU-named rows and other surfaces (the inbox feed, the product catalog) keep showing them. This
 * decides only what an operator-facing VOC surface may display.
 */
public final class OperatorProductName {

    /**
     * Ingest's fallback product name, filtered back out on read.
     *
     * <p>An export row with neither 상품명 nor 상품번호 still has to resolve to a product, so
     * {@code ReviewRowMapper}/{@code ProductService} mint this placeholder. It is an ingest artifact,
     * not a product: {@code ProductService} resolves it by name, so EVERY nameless row in an org
     * collapses onto one shared row. Surfacing it would show an operator a "product" that is really a
     * bucket of unrelated reviews.
     *
     * <p>Still duplicated from ingest rather than shared with it — the literal appears at several
     * main-source sites and there is nothing canonical to reuse — but now duplicated ONCE for the
     * read side instead of once per surface. {@code ExportToAttentionChainTest} pins it by uploading a
     * real nameless export, so a change to ingest's literal fails loudly rather than leaving this
     * filter silently matching nothing.
     */
    public static final String UNSPECIFIED_PRODUCT_NAME = "(미지정 상품)";

    private OperatorProductName() {
    }

    /**
     * The product's operator-facing display name, or {@code null} when none can be shown honestly.
     *
     * <p>Rejects three states, all meaning "no name is actually known":
     *
     * <ul>
     *   <li><b>null/blank</b> — nothing to show.
     *   <li><b>{@link #UNSPECIFIED_PRODUCT_NAME}</b> — ingest's placeholder; an artifact, not a name.
     *   <li><b>name equal to sku</b> — <b>the load-bearing one.</b> When an ingested row has a SKU but
     *       no name, {@code ProductService.resolveOrCreate} stores the SKU AS the name
     *       ({@code name != null && !name.isBlank() ? name : sku}), and the inquiry mappers pass a
     *       null name whenever a sku exists — so this state is produced by normal operation, not by
     *       bad data. Without this branch the "display name" IS the SKU (상품번호, i.e. the channel's
     *       {@code productNo}), and the identifier these surfaces exclude would reach operators
     *       through the one field claiming never to carry it. Compared on trimmed values because
     *       ingest strips on the way in ({@code HeaderAliases.pick}) and a stored legacy value may not.
     * </ul>
     *
     * <p>A product with a real name and no sku IS displayable — absent identity is not a reason to
     * withhold a name.
     *
     * <p>Returns the TRIMMED name. The predicate this replaced already compared on trimmed values but
     * returned the raw one, so a stored {@code "  가디건  "} reached the DTO with its padding; both
     * operator surfaces trim for display anyway, so nothing renders differently — the contract ("a
     * real name or an honest null") simply now holds on the value itself rather than on what the
     * client does to it.
     */
    public static String displayNameOrNull(Product product) {
        if (product == null) {
            return null;
        }
        String name = product.getName();
        if (name == null || name.isBlank()) {
            return null;
        }
        String trimmed = name.strip();
        if (UNSPECIFIED_PRODUCT_NAME.equals(trimmed)) {
            return null;
        }
        String sku = product.getSku();
        if (sku != null && !sku.isBlank() && trimmed.equals(sku.strip())) {
            return null;
        }
        return trimmed;
    }
}
