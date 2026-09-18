package com.sellerops.knowledge.bootstrap;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.BackfillWindow;
import com.sellerops.collect.SyncRunExecutor;
import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.memory.InquiryAnswerMemoryImporter;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.detail.ProductDetailEnrichment;
import com.sellerops.product.detail.ProductDetailEnrichmentTrigger;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * <b>A new seller's operating history, turned into what Reviewnary knows</b> — without the seller writing anything.
 *
 * <p><b>No parallel history store.</b> Every step here runs a path that already exists and writes where that path
 * already writes:
 * <ol>
 *   <li><b>Past inquiries and the answers the seller published</b> — one bounded READ of the channel's own history
 *       per connected account, through {@link SyncRunExecutor}'s windowed backfill (the operator backfill's exact
 *       path, the same single-flight admission, cursor lane and ingest). The answers land in {@code inquiries}, and
 *       {@link InquiryAnswerMemoryImporter} records them as {@code IMPORTED_SELLER_ANSWER} — which the Knowledge Spine
 *       already reads. Only channels whose stored answer is provably the seller's
 *       ({@link ChannelHistoryCapability#learnsInquiryHistory}) are read.</li>
 *   <li><b>Product detail</b> — {@link ProductDetailEnrichmentTrigger}, one request per product, gated by its own
 *       switch and its own staleness rule, over the products customers have actually written about (inquiries or
 *       reviews), most-discussed first, bounded by {@code max-products}.</li>
 *   <li><b>Past review replies</b> — nothing to run: no channel this product reads publishes the reply text
 *       ({@link ChannelHistoryCapability}). The report says so rather than pretending.</li>
 * </ol>
 *
 * <p><b>Once per account.</b> The inquiry history read is marked done by its own {@code sync_jobs} row
 * ({@code trigger = BOOTSTRAP}, {@code status = SUCCESS}) — no marker table. A run that failed, was partial or found a
 * collection already in flight is not done and is tried again next time. Product detail is idempotent by the
 * enrichment's own staleness gate.
 *
 * <p><b>READ only.</b> The marketplace calls are the backfill's list reads and the one-listing detail reads; nothing
 * here can write to a channel, and no model is called.
 *
 * <p><b>The product-detail rule this revises.</b> {@link ProductDetailEnrichmentTrigger} was written for one caller —
 * an inquiry someone is answering (product-owner, 2026-08-26: «none of them is reason to read a second product»). The
 * Customer Ops Product Quality Closure v1 instruction (product-owner, 2026-09-18) asks for a new seller's current
 * product detail to be learned from their operating history; this is that second caller, and it stays inside the same
 * bounds that rule protected — one request per product, never the whole catalogue (only products customers wrote
 * about, capped), the same switch, and no image lane.
 */
@Service
public class KnowledgeBootstrapService {

    private static final Logger log = LoggerFactory.getLogger(KnowledgeBootstrapService.class);

    /** The {@code sync_jobs.trigger} of the history read. Its SUCCESS row is the «already learned» marker. */
    public static final String TRIGGER = "BOOTSTRAP";

    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** How one account's history read ended. */
    public enum HistoryStatus {
        /** The bounded READ ran and finished. */
        READ,
        /** An earlier bootstrap already read this account's history. No request. */
        ALREADY_READ,
        /** A collection for this account was already running; nothing is marked done. */
        IN_PROGRESS,
        /** The channel refused or the run failed; nothing is marked done. */
        FAILED
    }

    public record InquiryHistory(UUID sellerAccountId, String channelCode, String channelNameKo, LocalDate from,
                                 LocalDate to, HistoryStatus status, int rowsRead) {
    }

    /** What the product-detail step did, counted. {@code enabled=false} means this deployment reads no detail. */
    public record ProductDetail(boolean enabled, int considered, int indexed, int imageOnly, int empty,
                                int alreadyFresh, int noListing, int failed) {
    }

    /** @param answersRemembered past answers remembered after this run, in total */
    public record Report(Instant ranAt, List<InquiryHistory> inquiryHistory, int answersRemembered,
                         ProductDetail productDetail) {
    }

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final SyncRunExecutor executor;
    private final InquiryAnswerMemoryImporter answers;
    private final ProductDetailEnrichmentTrigger detail;
    private final ProductRepository products;
    private final EntityManager em;
    private final Clock clock;
    private final int historyDays;
    private final int maxProducts;
    /**
     * On-sale catalogue products whose 상세페이지 is learned after the discussed ones (Catalogue Investigation v1,
     * product-owner 2026-09-18: a connected seller's active catalogue should have its detail before a customer's
     * catalogue question depends on it). 0 when unset — a hand-wired service learns exactly what it did before.
     */
    private int maxCatalogueProducts;

    @Autowired
    public KnowledgeBootstrapService(SellerAccountRepository accounts, ChannelRepository channels,
                                     SyncRunExecutor executor, InquiryAnswerMemoryImporter answers,
                                     ProductDetailEnrichmentTrigger detail, ProductRepository products,
                                     EntityManager em,
                                     @Value("${sellerops.knowledge.bootstrap.history-days:90}") int historyDays,
                                     @Value("${sellerops.knowledge.bootstrap.max-products:30}") int maxProducts) {
        this(accounts, channels, executor, answers, detail, products, em, Clock.systemUTC(), historyDays, maxProducts);
    }

    KnowledgeBootstrapService(SellerAccountRepository accounts, ChannelRepository channels, SyncRunExecutor executor,
                              InquiryAnswerMemoryImporter answers, ProductDetailEnrichmentTrigger detail,
                              ProductRepository products, EntityManager em, Clock clock, int historyDays,
                              int maxProducts) {
        this.accounts = accounts;
        this.channels = channels;
        this.executor = executor;
        this.answers = answers;
        this.detail = detail;
        this.products = products;
        this.em = em;
        this.clock = clock;
        this.historyDays = Math.max(1, historyDays);
        this.maxProducts = Math.max(0, maxProducts);
    }

    @Autowired
    void setMaxCatalogueProducts(
            @Value("${sellerops.knowledge.bootstrap.max-catalogue-products:60}") int maxCatalogueProducts) {
        this.maxCatalogueProducts = Math.max(0, maxCatalogueProducts);
    }

    /** Learn what this organisation's channel history can teach. Every step is best-effort; none throws. */
    public Report bootstrap(UUID orgId) {
        Instant now = clock.instant();
        List<InquiryHistory> history = readInquiryHistory(orgId, now);
        try {
            // Also covers answers already stored before this run — the import is idempotent and makes no request.
            answers.importCollectedAnswers(orgId);
        } catch (RuntimeException e) {
            log.warn("knowledge bootstrap: answer import failed org={} cause={}", orgId, e.getClass().getSimpleName());
        }
        // What is remembered now, not how many rows this import touched — the seller reads it as the former.
        int remembered = em.createQuery("select count(m) from AnswerMemory m where m.orgId = :org", Long.class)
                .setParameter("org", orgId).getSingleResult().intValue();
        ProductDetail details = readProductDetail(orgId);
        log.info("knowledge bootstrap org={} histories={} answers={} detail={}", orgId,
                history.stream().map(h -> h.channelCode() + ":" + h.status()).toList(), remembered, details);
        return new Report(now, history, remembered, details);
    }

    /** Accounts whose past inquiry answers this product can learn — connected, API, on a channel that proves authorship. */
    List<SellerAccount> historyAccounts(UUID orgId) {
        List<SellerAccount> out = new ArrayList<>();
        for (SellerAccount account : accounts.findAllByOrgId(orgId)) {
            if (account.getConnectionStatus() != ChannelStatus.CONNECTED || account.isFileUpload()) {
                continue;
            }
            String code = channels.findById(account.getChannelId()).map(Channel::getCode).orElse(null);
            if (ChannelHistoryCapability.learnsInquiryHistory(code)) {
                out.add(account);
            }
        }
        return out;
    }

    private List<InquiryHistory> readInquiryHistory(UUID orgId, Instant now) {
        LocalDate to = LocalDate.ofInstant(now, KST);
        LocalDate from = to.minusDays(historyDays);
        List<InquiryHistory> out = new ArrayList<>();
        for (SellerAccount account : historyAccounts(orgId)) {
            Channel channel = channels.findById(account.getChannelId()).orElse(null);
            String code = channel == null ? null : channel.getCode();
            String name = channel == null ? null : channel.getNameKo();
            SyncJob done = lastSuccessfulRead(account.getId());
            if (done != null) {
                out.add(new InquiryHistory(account.getId(), code, name, from, to, HistoryStatus.ALREADY_READ,
                        done.getSuccessRows()));
                continue;
            }
            try {
                SyncJob run = executor.execute(orgId, account.getId(), com.sellerops.connector.DataType.INQUIRY, TRIGGER,
                        BackfillWindow.of(from, to));
                HistoryStatus status = "RUNNING".equals(run.getStatus()) ? HistoryStatus.IN_PROGRESS
                        : "SUCCESS".equals(run.getStatus()) ? HistoryStatus.READ : HistoryStatus.FAILED;
                out.add(new InquiryHistory(account.getId(), code, name, from, to, status, run.getSuccessRows()));
            } catch (RuntimeException e) {
                log.warn("knowledge bootstrap: inquiry history read failed org={} channel={} cause={}", orgId, code,
                        e.getClass().getSimpleName());
                out.add(new InquiryHistory(account.getId(), code, name, from, to, HistoryStatus.FAILED, 0));
            }
        }
        return out;
    }

    /** The finished history read for this account, if one exists. Its row is the only marker there is. */
    SyncJob lastSuccessfulRead(UUID sellerAccountId) {
        return em.createQuery("""
                        select j from SyncJob j
                        where j.sellerAccountId = :account and j.dataType = 'INQUIRY'
                          and j.trigger = :trigger and j.status = 'SUCCESS'
                        order by j.finishedAt desc
                        """, SyncJob.class)
                .setParameter("account", sellerAccountId)
                .setParameter("trigger", TRIGGER)
                .setMaxResults(1)
                .getResultList().stream().findFirst().orElse(null);
    }

    private ProductDetail readProductDetail(UUID orgId) {
        if (detail == null || !detail.enabled()) {
            return new ProductDetail(false, 0, 0, 0, 0, 0, 0, 0);
        }
        List<UUID> candidates = new java.util.ArrayList<>(discussedProducts(orgId));
        for (UUID id : onSaleWithoutDetail(orgId)) {
            if (!candidates.contains(id)) {
                candidates.add(id);
            }
        }
        int indexed = 0;
        int imageOnly = 0;
        int empty = 0;
        int fresh = 0;
        int noListing = 0;
        int failed = 0;
        int considered = 0;
        for (UUID productId : candidates) {
            ProductDetailEnrichmentTrigger.Result result;
            try {
                result = detail.enrichIfNeeded(orgId, productId);
            } catch (RuntimeException e) {
                failed++;
                continue;
            }
            if (result.outcome() == ProductDetailEnrichmentTrigger.Outcome.DISABLED) {
                return new ProductDetail(false, 0, 0, 0, 0, 0, 0, 0);
            }
            considered++;
            switch (result.outcome()) {
                case NOT_NEEDED -> fresh++;
                case NO_CAPABLE_LISTING, NO_ACCOUNT -> noListing++;
                case NOT_FOUND, READ_FAILED -> failed++;
                case APPLIED -> {
                    ProductDetailEnrichment.Outcome applied = result.enriched().outcome();
                    if (applied == ProductDetailEnrichment.Outcome.TEXT_INDEXED) {
                        indexed++;
                    } else if (applied == ProductDetailEnrichment.Outcome.IMAGE_ONLY) {
                        imageOnly++;
                    } else if (applied == ProductDetailEnrichment.Outcome.EMPTY) {
                        empty++;
                    } else {
                        fresh++;
                    }
                }
                default -> { }
            }
        }
        return new ProductDetail(true, considered, indexed, imageOnly, empty, fresh, noListing, failed);
    }

    /**
     * The seller's on-sale catalogue that has no 상세페이지 text yet — named products with a listing the channel says is
     * on sale, in name order, at most {@code max-catalogue-products}. Not a sweep: the trigger's own staleness gate and
     * attempt memory still decide whether each one is read, and a product whose detail exists is not listed at all.
     */
    List<UUID> onSaleWithoutDetail(UUID orgId) {
        if (maxCatalogueProducts <= 0) {
            return List.of();
        }
        List<UUID> withDetail = em.createQuery(
                        "select s.productId from ProductKnowledgeSource s where s.orgId = :org and s.authoredOrigin = :origin",
                        UUID.class)
                .setParameter("org", orgId)
                .setParameter("origin", com.sellerops.product.library.KnowledgeAuthorship.SELLER_AUTHORED_CHANNEL_CONTENT)
                .getResultList();
        List<com.sellerops.product.ChannelProduct> listings = em.createQuery(
                        "select cp from ChannelProduct cp where cp.orgId = :org",
                        com.sellerops.product.ChannelProduct.class)
                .setParameter("org", orgId).getResultList();
        java.util.Set<UUID> onSale = new java.util.HashSet<>();
        for (com.sellerops.product.ChannelProduct l : listings) {
            if (com.sellerops.product.SellingStatus.normalize(l.getSellingStatus())
                    == com.sellerops.product.SellingStatus.SELLING) {
                onSale.add(l.getProductId());
            }
        }
        return onSale.stream()
                .filter(id -> !withDetail.contains(id))
                .map(id -> products.findById(id).filter(p -> orgId.equals(p.getOrgId())).orElse(null))
                .filter(p -> p != null && OperatorProductName.displayNameOrNull(p) != null)
                .sorted(java.util.Comparator.comparing((com.sellerops.product.Product p) -> p.getName())
                        .thenComparing(p -> p.getId().toString()))
                .map(com.sellerops.product.Product::getId)
                .limit(maxCatalogueProducts)
                .toList();
    }

    /**
     * The products customers actually wrote about — inquiries and reviews on real rows — most-discussed first, named
     * products only (the shared 「(미지정 상품)」 bucket is not a product), at most {@code max-products}.
     */
    List<UUID> discussedProducts(UUID orgId) {
        Map<UUID, Long> activity = new HashMap<>();
        for (Object[] row : em.createQuery("""
                        select i.productId, count(i) from Inquiry i
                        where i.orgId = :org and i.productId is not null and i.dataOrigin = :real
                        group by i.productId
                        """, Object[].class)
                .setParameter("org", orgId).setParameter("real", DataOrigin.REAL).getResultList()) {
            activity.merge((UUID) row[0], (Long) row[1], Long::sum);
        }
        for (Object[] row : em.createQuery("""
                        select r.productId, count(r) from Review r
                        where r.orgId = :org and r.productId is not null and r.dataOrigin = :real
                        group by r.productId
                        """, Object[].class)
                .setParameter("org", orgId).setParameter("real", DataOrigin.REAL).getResultList()) {
            activity.merge((UUID) row[0], (Long) row[1], Long::sum);
        }
        return activity.entrySet().stream()
                .sorted(Map.Entry.<UUID, Long>comparingByValue().reversed()
                        .thenComparing(e -> e.getKey().toString()))
                .map(Map.Entry::getKey)
                .filter(id -> products.findById(id)
                        .filter(p -> orgId.equals(p.getOrgId()))
                        .map(OperatorProductName::displayNameOrNull).isPresent())
                .limit(maxProducts)
                .toList();
    }
}
