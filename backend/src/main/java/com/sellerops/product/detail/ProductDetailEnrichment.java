package com.sellerops.product.detail;

import com.sellerops.connector.naver.NaverProductDetail;
import com.sellerops.ingest.canonical.CanonicalProduct;
import com.sellerops.ingest.canonical.CanonicalProductVariant;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.FactKeys;
import com.sellerops.product.ProductFact;
import com.sellerops.product.ProductFactRepository;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Turn ONE listing's 상세페이지 into knowledge a reply can be grounded in.
 *
 * <p><b>One product per call, never a sweep inside this class.</b> The structure this class was written to forbid is
 * "read every product's detail on every routine sweep". That still holds: enrichment is per-product, gated by
 * {@link #needsEnrichment}, and the caller passes one product id. What changed (Catalogue Knowledge Bootstrap v1,
 * product-owner 2026-09-18) is WHO may ask for many: the knowledge bootstrap now asks for every on-sale listing once,
 * and after that a listing is read again only when the channel's own {@code modifiedDate} (carried by the catalogue
 * LIST read) is newer than our last read, or after {@link #STALE_AFTER}. So the steady-state cost is the listings the
 * seller changed, not the catalogue.
 *
 * <p><b>The three triggers are equals, not a priority order</b> (product-owner, 2026-08-26): a new or
 * changed product, an actionable inquiry whose product is exactly attributed, or product detail
 * knowledge that is missing or stale. Any one of them is reason enough, and none of them is reason to
 * read a second product.
 *
 * <p><b>What it writes.</b> Besides the text and options below, the channel's structured statements — 상품정보제공고시
 * fields, model name, named category attributes, seller tags, each offered 추가상품 — and a page-shape marker
 * ({@link FactKeys#DETAIL_PAGE}) that says this listing WAS read, even when the page was pictures. All of them live under
 * the detail read's own source and are replaced as a set; options the listing no longer offers are retired.
 *
 * <p><b>The one copy rule.</b> The detail TEXT becomes a
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
    private final ProductFactRepository facts;
    private final ChannelProductRepository listings;

    /** Text, options and images only — no structured facts, and staleness judged by the document alone. */
    public ProductDetailEnrichment(ProductKnowledgeSourceRepository sources,
                                   ProductKnowledgeWriter catalogue,
                                   ProductKnowledgeIndexer indexer) {
        this(sources, catalogue, indexer, null, null);
    }

    @Autowired
    public ProductDetailEnrichment(ProductKnowledgeSourceRepository sources,
                                   ProductKnowledgeWriter catalogue,
                                   ProductKnowledgeIndexer indexer,
                                   ProductFactRepository facts,
                                   ChannelProductRepository listings) {
        this.sources = sources;
        this.catalogue = catalogue;
        this.indexer = indexer;
        this.facts = facts;
        this.listings = listings;
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
                         int optionsWritten, int imageCount, int factsWritten, int supplementsOffered) {

        public Result(Outcome outcome, DetailContentShape.Measurement measurement, int optionsWritten,
                      int imageCount) {
            this(outcome, measurement, optionsWritten, imageCount, 0, 0);
        }
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
        Instant lastRead = lastRead(orgId, productId);
        if (lastRead == null || lastRead.isBefore(now.minus(STALE_AFTER))) {
            return true;
        }
        // The catalogue sweep carries the channel's own modifiedDate: a listing the seller changed after we last read
        // its detail is stale today, not in 30 days. API-first freshness — the list says what changed, and only that
        // one listing is read again.
        return listings != null && listings.findByOrgIdAndProductId(orgId, productId).stream()
                .anyMatch(l -> l.getSourceUpdatedAt() != null && l.getSourceUpdatedAt().isAfter(lastRead));
    }

    /**
     * When this product's detail was last read: the later of the indexed document's update and the page-shape marker
     * every read writes. Null when it never was.
     */
    @Transactional(readOnly = true)
    public Instant lastRead(UUID orgId, UUID productId) {
        Instant doc = existingDocument(orgId, productId).map(ProductKnowledgeSource::getUpdatedAt).orElse(null);
        Instant marker = facts == null ? null : facts
                .findByOrgIdAndProductIdAndFactKeyIn(orgId, productId, List.of(FactKeys.DETAIL_PAGE)).stream()
                .map(ProductFact::getObservedAt).filter(java.util.Objects::nonNull)
                .max(Instant::compareTo).orElse(null);
        if (doc == null) {
            return marker;
        }
        return marker == null || doc.isAfter(marker) ? doc : marker;
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
        return apply(orgId, channelId, productId, externalProductId, sourceKind, sourceKind + "/detail", detail,
                observedAt);
    }

    /**
     * @param detailSourceKind the provenance of the facts this read states — owned as a set: a re-read replaces them
     */
    @Transactional
    public Result apply(UUID orgId, UUID channelId, UUID productId, String externalProductId,
                        String sourceKind, String detailSourceKind, NaverProductDetail detail, Instant observedAt) {
        DetailContentShape.Measurement measurement =
                DetailContentShape.classify(detail == null ? null : detail.detailContent());
        int imageCount = detail == null || detail.imageUrls() == null ? 0 : detail.imageUrls().size();
        int options = writeOptions(orgId, channelId, productId, externalProductId, sourceKind, detail, observedAt);
        String shape = measurement.shape() == DetailContentShape.Shape.EMPTY ? "EMPTY"
                : measurement.textIsEnough() ? "TEXT" : "IMAGE_ONLY";
        int[] stated = writeFacts(orgId, productId, externalProductId, detailSourceKind, detail, shape, observedAt);
        int factCount = stated[0];
        int offered = stated[1];

        if (measurement.shape() == DetailContentShape.Shape.EMPTY) {
            log.info("product-detail enrichment org={} outcome=EMPTY {} images={} options={}",
                    orgId, DetailContentShape.describe(measurement), imageCount, options);
            return new Result(Outcome.EMPTY, measurement, options, imageCount, factCount, offered);
        }
        if (!measurement.textIsEnough()) {
            // The honest stop. The page's answers are in its pictures, and reading pictures is a
            // capability SellerOps does not have — saying so is more useful than indexing the
            // 40 characters of shop notice that surround the images.
            log.info("product-detail enrichment org={} outcome=IMAGE_ONLY {} images={} options={}",
                    orgId, DetailContentShape.describe(measurement), imageCount, options);
            return new Result(Outcome.IMAGE_ONLY, measurement, options, imageCount, factCount, offered);
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
        return new Result(Outcome.TEXT_INDEXED, measurement, options, imageCount, factCount, offered);
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
    private int writeOptions(UUID orgId, UUID channelId, UUID productId, String externalProductId, String sourceKind,
                             NaverProductDetail detail, Instant observedAt) {
        if (detail == null) {
            return 0;
        }
        List<CanonicalProductVariant> variants = new ArrayList<>();
        java.util.Set<String> listed = new java.util.HashSet<>();
        for (NaverProductDetail.Option option : detail.options()) {
            // Status is the channel's: not usable ⇒ SUSPENSION, a managed stock of zero ⇒ OUTOFSTOCK, otherwise SALE.
            // A variant with no id is skipped by the writer, and so is not counted as listed.
            String status = option.usable() == null && option.stockQuantity() == null ? null
                    : Boolean.FALSE.equals(option.usable()) ? "SUSPENSION"
                    : option.purchasable(detail.stockManaged()) ? "SALE" : "OUTOFSTOCK";
            variants.add(new CanonicalProductVariant(option.externalId(), option.optionName(),
                    null, null, status));
            if (option.externalId() != null) {
                listed.add(option.externalId());
            }
        }
        // Identity, the listing's own status as the detail states it, and variants. Name, price and the description
        // are deliberately absent so this write cannot restate what the catalogue sweep owns, and the detail TEXT has
        // exactly one home (the knowledge library, above). The status is the one exception, and it is the same field
        // of the same listing from the same channel, read later — present overwrites, absent preserves.
        CanonicalProduct row = new CanonicalProduct(externalProductId, null, null, null, null, null,
                detail.effectiveStatus(), null, null, null, null, Map.of(), variants, observedAt, null, sourceKind, 1,
                null);
        int written = catalogue.write(orgId, channelId, List.of(row)).variants();
        if (detail.statusType() != null && productId != null) {
            // A complete read of THIS listing's options: whatever this channel listed before and no longer lists is
            // no longer offered. Guarded on a read that actually carried the listing (its status is 필수 in the
            // schema), never on the empty projection of a partial one.
            catalogue.retireVariantsNotIn(orgId, productId, channelId, listed);
        }
        return written;
    }

    /**
     * The channel's structured statements about the product — 고시 fields, model name, named attributes, tags — as
     * {@code spec:}/{@code attr:} facts, the 추가상품 on offer, and the page-shape marker; all under the detail read's own
     * source, replaced as a set. Returns {facts written, 추가상품 offered}.
     */
    private int[] writeFacts(UUID orgId, UUID productId, String externalProductId, String detailSourceKind,
                             NaverProductDetail detail, String shape, Instant observedAt) {
        if (detail == null || productId == null) {
            return new int[] {0, 0};
        }
        Map<String, String> keyed = new java.util.LinkedHashMap<>();
        detail.facts().forEach((label, value) -> {
            if (label == null || label.isBlank()) {
                return;
            }
            String key = label.equals("판매자 태그") ? FactKeys.of(FactKeys.ATTR, label) : FactKeys.of(FactKeys.SPEC, label);
            keyed.putIfAbsent(key, value);
        });
        int offered = 0;
        for (NaverProductDetail.Supplement s : detail.supplements()) {
            // Only what a buyer can add today. A 추가상품 switched off is not something the seller sells now.
            if (!s.offered() || s.label().isBlank()) {
                continue;
            }
            String id = s.externalId() != null ? s.externalId() : Integer.toString(offered + 1);
            keyed.put(FactKeys.SUPPLEMENT_PREFIX + id, s.label());
            offered++;
        }
        keyed.put(FactKeys.DETAIL_PAGE, shape);
        return new int[] {catalogue.replaceFacts(orgId, productId, detailSourceKind, externalProductId, keyed,
                observedAt, null), offered};
    }

    /** {@code NAVER:PRODUCT_API:v1|13250364547} — the listing this document was read from. */
    static String channelRef(String sourceKind, String externalProductId) {
        return (sourceKind == null ? "" : sourceKind) + "|"
                + (externalProductId == null ? "" : externalProductId);
    }
}
