package com.sellerops.product;

import com.sellerops.ingest.canonical.CanonicalProduct;
import com.sellerops.ingest.canonical.CanonicalProductVariant;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The write side of Product Knowledge: turn {@link CanonicalProduct} rows into listings, variants and
 * facts, idempotently.
 *
 * <p><b>It states nothing of its own.</b> Every row it writes carries the {@code sourceKind} and
 * {@code observedAt} the caller read from the channel, and a null field produces NO fact rather than an
 * empty one — the distinction {@link CanonicalProduct} exists to preserve. The only value this class
 * computes is {@link SellingStatus}, which is a normalization of a token the source stated, not a new
 * claim.
 *
 * <p><b>Product identity comes from the channel, not from the name.</b> A listing is resolved by
 * {@code (channel_id, external_product_id)}; only when the channel row is new does it fall through to
 * {@link ProductService}'s SKU-then-name resolution to decide which SellerOps product it belongs to.
 * That ordering is what stops a renamed listing from splitting its own history — the defect measured in
 * {@code docs/slices/product-context-diagnosis-groundwork.md} §2.
 *
 * <p>Re-reading the same catalogue is a no-op beyond refreshed {@code observedAt}/{@code lastSeenAt},
 * so a scheduled PRODUCT sync and an operator backfill converge on the same state.
 */
@Service
public class ProductKnowledgeWriter {

    private static final Logger log = LoggerFactory.getLogger(ProductKnowledgeWriter.class);

    /** A description longer than this is truncated on a character boundary and marked with an ellipsis. */
    static final int MAX_DESCRIPTION_CHARS = 4000;
    /** Attribute values longer than this are dropped: an "attribute" that long is a description. */
    static final int MAX_ATTRIBUTE_CHARS = 500;

    private final ProductRepository products;
    private final ProductService productService;
    private final ChannelProductRepository channelProducts;
    private final ProductVariantRepository variants;
    private final ProductFactRepository facts;

    public ProductKnowledgeWriter(ProductRepository products, ProductService productService,
                                  ChannelProductRepository channelProducts,
                                  ProductVariantRepository variants, ProductFactRepository facts) {
        this.products = products;
        this.productService = productService;
        this.channelProducts = channelProducts;
        this.variants = variants;
        this.facts = facts;
    }

    /** One page of a channel's catalogue. Returns the SellerOps product ids it touched. */
    @Transactional
    public WriteResult write(UUID orgId, UUID channelId, List<CanonicalProduct> rows) {
        if (rows == null || rows.isEmpty()) {
            return new WriteResult(List.of(), 0, 0, 0);
        }
        List<UUID> touched = new ArrayList<>();
        int listings = 0;
        int variantRows = 0;
        int factRows = 0;
        for (CanonicalProduct row : rows) {
            try {
                Product product = resolve(orgId, channelId, row);
                touched.add(product.getId());
                listings += upsertListing(orgId, channelId, product.getId(), row) ? 1 : 0;
                variantRows += upsertVariants(orgId, channelId, product.getId(), row);
                factRows += upsertFacts(orgId, product.getId(), row);
            } catch (Exception e) {
                // One bad catalogue row must not abort a page. The message is a class name, never the
                // row: a channel product title is seller content and a stack of them is a log dump.
                log.warn("product-knowledge row skipped org={} channel={} cause={}",
                        orgId, channelId, e.getClass().getSimpleName());
            }
        }
        log.info("product-knowledge write org={} channel={} rows={} listings={} variants={} facts={}",
                orgId, channelId, rows.size(), listings, variantRows, factRows);
        return new WriteResult(List.copyOf(touched), listings, variantRows, factRows);
    }

    /**
     * Which SellerOps product a channel listing belongs to.
     *
     * <p>Channel identity first: an existing {@code (channel, external id)} row already answers the
     * question, and re-resolving by name would let a renamed listing migrate to a different product.
     * Only a listing we have never seen falls through to the SKU/name resolution ingest has always used.
     */
    private Product resolve(UUID orgId, UUID channelId, CanonicalProduct row) {
        if (isPresent(row.externalProductId())) {
            var existing = channelProducts.findByChannelIdAndExternalProductId(channelId, row.externalProductId());
            if (existing.isPresent()) {
                UUID productId = existing.get().getProductId();
                Product found = products.findAllByOrgIdAndIdIn(orgId, List.of(productId)).stream()
                        .findFirst().orElse(null);
                if (found != null) {
                    // The listing title is display metadata; a rename updates the listing row, and the
                    // SellerOps product name only fills in when it was never set to anything real.
                    return found;
                }
            }
        }
        // A channel product number IS a SKU for the two channels whose inquiry paths already key on it
        // (Cafe24 product_no, Coupang sku), so preferring the row's own sku and falling back to the
        // external id keeps one product per listing instead of minting a parallel one.
        String sku = isPresent(row.sku()) ? row.sku() : row.externalProductId();
        String name = isPresent(row.name()) ? row.name() : sku;
        return productService.resolveOrCreateWithinTransaction(orgId, name, sku);
    }

    private boolean upsertListing(UUID orgId, UUID channelId, UUID productId, CanonicalProduct row) {
        if (!isPresent(row.externalProductId())) {
            return false;
        }
        Instant observed = row.observedAt() == null ? Instant.now() : row.observedAt();
        ChannelProduct listing = channelProducts
                .findByChannelIdAndExternalProductId(channelId, row.externalProductId())
                .orElseGet(ChannelProduct::new);
        boolean fresh = listing.getId() == null;
        listing.setOrgId(orgId);
        listing.setProductId(productId);
        listing.setChannelId(channelId);
        listing.setExternalProductId(row.externalProductId());
        // Present values overwrite; absent values leave what an earlier, richer read stored. A list
        // endpoint followed by a detail endpoint must not erase the detail.
        if (isPresent(row.name())) {
            listing.setChannelProductName(trim(row.name(), 500));
        }
        if (isPresent(row.productUrl())) {
            listing.setProductUrl(trim(row.productUrl(), 1000));
        }
        if (row.price() != null) {
            listing.setChannelPrice(row.price());
            listing.setCurrency(isPresent(row.currency()) ? row.currency() : "KRW");
        }
        if (isPresent(row.rawSellingStatus())) {
            listing.setSellingStatus(SellingStatus.normalize(row.rawSellingStatus()).name());
        }
        // The channel's DISPLAY id, under the same present-overwrites/absent-preserves rule as the
        // rest: a walk whose detail call failed must not erase an alias an earlier, complete read
        // stored. It is written only, never read back to decide identity — this row is still keyed by
        // externalProductId, and nothing here resolves by the display id.
        if (isPresent(row.externalDisplayProductId())) {
            listing.setExternalDisplayProductId(trim(row.externalDisplayProductId(), 120));
        }
        listing.setSourceKind(row.sourceKind());
        listing.setObservedAt(observed);
        listing.setSourceUpdatedAt(row.sourceUpdatedAt());
        // The observation primitives take the READ time, not the channel's last-changed time. They
        // used to take the latter, which made last_seen_at — the one field whose entire job is
        // "when did we last see this" — report a date the channel chose.
        listing.setLastSeenAt(observed);
        if (fresh || listing.getFirstSeenAt() == null) {
            listing.setFirstSeenAt(observed);
        }
        channelProducts.save(listing);
        return fresh;
    }

    private int upsertVariants(UUID orgId, UUID channelId, UUID productId, CanonicalProduct row) {
        int written = 0;
        Instant observed = row.observedAt() == null ? Instant.now() : row.observedAt();
        for (CanonicalProductVariant v : row.variants()) {
            if (!isPresent(v.externalVariantId())) {
                continue; // No identity ⇒ a re-read would duplicate it. Skipped, not invented.
            }
            ProductVariant entity = variants
                    .findByOrgIdAndProductIdAndExternalVariantId(orgId, productId, v.externalVariantId())
                    .orElseGet(ProductVariant::new);
            entity.setOrgId(orgId);
            entity.setProductId(productId);
            entity.setChannelId(channelId);
            entity.setExternalVariantId(v.externalVariantId());
            if (isPresent(v.optionName())) {
                entity.setOptionName(trim(v.optionName(), 500));
            }
            if (isPresent(v.sku())) {
                entity.setSku(trim(v.sku(), 120));
            }
            if (v.price() != null) {
                entity.setPrice(v.price());
            }
            if (isPresent(v.rawSellingStatus())) {
                entity.setSellingStatus(SellingStatus.normalize(v.rawSellingStatus()).name());
            }
            entity.setSource(row.sourceKind());
            entity.setObservedAt(observed);
            entity.setSourceUpdatedAt(row.sourceUpdatedAt());
            variants.save(entity);
            written++;
        }
        return written;
    }

    private int upsertFacts(UUID orgId, UUID productId, CanonicalProduct row) {
        Instant observed = row.observedAt() == null ? Instant.now() : row.observedAt();
        int written = 0;
        written += fact(orgId, productId, FactKeys.TAXONOMY_BRAND, row.brand(), null, row, observed);
        written += fact(orgId, productId, FactKeys.TAXONOMY_MANUFACTURER, row.manufacturer(), null, row, observed);
        written += fact(orgId, productId, FactKeys.TAXONOMY_CATEGORY, row.category(), null, row, observed);
        written += fact(orgId, productId, FactKeys.DESC_SUMMARY,
                trimDescription(row.description()), null, row, observed);
        for (Map.Entry<String, String> attribute : row.attributes().entrySet()) {
            String value = attribute.getValue();
            if (!isPresent(value) || value.length() > MAX_ATTRIBUTE_CHARS) {
                continue;
            }
            written += fact(orgId, productId, FactKeys.of(FactKeys.SPEC, attribute.getKey()),
                    value, null, row, observed);
        }
        return written;
    }

    private int fact(UUID orgId, UUID productId, String key, String value, String unit,
                     CanonicalProduct row, Instant observed) {
        if (!isPresent(value)) {
            // The whole contract in one line: no source statement ⇒ no fact ⇒ UNAVAILABLE coverage.
            return 0;
        }
        ProductFact entity = facts
                .findByOrgIdAndProductIdAndFactKeyAndSource(orgId, productId, key, row.sourceKind())
                .orElseGet(ProductFact::new);
        entity.setOrgId(orgId);
        entity.setProductId(productId);
        entity.setFactKey(key);
        entity.setFactValue(value.strip());
        entity.setUnit(unit);
        entity.setSource(row.sourceKind());
        entity.setSourceRef(row.externalProductId());
        entity.setObservedAt(observed);
        entity.setSourceUpdatedAt(row.sourceUpdatedAt());
        entity.setConfidence(FactConfidence.SOURCE_STATED);
        facts.save(entity);
        return 1;
    }

    private static String trimDescription(String description) {
        if (!isPresent(description)) {
            return null;
        }
        String text = description.strip();
        return text.length() <= MAX_DESCRIPTION_CHARS
                ? text
                : text.substring(0, MAX_DESCRIPTION_CHARS) + "…";
    }

    private static String trim(String value, int max) {
        String text = value.strip();
        return text.length() <= max ? text : text.substring(0, max);
    }

    private static boolean isPresent(String value) {
        return value != null && !value.isBlank();
    }

    /**
     * Replace the facts ONE source states about one product with {@code keyed} (full fact key → value): each is upserted,
     * and every other fact this source had stated about this product is removed. For a source that re-reads the whole
     * statement set each time (a listing's detail) — what it no longer says, it no longer claims. Facts from every
     * other source are untouched. Returns the number written.
     */
    @Transactional
    public int replaceFacts(UUID orgId, UUID productId, String source, String sourceRef, Map<String, String> keyed,
                            Instant observedAt, Instant sourceUpdatedAt) {
        CanonicalProduct row = new CanonicalProduct(sourceRef, null, null, null, null, null, null, null, null, null,
                null, Map.of(), List.of(), observedAt, sourceUpdatedAt, source, 1, null);
        int written = 0;
        java.util.Set<String> kept = new java.util.HashSet<>();
        for (Map.Entry<String, String> e : keyed.entrySet()) {
            String value = e.getValue();
            if (!isPresent(e.getKey()) || !isPresent(value) || value.length() > MAX_ATTRIBUTE_CHARS
                    || e.getKey().length() > 120) {
                continue;
            }
            written += fact(orgId, productId, e.getKey(), value, null, row, observedAt);
            kept.add(e.getKey());
        }
        for (ProductFact existing : facts.findByOrgIdAndProductId(orgId, productId)) {
            if (source.equals(existing.getSource()) && !kept.contains(existing.getFactKey())) {
                facts.delete(existing);
            }
        }
        return written;
    }

    /**
     * Mark this channel's variants of one product that a complete option read no longer lists as {@code ENDED}. Never a
     * delete: a seller's knowledge may be scoped to a variant ({@code variant_id} is a foreign key), and a 규격 that
     * stopped being sold is still the 규격 that knowledge was written about. Returns the number retired.
     */
    @Transactional
    public int retireVariantsNotIn(UUID orgId, UUID productId, UUID channelId, java.util.Set<String> listedIds) {
        int retired = 0;
        for (ProductVariant v : variants.findByOrgIdAndProductId(orgId, productId)) {
            if (channelId.equals(v.getChannelId()) && v.getExternalVariantId() != null
                    && !listedIds.contains(v.getExternalVariantId())
                    && SellingStatus.normalize(v.getSellingStatus()) != SellingStatus.ENDED) {
                v.setSellingStatus(SellingStatus.ENDED.name());
                variants.save(v);
                retired++;
            }
        }
        return retired;
    }

    /** Sanitized tally — ids the caller may need for follow-up, and counts. Never a title. */
    public record WriteResult(List<UUID> productIds, int newListings, int variants, int facts) {
    }
}
