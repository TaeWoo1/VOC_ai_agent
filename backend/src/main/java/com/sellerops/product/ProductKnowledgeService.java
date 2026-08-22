package com.sellerops.product;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.product.dto.KnowledgeCoverageView;
import com.sellerops.product.dto.ProductFactView;
import com.sellerops.product.dto.ProductKnowledgeView;
import com.sellerops.product.dto.ProductListingView;
import com.sellerops.product.dto.ProductSignalsView;
import com.sellerops.product.dto.ProductVariantView;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What SellerOps knows about a product, and — with equal weight — what it does not.
 *
 * <p><b>Every coverage verdict is computed from stored rows, never declared.</b> A facet is
 * {@link KnowledgeCoverage#AVAILABLE} because facts back it, {@link KnowledgeCoverage#PARTIAL} because
 * some channels have it and others do not, {@link KnowledgeCoverage#UNAVAILABLE} because nothing states
 * it, and {@link KnowledgeCoverage#STALE} because the newest observation is older than this facet's
 * freshness bound. A hardcoded verdict would be a claim about the deployment rather than about the data
 * — the same reason {@code draftKindLabel} reads provenance instead of printing "규칙 기반".
 *
 * <p><b>It composes {@link ProductSignalsService} rather than re-deriving signals.</b> The signals half
 * of a product answer, and its {@code AttentionCoverage} rows, are exactly what that service already
 * produces for the v1 tool. Two services computing the same counts is how two screens end up printing
 * different numbers under one label.
 */
@Service
public class ProductKnowledgeService {

    /**
     * Freshness bounds, per facet, in days.
     *
     * <p>Different facets go stale at genuinely different rates and one bound would be wrong for most of
     * them: a price is a live number, a description changes rarely, and an identity does not go stale at
     * all. These are product judgements about what a seller would consider current, not measurements —
     * so they live here as named constants rather than being spread through the verdict code.
     */
    static final int PRICE_FRESH_DAYS = 30;
    static final int LISTING_FRESH_DAYS = 90;
    static final int CONTENT_FRESH_DAYS = 180;

    private final ProductQueryService productQuery;
    private final ProductSignalsService signalsService;
    private final ChannelProductRepository listings;
    private final ProductVariantRepository variants;
    private final ProductFactRepository facts;
    private final ChannelRepository channels;

    public ProductKnowledgeService(ProductQueryService productQuery, ProductSignalsService signalsService,
                                   ChannelProductRepository listings, ProductVariantRepository variants,
                                   ProductFactRepository facts, ChannelRepository channels) {
        this.productQuery = productQuery;
        this.signalsService = signalsService;
        this.listings = listings;
        this.variants = variants;
        this.facts = facts;
        this.channels = channels;
    }

    /** Everything about one product. Empty for an id outside {@code orgId} — never a probe. */
    @Transactional(readOnly = true)
    public Optional<ProductKnowledgeView> knowledge(UUID orgId, UUID productId, LocalDate referenceDate) {
        ProductSignalsView signal;
        try {
            signal = signalsService.signals(orgId, productId, referenceDate);
        } catch (IllegalArgumentException absent) {
            // An id outside this org resolves to nothing rather than to an error a caller could probe
            // with — the same rule ProductQueryService.byId follows.
            return Optional.empty();
        }

        Map<UUID, Channel> channelsById = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, c -> c, (a, b) -> a, LinkedHashMap::new));

        List<ChannelProduct> listingRows = listings.findByOrgIdAndProductId(orgId, productId);
        List<ProductVariant> variantRows = variants.findByOrgIdAndProductId(orgId, productId);
        List<ProductFact> factRows = facts.findByOrgIdAndProductId(orgId, productId);

        List<ProductListingView> listingViews = listingRows.stream()
                .sorted(Comparator.comparing(l -> codeOf(channelsById, l.getChannelId())))
                .map(l -> new ProductListingView(
                        codeOf(channelsById, l.getChannelId()),
                        nameOf(channelsById, l.getChannelId()),
                        l.getExternalProductId(),
                        l.getChannelProductName(),
                        l.getProductUrl(),
                        l.getChannelPrice(),
                        l.getCurrency(),
                        l.getSellingStatus(),
                        l.getSourceKind(),
                        l.getObservedAt(),
                        l.getSourceUpdatedAt()))
                .toList();

        List<ProductVariantView> variantViews = variantRows.stream()
                .sorted(Comparator.comparing(v -> v.getExternalVariantId() == null ? "" : v.getExternalVariantId()))
                .map(v -> new ProductVariantView(
                        codeOf(channelsById, v.getChannelId()),
                        v.getExternalVariantId(),
                        v.getOptionName(),
                        v.getSku(),
                        v.getPrice(),
                        v.getSellingStatus(),
                        v.getSource(),
                        v.getObservedAt()))
                .toList();

        List<ProductFactView> factViews = factRows.stream()
                .sorted(Comparator.comparing(ProductFact::getFactKey).thenComparing(ProductFact::getSource))
                .map(f -> new ProductFactView(f.getFactKey(), f.getFactValue(), f.getUnit(), f.getSource(),
                        f.getSourceRef(), f.getObservedAt(), f.getConfidence()))
                .toList();

        List<KnowledgeCoverageView> coverage = coverageFor(signal, listingRows, variantRows, factRows);

        return Optional.of(new ProductKnowledgeView(
                signal.productId(), signal.productName(), signal.sku(), statusOf(orgId, productId),
                listingViews, variantViews, factViews, signal, coverage));
    }

    /**
     * Facts for a bounded set of keys — the targeted read behind a "폭이 몇 mm인가요?" information need.
     *
     * <p>Separate from {@link #knowledge} because an inquiry draft needs two facts, not a catalogue: a
     * need that must load every listing, variant and signal to answer one question is a need that costs
     * a tool budget it did not have to spend.
     */
    @Transactional(readOnly = true)
    public List<ProductFactView> factsFor(UUID orgId, UUID productId, Collection<String> factKeys) {
        List<ProductFact> rows = factKeys == null || factKeys.isEmpty()
                ? facts.findByOrgIdAndProductId(orgId, productId)
                : facts.findByOrgIdAndProductIdAndFactKeyIn(orgId, productId, expand(factKeys));
        return rows.stream()
                .sorted(Comparator.comparing(ProductFact::getFactKey).thenComparing(ProductFact::getSource))
                .map(f -> new ProductFactView(f.getFactKey(), f.getFactValue(), f.getUnit(), f.getSource(),
                        f.getSourceRef(), f.getObservedAt(), f.getConfidence()))
                .toList();
    }

    /**
     * Accept both a full key ({@code spec:길이}) and a bare name ({@code 길이}) from a caller.
     *
     * <p>A planner names what it wants in the seller's words; requiring it to know the namespace would
     * make an information need depend on a storage detail, and the first symptom would be a silent empty
     * answer that reads as "규격 정보가 없습니다".
     */
    private static Set<String> expand(Collection<String> requested) {
        Set<String> out = new LinkedHashSet<>();
        for (String key : requested) {
            if (key == null || key.isBlank()) {
                continue;
            }
            String trimmed = key.strip();
            out.add(trimmed);
            if (trimmed.indexOf(':') < 0) {
                out.add(FactKeys.of(FactKeys.SPEC, trimmed));
                out.add(FactKeys.of(FactKeys.ATTR, trimmed));
                out.add(FactKeys.of(FactKeys.TAXONOMY, trimmed));
            }
        }
        return out;
    }

    // ─────────────────────────────────────────────────────────── coverage

    private List<KnowledgeCoverageView> coverageFor(ProductSignalsView signal,
                                                    List<ChannelProduct> listingRows,
                                                    List<ProductVariant> variantRows,
                                                    List<ProductFact> factRows) {
        List<KnowledgeCoverageView> out = new ArrayList<>();

        // IDENTITY: the product row exists, so the name is held. A SKU-less product is PARTIAL — it can
        // be named but not addressed on any channel, which is exactly the state a name-keyed
        // resolve-or-create leaves behind.
        boolean hasSku = signal.sku() != null && !signal.sku().isBlank();
        out.add(new KnowledgeCoverageView(ProductKnowledgeFacet.IDENTITY,
                hasSku ? KnowledgeCoverage.AVAILABLE : KnowledgeCoverage.PARTIAL,
                hasSku ? 2 : 1, null, "products"));

        // LISTING: a derived listing states only that the product was seen on a channel. It counts as
        // PARTIAL, never AVAILABLE — otherwise "우리는 이 리스팅을 안다" would be true of a row holding
        // nothing but a channel id.
        long named = listingRows.stream().filter(l -> present(l.getChannelProductName())).count();
        Instant newestListing = newest(listingRows.stream().map(ChannelProduct::getObservedAt).toList());
        out.add(facetOf(ProductKnowledgeFacet.LISTING, listingRows.size(), (int) named, newestListing,
                LISTING_FRESH_DAYS, sources(listingRows.stream().map(ChannelProduct::getSourceKind).toList())));

        // PRICE: its own facet because it goes stale fastest and is the one a seller would be misled by.
        List<ChannelProduct> priced = listingRows.stream().filter(l -> l.getChannelPrice() != null).toList();
        out.add(facetOf(ProductKnowledgeFacet.PRICE, listingRows.size(), priced.size(),
                newest(priced.stream().map(ChannelProduct::getObservedAt).toList()), PRICE_FRESH_DAYS,
                sources(priced.stream().map(ChannelProduct::getSourceKind).toList())));

        // VARIANT: a variant derived from a purchased option id has no name. Held-but-unnamed is PARTIAL.
        long namedVariants = variantRows.stream().filter(v -> present(v.getOptionName())).count();
        out.add(facetOf(ProductKnowledgeFacet.VARIANT, variantRows.size(), (int) namedVariants,
                newest(variantRows.stream().map(ProductVariant::getObservedAt).toList()), LISTING_FRESH_DAYS,
                sources(variantRows.stream().map(ProductVariant::getSource).toList())));

        out.add(factFacet(ProductKnowledgeFacet.TAXONOMY, factRows, FactKeys.TAXONOMY, CONTENT_FRESH_DAYS));
        out.add(factFacet(ProductKnowledgeFacet.DESCRIPTION, factRows, FactKeys.DESC, CONTENT_FRESH_DAYS));
        out.add(factFacet(ProductKnowledgeFacet.SPEC, factRows, FactKeys.SPEC, CONTENT_FRESH_DAYS));

        // SIGNALS is the ATTRIBUTION axis, folded in so one response answers both questions. Its verdict
        // is derived from AttentionCoverage, never recomputed: an uncertain signal source makes the facet
        // PARTIAL (we hold signals, but not for everything), never UNAVAILABLE.
        boolean anySignal = signal.coverage().stream().anyMatch(c -> c.linked() > 0);
        KnowledgeCoverage signalVerdict = !anySignal ? KnowledgeCoverage.UNAVAILABLE
                : signal.hasUncertainSignal() ? KnowledgeCoverage.PARTIAL : KnowledgeCoverage.AVAILABLE;
        out.add(new KnowledgeCoverageView(ProductKnowledgeFacet.SIGNALS, signalVerdict,
                signal.coverage().size(), null,
                signal.coverage().stream().map(c -> c.provenance()).filter(ProductKnowledgeService::present)
                        .distinct().sorted().collect(Collectors.joining("+"))));
        return out;
    }

    private KnowledgeCoverageView factFacet(ProductKnowledgeFacet facet, List<ProductFact> all,
                                            String namespace, int freshDays) {
        List<ProductFact> matching = all.stream()
                .filter(f -> namespace.equals(FactKeys.namespaceOf(f.getFactKey())))
                .toList();
        return facetOf(facet, matching.size(), matching.size(),
                newest(matching.stream().map(ProductFact::getObservedAt).toList()), freshDays,
                sources(matching.stream().map(ProductFact::getSource).toList()));
    }

    /**
     * The verdict for one facet.
     *
     * <p>Order matters: nothing held is {@link KnowledgeCoverage#UNAVAILABLE} first, because a stale
     * verdict over zero rows would be a claim about data that does not exist. Then staleness, because a
     * complete-but-old picture is not something to state as current. Then completeness.
     */
    private static KnowledgeCoverageView facetOf(ProductKnowledgeFacet facet, int total, int complete,
                                                 Instant newest, int freshDays, String provenance) {
        if (total == 0 || complete == 0) {
            return new KnowledgeCoverageView(facet, KnowledgeCoverage.UNAVAILABLE, 0, null, provenance);
        }
        if (newest != null && Duration.between(newest, Instant.now()).toDays() > freshDays) {
            return new KnowledgeCoverageView(facet, KnowledgeCoverage.STALE, complete, newest, provenance);
        }
        KnowledgeCoverage verdict = complete == total ? KnowledgeCoverage.AVAILABLE : KnowledgeCoverage.PARTIAL;
        return new KnowledgeCoverageView(facet, verdict, complete, newest, provenance);
    }

    private static Instant newest(List<Instant> instants) {
        return instants.stream().filter(java.util.Objects::nonNull).max(Comparator.naturalOrder()).orElse(null);
    }

    private static String sources(List<String> values) {
        Set<String> distinct = new TreeSet<>();
        for (String value : values) {
            if (present(value)) {
                distinct.add(value);
            }
        }
        return String.join("+", distinct);
    }

    private String statusOf(UUID orgId, UUID productId) {
        return productQuery.byId(orgId, productId).map(p -> p.status()).orElse("UNKNOWN");
    }

    private static String codeOf(Map<UUID, Channel> channels, UUID channelId) {
        Channel channel = channelId == null ? null : channels.get(channelId);
        return channel == null ? "UNKNOWN" : channel.getCode();
    }

    private static String nameOf(Map<UUID, Channel> channels, UUID channelId) {
        Channel channel = channelId == null ? null : channels.get(channelId);
        return channel == null ? null : channel.getNameKo();
    }

    private static boolean present(String value) {
        return value != null && !value.isBlank();
    }
}
