package com.sellerops.product.detail;

import com.sellerops.connector.naver.NaverProductDetail;
import com.sellerops.ingest.canonical.CanonicalProduct;
import com.sellerops.ingest.canonical.CanonicalProductVariant;
import com.sellerops.product.ProductKnowledgeWriter;
import com.sellerops.product.library.KnowledgeAuthorship;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeIndexer;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Turn ONE listing's 상세페이지 into knowledge a reply can be grounded in.
 *
 * <p><b>Never the whole catalogue.</b> The structure this class exists to forbid is "read every
 * product's detail on every sweep": 69 listings × a daily sweep is 25,000 requests a year to
 * re-observe pages that mostly did not change, and it would put a per-product marketplace read on the
 * critical path of routine collection. So enrichment is per-product, gated by
 * {@link #isStale(ProductKnowledgeSource, Instant)}, and the caller passes one product id.
 *
 * <p><b>The three triggers are equals, not a priority order</b> (product-owner, 2026-08-26): a new or
 * changed product, an actionable inquiry whose product is exactly attributed, or product detail
 * knowledge that is missing or stale. Any one of them is reason enough, and none of them is reason to
 * read a second product.
 *
 * <p><b>What it writes, and the one copy rule.</b> The detail TEXT becomes a
 * {@link ProductKnowledgeSource} — the retrievable corpus, marked
 * {@link KnowledgeAuthorship#SELLER_AUTHORED_CHANNEL_CONTENT} because the seller wrote it on their own
 * listing. It is deliberately NOT also written as a {@code desc:summary} product fact: the same
 * sentences living in two stores is how a citation starts pointing at a copy that has drifted. The
 * OPTIONS go the other way — through the existing {@link ProductKnowledgeWriter}, which is a tested,
 * non-destructive upsert ("a list endpoint followed by a detail endpoint must not erase the detail")
 * — because variants are what make {@code SpecApplicability.VARIANT_NAMED} reachable on NAVER at all.
 *
 * <p><b>Images are recorded, not read.</b> {@link DetailContentShape} measures whether the page
 * carries its answers as text; when it does not, this class says so and stops. Building image
 * understanding for a page whose prose was never searched is the expensive way to answer a question
 * nobody asked — so the measurement comes first and the decision follows it.
 */
@Service
public class ProductDetailEnrichment {

    private static final Logger log = LoggerFactory.getLogger(ProductDetailEnrichment.class);

    /** Detail knowledge older than this is re-read when a trigger fires. Not a schedule. */
    static final Duration STALE_AFTER = Duration.ofDays(30);

    /** The title every channel-derived detail document carries. Stable, so a re-read updates it. */
    static final String DOCUMENT_TITLE = "상품 상세페이지";

    /** Longer than this is truncated on a character boundary, marked, and reported. */
    static final int MAX_BODY_CHARS = 20_000;

    private final ProductKnowledgeSourceRepository sources;
    private final ProductKnowledgeWriter catalogue;
    private final ProductKnowledgeIndexer indexer;

    public ProductDetailEnrichment(ProductKnowledgeSourceRepository sources,
                                   ProductKnowledgeWriter catalogue,
                                   ProductKnowledgeIndexer indexer) {
        this.sources = sources;
        this.catalogue = catalogue;
        this.indexer = indexer;
    }

    /** Why an enrichment ended the way it did. A closed set, so a caller can report without prose. */
    public enum Outcome {
        /** Text was written or refreshed, and it is retrievable. */
        TEXT_INDEXED,
        /** The page carries its answers in pictures. Nothing was indexed; nothing was invented. */
        IMAGE_ONLY,
        /** The channel returned no detail content at all. */
        EMPTY,
        /** Detail knowledge is present and fresh — no request was made. */
        FRESH_ALREADY
    }

    /**
     * The result. Carries the measurement so a later reader can re-check the verdict rather than
     * trust it, and the option count because that is the other half of what this read is for.
     */
    public record Result(Outcome outcome, DetailContentShape.Measurement measurement,
                         int optionsWritten, int imageCount) {
    }

    /**
     * Does this product need its detail read?
     *
     * <p>Missing is stale; older than {@link #STALE_AFTER} is stale; anything else is not. A caller
     * that ignores this and enriches anyway is not prevented — the gate is here so that the ordinary
     * path is the bounded one, not so that the class can police its callers.
     */
    @Transactional(readOnly = true)
    public boolean needsEnrichment(UUID orgId, UUID productId, Instant now) {
        return isStale(existingDocument(orgId, productId).orElse(null), now);
    }

    static boolean isStale(ProductKnowledgeSource existing, Instant now) {
        if (existing == null) {
            return true;
        }
        Instant updated = existing.getUpdatedAt();
        return updated == null || updated.isBefore(now.minus(STALE_AFTER));
    }

    /**
     * Apply one already-fetched listing detail. <b>Makes no marketplace call itself</b> — the caller
     * owns the request, which is what keeps "how many reads happened" answerable at the call site
     * rather than buried behind a service that might or might not have hit the network.
     */
    @Transactional
    public Result apply(UUID orgId, UUID channelId, UUID productId, String externalProductId,
                        String sourceKind, NaverProductDetail detail, Instant observedAt) {
        DetailContentShape.Measurement measurement =
                DetailContentShape.classify(detail == null ? null : detail.detailContent());
        int imageCount = detail == null || detail.imageUrls() == null ? 0 : detail.imageUrls().size();
        int options = writeOptions(orgId, channelId, externalProductId, sourceKind, detail, observedAt);

        if (measurement.shape() == DetailContentShape.Shape.EMPTY) {
            log.info("product-detail enrichment org={} outcome=EMPTY {} images={} options={}",
                    orgId, DetailContentShape.describe(measurement), imageCount, options);
            return new Result(Outcome.EMPTY, measurement, options, imageCount);
        }
        if (!measurement.textIsEnough()) {
            // The honest stop. The page's answers are in its pictures, and reading pictures is a
            // capability SellerOps does not have — saying so is more useful than indexing the
            // 40 characters of shop notice that surround the images.
            log.info("product-detail enrichment org={} outcome=IMAGE_ONLY {} images={} options={}",
                    orgId, DetailContentShape.describe(measurement), imageCount, options);
            return new Result(Outcome.IMAGE_ONLY, measurement, options, imageCount);
        }

        String body = DetailContentShape.plainText(detail.detailContent());
        boolean truncated = body.length() > MAX_BODY_CHARS;
        if (truncated) {
            body = body.substring(0, MAX_BODY_CHARS) + "…";
        }
        upsertDocument(orgId, productId, channelRef(sourceKind, externalProductId), body);
        log.info("product-detail enrichment org={} outcome=TEXT_INDEXED {} images={} options={} "
                        + "truncated={}",
                orgId, DetailContentShape.describe(measurement), imageCount, options, truncated);
        return new Result(Outcome.TEXT_INDEXED, measurement, options, imageCount);
    }

    /**
     * One document per (product, channel listing), found by its own reference rather than by title.
     *
     * <p>Keying on {@code channel_source_ref} is what makes a re-read an UPDATE. Keying on the title
     * would collide with a seller who happens to have typed a note called 「상품 상세페이지」, and
     * silently overwriting a person's own writing with a machine's import is the one failure this
     * lane must not have.
     */
    private void upsertDocument(UUID orgId, UUID productId, String channelRef, String body) {
        ProductKnowledgeSource source = existingDocument(orgId, productId)
                .orElseGet(ProductKnowledgeSource::new);
        source.setOrgId(orgId);
        source.setProductId(productId);
        source.setSourceType(KnowledgeSourceType.DESCRIPTION);
        source.setAuthoredOrigin(KnowledgeAuthorship.SELLER_AUTHORED_CHANNEL_CONTENT);
        source.setChannelSourceRef(channelRef);
        source.setTitle(DOCUMENT_TITLE);
        source.setBody(body);
        // authorName stays null on purpose: nobody at this company typed this, and filling the field
        // with a channel name would put a machine in a column that names people.
        ProductKnowledgeSource saved = sources.save(source);
        // AND the passages. Retrieval reads chunks, never sources — without this the outcome said
        // TEXT_INDEXED while the document was unreachable by every question a seller could ask.
        indexer.index(saved);
    }

    private Optional<ProductKnowledgeSource> existingDocument(UUID orgId, UUID productId) {
        return sources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(orgId, productId).stream()
                .filter(s -> s.getAuthoredOrigin() == KnowledgeAuthorship.SELLER_AUTHORED_CHANNEL_CONTENT)
                .findFirst();
    }

    /**
     * Options through the catalogue writer — the tested, non-destructive upsert.
     *
     * <p>An option with no external id is skipped by that writer rather than given a synthetic one,
     * and that is the correct behaviour here: the reference elides the option sub-structure, so the
     * id's presence is doc-inferred, and a variant that gets a fresh identity on every read is silent
     * duplication.
     */
    private int writeOptions(UUID orgId, UUID channelId, String externalProductId, String sourceKind,
                             NaverProductDetail detail, Instant observedAt) {
        if (detail == null || detail.options() == null || detail.options().isEmpty()) {
            return 0;
        }
        List<CanonicalProductVariant> variants = new ArrayList<>();
        for (NaverProductDetail.Option option : detail.options()) {
            variants.add(new CanonicalProductVariant(option.externalId(), option.optionName(),
                    null, null, null));
        }
        // Only identity + variants travel. Name, price, status and the description are deliberately
        // absent so this write cannot restate — or contradict — what the catalogue sweep owns, and
        // the detail TEXT has exactly one home (the knowledge library, above).
        CanonicalProduct row = new CanonicalProduct(externalProductId, null, null, null, null, null,
                null, null, null, null, null, Map.of(), variants, observedAt, null, sourceKind, 1,
                null);
        return catalogue.write(orgId, channelId, List.of(row)).variants();
    }

    /** {@code NAVER:PRODUCT_API:v1|13250364547} — the listing this document was read from. */
    static String channelRef(String sourceKind, String externalProductId) {
        return (sourceKind == null ? "" : sourceKind) + "|"
                + (externalProductId == null ? "" : externalProductId);
    }
}
