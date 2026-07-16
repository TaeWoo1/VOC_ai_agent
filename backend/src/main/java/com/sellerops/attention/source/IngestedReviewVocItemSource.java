package com.sellerops.attention.source;

import com.sellerops.attention.AttentionItemFilters;
import com.sellerops.attention.AttentionSignalType;
import com.sellerops.attention.VocItemFilter;
import com.sellerops.attention.VocWindowSnapshot;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * The ingested-review {@link VocItemSource}: reads the file-ingest review store
 * ({@code reviews}) behind the channel-generic source seam, so NAVER reviews that
 * arrive as seller-center exports become operator attention signals through the same
 * taxonomy, rules, route, and sanitizer as every other channel. Adds no signal type and
 * no route; it fills {@link VocWindowSnapshot} and, on the drill-down, the DTO's
 * {@code productName}.
 *
 * <p><b>Product display name.</b> This store is the only {@link VocItemSource} that can
 * resolve one: an ingested review carries a {@code product_id} link into {@code products}
 * ({@code IngestionService} resolves-or-creates a product for every row), where the
 * Cafe24 store has only a raw {@code product_no} and no catalog link. The name is a
 * DISPLAY value only — the SKU (상품번호, i.e. the channel's {@code productNo}) is the
 * product's identity and is withheld from the DTO. Crucially that is ENFORCED, not
 * assumed: ingest stores the SKU as the name when a row has no name, so
 * {@code hasDisplayableName} withholds any name equal to its own SKU rather than trusting
 * the two fields to differ. Names are resolved for a whole page in one org-scoped batch
 * query (see {@code productNamesFor}); anything that cannot be resolved honestly comes out
 * {@code null}. The guarantee is this surface's, not the product model's — ingest keeps
 * minting SKU-named rows and other surfaces keep showing them.
 *
 * <p><b>Serves NAVER only.</b> Two deliberate exclusions:
 *
 * <ul>
 *   <li><b>CAFE24</b> — {@code /api/uploads} accepts any existing channel, so a Cafe24
 *       review can reach {@code reviews} by upload AND {@code cafe24_community_articles}
 *       by the board-4 API sync. Both stores serving CAFE24 would double-count the same
 *       review, and {@link VocItemSourceRegistry} is first-wins, so which count an
 *       operator saw would depend on bean declaration order.
 *       {@link Cafe24VocItemSource} owns CAFE24.
 *   <li><b>GMARKET (ESM+)</b> — deliberately NOT served, though its reviews can reach
 *       this store. GMARKET is the single channel shared by BOTH ESM+ marketplaces
 *       ({@code EsmMarketplace}: GMARKET and AUCTION), and onboarding each selling id
 *       creates a distinct seller account, so an ESM+ seller holding both routinely has
 *       two accounts on one channel — the exact shape the ambiguity guard below refuses
 *       to answer. Claiming the channel would therefore make the surface silently
 *       unsupported for the ESM+ sellers it appeared to serve. GMARKET also has a real
 *       inquiry store ({@code EsmInquiryImportWriter} writes account-scoped rows), which
 *       this source cannot see, so claiming the channel would shadow it behind hard-zero
 *       inquiry counts. GMARKET keeps its existing no-adapter empty state until a source
 *       can answer for it honestly.
 * </ul>
 *
 * <p><b>Fails closed when the account is ambiguous.</b> {@code reviews} has no
 * {@code seller_account_id} — a file upload resolves no account
 * ({@code FileUploadConnector} passes null) — so this source can only answer at
 * org+channel granularity. With exactly one account on the channel that is
 * unambiguous. With two, a per-account read would show each account the other's
 * reviews, so this returns an EMPTY snapshot and an empty slice rather than
 * attributing a review to an account that may not own it.
 *
 * <p>That empty is an <b>UNSUPPORTED AMBIGUOUS STATE, not a confirmed zero</b> — the
 * surface is declining to answer, not reporting good news, and it is logged at WARN
 * precisely so it is not mistaken for one. Resolving it properly needs account-scoped
 * ingest, which is a product decision, not something to paper over here.
 *
 * <p>Inquiry-side snapshot fields are always zero: this store holds reviews only, and
 * NAVER has no other collected VOC store to shadow. Window days are interpreted in
 * {@link #KST}, matching {@link Cafe24VocItemSource}, so the two adapters bucket a
 * calendar day identically.
 */
@Component
public class IngestedReviewVocItemSource implements VocItemSource {

    private static final Logger log = LoggerFactory.getLogger(IngestedReviewVocItemSource.class);

    /** Window "day" boundaries are KST — same platform-zone policy as the Cafe24 source. */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /**
     * Channels this source answers for. NAVER only, deliberately: CAFE24 and GMARKET are
     * both excluded for the reasons in the class note, and COUPANG has no export contract
     * yet and would need its own grounding before being listed here. Adding a code here
     * is a product decision, not a mechanical edit — each one needs its own answer to
     * "can two accounts share this channel?" and "does this channel have another store?".
     */
    static final Set<String> SUPPORTED_CHANNEL_CODES = Set.of("NAVER");

    /**
     * Ingest's fallback product name, filtered back out on read.
     *
     * <p>An export row with neither 상품명 nor 상품번호 still has to resolve to a product,
     * so {@code ReviewRowMapper}/{@code ProductService} mint this placeholder. It is an
     * ingest artifact, not a product: {@code ProductService} resolves it by name, so
     * EVERY nameless row in an org collapses onto one shared row. Surfacing it would show
     * an operator a "product" that is really a bucket of unrelated reviews, so a row
     * naming it reads as {@code null} — the same honest "no name available" as a missing
     * link. Ingest is unchanged; this is read-side only.
     *
     * <p>The string is duplicated from ingest rather than shared: it appears at seven
     * main-source sites today — six as a bare literal, the seventh as
     * {@code EsmInquiryRowMapper.UNSPECIFIED_PRODUCT}, which is private to the ESM inquiry
     * importer — so there is nothing canonical to reuse and inventing one would mean
     * editing ingest. {@code ExportToAttentionChainTest} pins the duplication by uploading a
     * real nameless export, so changing ingest's literal fails loudly instead of leaving this
     * filter silently matching nothing. It has to be pinned THERE and not against
     * {@code ProductService}: on the review path {@code ReviewRowMapper} mints the placeholder
     * itself and passes it as a non-null name, so {@code ProductService}'s own fallback never
     * fires and the stored value is the MAPPER's literal — a unit test driving
     * {@code ProductService} directly would pin a string production never stores.
     */
    static final String UNSPECIFIED_PRODUCT_NAME = "(미지정 상품)";

    /** Operator-facing source type; this store is reviews only. */
    static final String SOURCE_TYPE_REVIEW = "REVIEW";
    /** The filter vocabulary's review kind — inquiry-kind signals are not ours to serve. */
    static final String SOURCE_KIND_REVIEW = "REVIEW";

    /** No account, no attribution: the same empty state a channel without a source gets. */
    private static final VocWindowSnapshot EMPTY_SNAPSHOT = new VocWindowSnapshot(0, 0, 0, 0, 0, 0, 0, 0);

    private final ReviewRepository reviews;
    private final SellerAccountRepository sellerAccounts;
    private final ProductRepository products;

    public IngestedReviewVocItemSource(ReviewRepository reviews, SellerAccountRepository sellerAccounts,
                                       ProductRepository products) {
        this.reviews = reviews;
        this.sellerAccounts = sellerAccounts;
        this.products = products;
    }

    @Override
    public boolean supports(String channelCode) {
        return channelCode != null && SUPPORTED_CHANNEL_CODES.contains(channelCode);
    }

    @Override
    public VocWindowSnapshot snapshot(UUID orgId, UUID accountId, LocalDate from, LocalDate to) {
        UUID channelId = unambiguousChannelFor(orgId, accountId);
        if (channelId == null) {
            return EMPTY_SNAPSHOT;
        }
        Instant fromInstant = from.atStartOfDay(KST).toInstant();
        Instant toExclusive = to.plusDays(1).atStartOfDay(KST).toInstant();
        // Baseline = the immediately preceding equal-length window, same half-open KST
        // semantics; its exclusive end is exactly the current window's start, so no row
        // is counted twice. Reuses the window count query — no server clock.
        long windowDays = ChronoUnit.DAYS.between(from, to) + 1;
        Instant prevFromInstant = from.minusDays(windowDays).atStartOfDay(KST).toInstant();
        return new VocWindowSnapshot(
                reviews.countInWindowByChannel(orgId, channelId, fromInstant, toExclusive),
                0,  // newInquiries — this store holds no inquiries
                0,  // unansweredInquiries
                0,  // unknownReplyInquiries
                reviews.countInWindowByChannelAndRatingBetween(orgId, channelId, 1, 2, fromInstant, toExclusive),
                reviews.countInWindowByChannelAndRatingBetween(orgId, channelId, 3, 3, fromInstant, toExclusive),
                reviews.countInWindowByChannel(orgId, channelId, prevFromInstant, fromInstant),
                0); // previousInquiries
    }

    @Override
    public VocItemSlice items(UUID orgId, UUID accountId, String channelCode, String channelNameKo,
                              AttentionSignalType signalType, LocalDate from, LocalDate to, int page, int size) {
        UUID channelId = unambiguousChannelFor(orgId, accountId);
        if (channelId == null) {
            return VocItemSlice.empty();
        }
        VocItemFilter filter = AttentionItemFilters.forType(signalType);
        // An inquiry-kind signal can never have been raised from this store's snapshot
        // (its inquiry counts are hard zeros), so drilling one yields nothing rather
        // than silently listing reviews under an inquiry lens.
        if (!SOURCE_KIND_REVIEW.equals(filter.sourceKind())) {
            return VocItemSlice.empty();
        }
        Instant fromInstant = from.atStartOfDay(KST).toInstant();
        Instant toExclusive = to.plusDays(1).atStartOfDay(KST).toInstant();

        Page<Review> result = reviews.findInWindowByChannelFiltered(
                orgId, channelId, filter.minRating(), filter.maxRating(),
                fromInstant, toExclusive, PageRequest.of(page, size));
        Map<UUID, String> productNames = productNamesFor(orgId, result.getContent());
        List<OperatorVocItem> rows = result.getContent().stream()
                .map(r -> toItem(r, signalType, channelCode, channelNameKo, productNames))
                .toList();
        return new VocItemSlice(rows, result.getTotalElements());
    }

    /**
     * Display names for the products this page's rows link to — ONE org-scoped batch
     * query, never a per-row lookup. {@code page} is already clamped upstream
     * ({@code OperatorAttentionService.MAX_PAGE_SIZE}), so the id set is bounded by the
     * page size and each id is a primary-key hit: the cost is a page, not the catalog.
     * Deliberately not {@code findAllByOrgId} — that loads the org's entire catalog to
     * answer for at most a page's worth of ids.
     *
     * <p>The {@code orgId} filter is load-bearing, not defensive tidiness:
     * {@code reviews.product_id} is a bare FK with no org constraint, so an id read off a
     * row is not proof of same-org ownership. A cross-org id simply resolves to no entry
     * here and the row's name comes out null.
     *
     * <p>A blank name, and ingest's {@link #UNSPECIFIED_PRODUCT_NAME} placeholder, both map
     * to no entry for the same reason a missing row does: the contract is a real name or an
     * honest null — never an empty string, and never an artifact, that the UI must decode.
     */
    private Map<UUID, String> productNamesFor(UUID orgId, List<Review> rows) {
        Set<UUID> productIds = rows.stream()
                .map(Review::getProductId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        if (productIds.isEmpty()) {
            return Map.of();
        }
        return products.findAllByOrgIdAndIdIn(orgId, productIds).stream()
                .filter(IngestedReviewVocItemSource::hasDisplayableName)
                .collect(Collectors.toMap(Product::getId, Product::getName));
    }

    /**
     * Whether this product has a name worth showing an operator — decided from the whole
     * {@link Product}, never the name alone, because {@code name} is not independent of
     * {@code sku}.
     *
     * <p>Rejects three states, all of which mean "no name is actually known":
     *
     * <ul>
     *   <li><b>null/blank</b> — nothing to show.
     *   <li><b>{@link #UNSPECIFIED_PRODUCT_NAME}</b> — ingest's placeholder; an artifact, not
     *       a product (see that constant's note).
     *   <li><b>name equal to sku</b> — <b>the load-bearing one.</b> When an ingested row has a
     *       SKU but no name, {@code ProductService.resolveOrCreate} stores the SKU AS the name
     *       ({@code name != null && !name.isBlank() ? name : sku}), and the inquiry mappers
     *       pass a null name whenever a sku exists, so this state is produced by normal
     *       operation, not by bad data. Without this branch the row's "display name" IS the
     *       SKU — 상품번호, i.e. the channel's {@code productNo} — and the identifier this DTO
     *       excludes would reach operators through the one field claiming never to carry it.
     *       Compared on trimmed values because ingest strips on the way in
     *       ({@code HeaderAliases.pick}) and a stored legacy value may not be.
     * </ul>
     *
     * <p>A product with a real name and no sku is displayable — absent identity is not a
     * reason to withhold a name. Read-side only; ingest is unchanged, and the same product
     * keeps its SKU-derived name everywhere else it is already shown.
     */
    private static boolean hasDisplayableName(Product p) {
        String name = p.getName();
        if (name == null || name.isBlank()) {
            return false;
        }
        String trimmedName = name.strip();
        if (UNSPECIFIED_PRODUCT_NAME.equals(trimmedName)) {
            return false;
        }
        String sku = p.getSku();
        return sku == null || sku.isBlank() || !trimmedName.equals(sku.strip());
    }

    /**
     * The channel this account reads, or null when no per-account answer is possible —
     * the account is absent/cross-org, or the org holds more than one account on the
     * channel (see the class note on why that fails closed).
     */
    private UUID unambiguousChannelFor(UUID orgId, UUID accountId) {
        Optional<SellerAccount> account = sellerAccounts.findByIdAndOrgId(accountId, orgId);
        if (account.isEmpty()) {
            return null;
        }
        UUID channelId = account.get().getChannelId();
        if (channelId == null) {
            return null;
        }
        long accountsOnChannel = sellerAccounts.countByOrgIdAndChannelId(orgId, channelId);
        if (accountsOnChannel > 1) {
            // Deliberately loud: the caller turns this into an EMPTY snapshot, which on a
            // dashboard is indistinguishable from "nothing needs your attention". It is not
            // that — it is the surface declining to answer. Without this line the state is
            // undiagnosable from outside, since the response carries no status field.
            // Sanitized: the account COUNT is the whole diagnostic; no org id, account id,
            // channel id, or seller identity is logged.
            log.warn("Ingested-review attention is UNSUPPORTED for this channel: the org holds {} seller "
                    + "accounts on it, and reviews carry no seller_account_id, so a per-account read cannot "
                    + "attribute them. Returning no signals — an ambiguous unsupported state, NOT a "
                    + "confirmed zero. Resolving needs account-scoped ingest.", accountsOnChannel);
            return null;
        }
        return channelId;
    }

    private OperatorVocItem toItem(Review r, AttentionSignalType signalType,
                                   String channelCode, String channelNameKo,
                                   Map<UUID, String> productNames) {
        // Read-time, fail-closed preview — never the raw body, never persisted/logged.
        String safePreview = VocPreviewSanitizer.sanitize(r.getBody()).text();
        // Display name only, straight from the batch map — never the SKU (상품번호, i.e.
        // the channel's productNo), which stays excluded as an identifier. Absent from the
        // map (no link, cross-org, deleted, or blank-named) → null, never a guess.
        String productName = r.getProductId() == null ? null : productNames.get(r.getProductId());
        return new OperatorVocItem(
                channelCode, channelNameKo, SOURCE_TYPE_REVIEW, productName, r.getRating(),
                null,                       // replyStatus — an export carries no reply state
                kstDate(r.getReceivedAt()),
                kstDate(r.getCreatedAt()),  // when SellerOps ingested it
                signalType.name(), safePreview);
    }

    /** Instant → KST calendar date string (date only), or null when unknown. */
    private static String kstDate(Instant instant) {
        return instant == null ? null : instant.atZone(KST).toLocalDate().toString();
    }
}
