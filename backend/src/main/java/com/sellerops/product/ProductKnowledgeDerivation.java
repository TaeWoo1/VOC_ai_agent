package com.sellerops.product;

import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Product Knowledge assembled from rows SellerOps ALREADY HAS — no channel call, no credential, no
 * marketplace contact.
 *
 * <p><b>Why it exists beside the real PRODUCT connectors.</b> Two reasons, both measured. First, a
 * channel may have no PRODUCT read enabled for an org (a scope not yet re-consented, a connector flag
 * off), and a product with reviews and inquiries but no catalogue read should still be identifiable.
 * Second — and this is the one live proof forced — <b>re-collection cannot fill a derived state for an
 * existing seller</b>: ingest is idempotent, so {@code insertedIds} is empty and every follow-up is a
 * no-op. That is why {@code CustomerMemoryIndexer.backfill} had to exist, and it is why this class is
 * reachable from an operator backfill rather than only from ingest.
 *
 * <p><b>Everything it writes is honest about being derived.</b> A listing derived here records
 * {@code source_kind = DERIVED:INGEST} and carries NO price, NO url and NO selling status — because
 * nothing in the ingested rows states them, and {@code KnowledgeCoverage.UNAVAILABLE} is the true
 * answer for those facets. A variant derived here is an option a customer actually bought, which is a
 * weaker claim than a catalogue option list and is stored as such.
 */
@Service
public class ProductKnowledgeDerivation {

    private static final Logger log = LoggerFactory.getLogger(ProductKnowledgeDerivation.class);

    /** The provenance stamp every row this class writes carries. */
    public static final String SOURCE = "DERIVED:INGEST";
    /** Title-parsed specs get their own stamp, so a reader can tell them from channel-stated ones. */
    public static final String TITLE_SOURCE = "DERIVED:TITLE";

    static final int MAX_PAGE = 500;

    private final ProductRepository products;
    private final ChannelProductRepository channelProducts;
    private final ProductVariantRepository variants;
    private final ProductFactRepository facts;
    private final ReviewRepository reviews;
    private final InquiryRepository inquiries;

    public ProductKnowledgeDerivation(ProductRepository products, ChannelProductRepository channelProducts,
                                      ProductVariantRepository variants, ProductFactRepository facts,
                                      ReviewRepository reviews, InquiryRepository inquiries) {
        this.products = products;
        this.channelProducts = channelProducts;
        this.variants = variants;
        this.facts = facts;
        this.reviews = reviews;
        this.inquiries = inquiries;
    }

    /**
     * One bounded, idempotent pass over an org's catalogue. Page until {@code scanned < limit}.
     *
     * <p>Ordered by product id so paging is stable while the catalogue grows underneath it — the same
     * discipline {@code CustomerMemoryIndexer.backfill} follows and for the same reason.
     */
    @Transactional
    public DerivationResult derive(UUID orgId, int limit, int page) {
        int safeLimit = Math.min(Math.max(limit, 1), MAX_PAGE);
        List<Product> batch = products.findAllByOrgId(orgId).stream()
                .sorted(java.util.Comparator.comparing(Product::getId))
                .skip((long) Math.max(page, 0) * safeLimit)
                .limit(safeLimit)
                .toList();
        if (batch.isEmpty()) {
            return new DerivationResult(0, 0, 0, 0);
        }
        List<UUID> ids = batch.stream().map(Product::getId).toList();
        Map<UUID, Map<UUID, Instant>> observations = observationsFor(orgId, ids);

        int listings = 0;
        int variantRows = 0;
        int factRows = 0;
        for (Product product : batch) {
            listings += deriveListings(orgId, product, observations.getOrDefault(product.getId(), Map.of()));
            variantRows += deriveVariants(orgId, product);
            factRows += deriveTitleFacts(orgId, product);
        }
        log.info("product-knowledge derive org={} page={} scanned={} listings={} variants={} facts={}",
                orgId, page, batch.size(), listings, variantRows, factRows);
        return new DerivationResult(batch.size(), listings, variantRows, factRows);
    }

    /** product → channel → newest observed row date, from both corpora. */
    private Map<UUID, Map<UUID, Instant>> observationsFor(UUID orgId, List<UUID> productIds) {
        Map<UUID, Map<UUID, Instant>> out = new HashMap<>();
        // Both queries group by (channel, product) but project (channel, max) — so each product is asked
        // for individually rather than trusting a two-column projection to carry three facts.
        for (UUID productId : productIds) {
            Map<UUID, Instant> byChannel = new HashMap<>();
            for (UUID channelId : reviews.distinctChannelIdsByProduct(orgId, productId)) {
                byChannel.putIfAbsent(channelId, null);
            }
            for (UUID channelId : inquiries.distinctChannelIdsByProduct(orgId, productId)) {
                byChannel.putIfAbsent(channelId, null);
            }
            out.put(productId, byChannel);
        }
        return out;
    }

    private int deriveListings(UUID orgId, Product product, Map<UUID, Instant> channels) {
        String externalId = product.getSku();
        if (externalId == null || externalId.isBlank()) {
            // No channel-side identifier ⇒ no listing identity ⇒ nothing derivable. The product still
            // exists and its IDENTITY facet is AVAILABLE; LISTING stays UNAVAILABLE, honestly.
            return 0;
        }
        // Channels a real catalogue read already described. A derivation must not add a SECOND listing
        // beside a real one: the two are keyed differently (a channel product number vs the seller's own
        // code), so a naive upsert produces two rows for one listing and the product then reports
        // PARTIAL coverage of a listing it actually knows completely. Caught by
        // ProductKnowledgeCoverageTest before it could reach a seller.
        java.util.Set<UUID> alreadyRead = channelProducts.findByOrgIdAndProductId(orgId, product.getId())
                .stream()
                .filter(l -> !SOURCE.equals(l.getSourceKind()))
                .map(ChannelProduct::getChannelId)
                .collect(java.util.stream.Collectors.toSet());
        int written = 0;
        Instant now = Instant.now();
        for (UUID channelId : channels.keySet()) {
            if (alreadyRead.contains(channelId)) {
                continue;
            }
            ChannelProduct listing = channelProducts
                    .findByChannelIdAndExternalProductId(channelId, externalId)
                    .orElseGet(ChannelProduct::new);
            if (listing.getId() != null && !SOURCE.equals(listing.getSourceKind())) {
                // A real PRODUCT read already described this listing. A derivation must never overwrite
                // a channel-stated row with a weaker one.
                continue;
            }
            boolean fresh = listing.getId() == null;
            listing.setOrgId(orgId);
            listing.setProductId(product.getId());
            listing.setChannelId(channelId);
            listing.setExternalProductId(externalId);
            listing.setSourceKind(SOURCE);
            listing.setObservedAt(now);
            listing.setLastSeenAt(now);
            if (listing.getFirstSeenAt() == null) {
                listing.setFirstSeenAt(now);
            }
            // Deliberately absent: name, url, price, selling status. Nothing ingested states them.
            channelProducts.save(listing);
            written += fresh ? 1 : 0;
        }
        return written;
    }

    private int deriveVariants(UUID orgId, Product product) {
        int written = 0;
        Instant now = Instant.now();
        for (Object[] row : reviews.distinctOptionsByProduct(orgId, product.getId())) {
            UUID channelId = (UUID) row[0];
            String optionId = (String) row[1];
            if (optionId == null || optionId.isBlank()) {
                continue;
            }
            ProductVariant existing = variants
                    .findByOrgIdAndProductIdAndExternalVariantId(orgId, product.getId(), optionId)
                    .orElseGet(ProductVariant::new);
            if (existing.getId() != null && !SOURCE.equals(existing.getSource())) {
                continue; // A catalogue read wins over "someone bought this option".
            }
            boolean fresh = existing.getId() == null;
            existing.setOrgId(orgId);
            existing.setProductId(product.getId());
            existing.setChannelId(channelId);
            existing.setExternalVariantId(optionId);
            // No option NAME: the review row carries an id, not a label. Naming it would be invention.
            existing.setSource(SOURCE);
            existing.setObservedAt(now);
            variants.save(existing);
            written += fresh ? 1 : 0;
        }
        return written;
    }

    private int deriveTitleFacts(UUID orgId, Product product) {
        Map<String, ProductTitleFacts.Measure> parsed = ProductTitleFacts.parse(product.getName());
        if (parsed.isEmpty()) {
            return 0;
        }
        Instant now = Instant.now();
        int written = 0;
        for (Map.Entry<String, ProductTitleFacts.Measure> entry : parsed.entrySet()) {
            String key = FactKeys.of(FactKeys.SPEC, entry.getKey());
            ProductFact fact = facts
                    .findByOrgIdAndProductIdAndFactKeyAndSource(orgId, product.getId(), key, TITLE_SOURCE)
                    .orElseGet(ProductFact::new);
            fact.setOrgId(orgId);
            fact.setProductId(product.getId());
            fact.setFactKey(key);
            fact.setFactValue(entry.getValue().value());
            fact.setUnit(entry.getValue().unit());
            fact.setSource(TITLE_SOURCE);
            fact.setSourceRef(product.getSku());
            fact.setObservedAt(now);
            // A parse of what the seller wrote, not a channel statement, and never an inference.
            fact.setConfidence(FactConfidence.DERIVED);
            facts.save(fact);
            written++;
        }
        return written;
    }

    /** One bounded pass. {@code scanned < limit} means the catalogue is exhausted. */
    public record DerivationResult(int scanned, int listings, int variants, int facts) {
    }

    /** Page size a caller with no preference should use. */
    public static PageRequest defaultPage(int page) {
        return PageRequest.of(Math.max(page, 0), 200);
    }
}
