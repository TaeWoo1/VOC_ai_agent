package com.sellerops.product.detail;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.connector.naver.NaverProductDetail;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * <b>The caller {@link ProductDetailEnrichment} did not have.</b>
 *
 * <p>Enrichment was written, tested and wired to nothing: an audit on 2026-08-26 found zero
 * references to it in {@code main}, and the database agreed — every knowledge document in the
 * canonical org was typed by a person, and not one 상세페이지 had ever been read. So the "image
 * lane" was being designed on top of a text lane that had never run. This class connects the text
 * lane, and the image branch stays where it is until it does.
 *
 * <p><b>Three conditions, all required</b> (product-owner, 2026-08-26). An <i>actionable</i> inquiry
 * — one a draft is being written for — AND an <i>exact</i> product attribution AND detail knowledge
 * that is missing or stale. Any one of them false and no request is made. There is no catalogue
 * sweep, no background whole-catalogue pass and no scheduler entry; the only thing that can cause a
 * read is a seller (or the proactive preparer) actually needing an answer about that one product.
 *
 * <p><b>Off by default</b> (product-owner, 2026-08-27). This capability has been unit-tested and
 * never run live, and an ordinary {@code bootRun} must not begin making 상세페이지 reads against a
 * seller's channel because a class was merged. {@code sellerops.product.detail.enrichment.enabled}
 * is turned on for a bounded, approved live proof only; raising the Demo/Pilot default is a separate
 * decision that comes after that proof rather than with it.
 *
 * <p><b>A second caller, with the same bounds</b> (Customer Ops Product Quality Closure v1, product-owner 2026-09-18).
 * {@code KnowledgeBootstrapService} asks for the products a new seller's customers already wrote about, so their
 * listing is learned before the next question arrives. It goes through this method unchanged: one request per product,
 * the staleness gate, the attempt memory and the same switch — and it names a bounded list, never the catalogue.
 *
 * <p><b>It never throws at its caller.</b> A draft must be produced whether or not a channel
 * answered — a 403, a rate limit, a missing credential and a rebuilt listing all end as an
 * {@link Outcome}, logged, with the draft path continuing on whatever knowledge already existed.
 * The failure mode of this class is "today", which is what it was before it existed.
 *
 * <p><b>Why an attempt memory exists.</b> {@link ProductDetailEnrichment} writes nothing when the
 * page turns out to be pictures ({@code Outcome.IMAGE_ONLY}) or empty — correctly, because there is
 * no text to index. But staleness is measured by the document that was not written, so without a
 * memory of the attempt every draft on that product would read the channel again. The memory is in
 * process and short-lived: a restart costs at most one extra read per product, which is the right
 * side to be wrong on.
 */
@Component
public class ProductDetailEnrichmentTrigger {

    private static final Logger log = LoggerFactory.getLogger(ProductDetailEnrichmentTrigger.class);

    /**
     * How long a fruitless attempt is remembered.
     *
     * <p>Shorter than {@link ProductDetailEnrichment#STALE_AFTER} by a wide margin, because this is
     * not a freshness policy — it is a "we just asked" note. A seller who fixes their 상세페이지
     * should not wait 30 days for SellerOps to look again.
     */
    static final Duration ATTEMPT_MEMORY = Duration.ofHours(6);

    /** A ceiling on the memory so a long-running process cannot grow one entry per product forever. */
    static final int ATTEMPT_MEMORY_MAX = 2_000;

    private final ProductDetailEnrichment enrichment;
    private final ChannelProductRepository listings;
    private final ChannelRepository channels;
    private final SellerAccountRepository accounts;
    private final List<ProductDetailSource> sources;
    private final Clock clock;
    private final boolean enabled;

    private final Map<String, Instant> attempted = new ConcurrentHashMap<>();

    /**
     * The wired constructor. There is no {@code Clock} bean in this application, and adding one for
     * a staleness gate would be a container-wide change made for one class.
     */
    @Autowired
    public ProductDetailEnrichmentTrigger(ProductDetailEnrichment enrichment,
                                          ChannelProductRepository listings,
                                          ChannelRepository channels,
                                          SellerAccountRepository accounts,
                                          List<ProductDetailSource> sources,
                                          @Value("${sellerops.product.detail.enrichment.enabled:false}")
                                          boolean enabled) {
        this(enrichment, listings, channels, accounts, sources, Clock.systemUTC(), enabled);
    }

    ProductDetailEnrichmentTrigger(ProductDetailEnrichment enrichment,
                                   ChannelProductRepository listings,
                                   ChannelRepository channels,
                                   SellerAccountRepository accounts,
                                   List<ProductDetailSource> sources,
                                   Clock clock, boolean enabled) {
        this.enrichment = enrichment;
        this.listings = listings;
        this.channels = channels;
        this.accounts = accounts;
        this.sources = sources == null ? List.of() : List.copyOf(sources);
        this.clock = clock;
        this.enabled = enabled;
    }

    /** How an attempt ended. Closed, so the log line and a report can be written without prose. */
    public enum Outcome {
        /** The switch is off, or no channel in this deployment can read a 상세페이지. */
        DISABLED,
        /** Detail knowledge is present and fresh, or this product was already asked about. */
        NOT_NEEDED,
        /** No listing on a channel that publishes 상세페이지. */
        NO_CAPABLE_LISTING,
        /** A listing, but no connected account to read it with. */
        NO_ACCOUNT,
        /** The channel does not have this listing any more. Absence, never a deletion. */
        NOT_FOUND,
        /** The channel refused or could not be reached. The draft continues regardless. */
        READ_FAILED,
        /**
         * The channel refused THIS CALLER (IP, permission, credential) — every other listing would be refused the same
         * way, so a caller reading many stops here. See {@link Result#refusal()}.
         */
        CHANNEL_REFUSED,
        /** One request was made and its result applied. */
        APPLIED
    }

    /** The result: how it ended, and — when a read happened — what the page turned out to be. */
    public record Result(Outcome outcome, ProductDetailEnrichment.Result enriched,
                         ChannelAccessRefused.Reason refusal) {

        public Result(Outcome outcome, ProductDetailEnrichment.Result enriched) {
            this(outcome, enriched, null);
        }

        static Result of(Outcome outcome) {
            return new Result(outcome, null);
        }

        /** Whether the page's answers are in its pictures. False whenever no read happened. */
        public boolean needsImageUnderstanding() {
            return enriched != null
                    && enriched.outcome() == ProductDetailEnrichment.Outcome.IMAGE_ONLY;
        }
    }

    /** The channels whose 상세페이지 this deployment can read ({@code NAVER}), upper-case. */
    public java.util.Set<String> channelCodes() {
        java.util.Set<String> out = new java.util.HashSet<>();
        for (ProductDetailSource source : sources) {
            out.add(source.channelCode().toUpperCase(java.util.Locale.ROOT));
        }
        return out;
    }

    /** When this product's detail was last read, or null. A database read; never a channel call. */
    public Instant lastRead(UUID orgId, UUID productId) {
        return enrichment.lastRead(orgId, productId);
    }

    /** Whether this deployment reads 상세페이지 at all — the switch, and at least one channel that publishes one. */
    public boolean enabled() {
        return enabled && !sources.isEmpty();
    }

    /**
     * Read and index this one product's 상세페이지, if all three conditions hold.
     *
     * <p><b>At most one marketplace request.</b> One product, one listing, one call — and the caller
     * has already decided that this product is exactly attributed to an inquiry someone is answering.
     */
    public Result enrichIfNeeded(UUID orgId, UUID productId) {
        if (!enabled || sources.isEmpty() || orgId == null || productId == null) {
            return Result.of(Outcome.DISABLED);
        }
        Instant now = clock.instant();
        String key = orgId + ":" + productId;
        Instant last = attempted.get(key);
        if (last != null && last.isAfter(now.minus(ATTEMPT_MEMORY))) {
            return Result.of(Outcome.NOT_NEEDED);
        }
        if (!enrichment.needsEnrichment(orgId, productId, now)) {
            return Result.of(Outcome.NOT_NEEDED);
        }

        Optional<Target> target = resolve(orgId, productId);
        if (target.isEmpty()) {
            // Remembered as an attempt: a Cafe24-only product will never gain a 상세페이지 source by
            // being asked again in the next five minutes, and the resolution costs three queries.
            remember(key, now);
            return Result.of(Outcome.NO_CAPABLE_LISTING);
        }
        Target found = target.get();
        Optional<SellerAccount> account = accounts.findByOrgIdAndChannelId(orgId, found.channelId());
        if (account.isEmpty()) {
            remember(key, now);
            return Result.of(Outcome.NO_ACCOUNT);
        }

        remember(key, now);
        NaverProductDetail detail;
        try {
            detail = found.source().read(orgId, account.get().getId(), found.externalProductId());
        } catch (ChannelAccessRefused e) {
            log.info("product-detail trigger org={} outcome=CHANNEL_REFUSED reason={}", orgId, e.reason());
            return new Result(Outcome.CHANNEL_REFUSED, null, e.reason());
        } catch (RuntimeException e) {
            // The class only. A NAVER failure message can name the calling IP or the listing, and a
            // draft path is not the place either of those surfaces.
            log.info("product-detail trigger org={} outcome=READ_FAILED cause={}", orgId,
                    e.getClass().getSimpleName());
            return Result.of(Outcome.READ_FAILED);
        }
        if (detail == null) {
            log.info("product-detail trigger org={} outcome=NOT_FOUND", orgId);
            return Result.of(Outcome.NOT_FOUND);
        }
        ProductDetailEnrichment.Result applied = enrichment.apply(orgId, found.channelId(), productId,
                found.externalProductId(), found.source().sourceKind(), found.source().detailSourceKind(), detail, now);
        log.info("product-detail trigger org={} outcome=APPLIED enrichment={} images={} options={}",
                orgId, applied.outcome(), applied.imageCount(), applied.optionsWritten());
        return new Result(Outcome.APPLIED, applied);
    }

    /** The listing to read, and the source that can read it. Empty when no channel here can. */
    private Optional<Target> resolve(UUID orgId, UUID productId) {
        List<ChannelProduct> rows = listings.findByOrgIdAndProductId(orgId, productId);
        for (ChannelProduct row : rows) {
            String external = row.getExternalProductId();
            if (external == null || external.isBlank()) {
                continue;
            }
            String code = channels.findById(row.getChannelId()).map(Channel::getCode).orElse(null);
            if (code == null) {
                continue;
            }
            for (ProductDetailSource source : sources) {
                if (source.channelCode().equalsIgnoreCase(code)) {
                    return Optional.of(new Target(row.getChannelId(), external, source));
                }
            }
        }
        return Optional.empty();
    }

    private void remember(String key, Instant now) {
        if (attempted.size() >= ATTEMPT_MEMORY_MAX) {
            // Cheapest correct thing: drop everything rather than evict cleverly. The cost of an
            // empty memory is one extra read per product, and the cost of a leak is unbounded.
            attempted.clear();
        }
        attempted.put(key, now);
    }

    private record Target(UUID channelId, String externalProductId, ProductDetailSource source) {
    }
}
