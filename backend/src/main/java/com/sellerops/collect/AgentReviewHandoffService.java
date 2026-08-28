package com.sellerops.collect;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.dto.AgentReviewHandoffRequest;
import com.sellerops.collect.dto.AgentReviewHandoffResultView;
import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.common.ApiException;
import com.sellerops.connector.coupang.CoupangApiConnector;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestFollowUp;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariant;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.selleraccount.AccountSessionSlot;
import com.sellerops.selleraccount.AccountSessionSlotRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * **The binding and the mapping, and nothing else.** It resolves the opaque account slot inside the caller's
 * org, guards the channel, turns each acquired row into the canonical review record every other source already
 * produces, and hands the batch to {@link IngestionService} — the one place that knows how a review is deduped
 * and stored.
 *
 * <p>There is deliberately no second dedup rule here. The screen carries no per-review identifier
 * ({@code docs/coupang_review_policy_gate_v1.md} §9.2), so these rows arrive with {@code externalId = null} and
 * fall to the ingestion spine's content hash — which is the fallback it has always had, reached for the reason
 * it exists rather than a Coupang special case. What Coupang changes is only the FORMULA version
 * ({@code ReviewDedupKey.versionFor} → v2, folding rating), and that lives with the other formulas.
 *
 * <p><b>The buyer never arrives.</b> The request record has no author field and rejects unknown properties, the
 * canonical record has none, and the reviews table has no column for one. Three layers, none of which is a
 * filter — a filter is a thing that can be forgotten.
 *
 * <p><b>The review names its product with an id this service does not pass on.</b> Coupang's 상품평 screen
 * prints 노출상품ID, which is neither the 등록상품ID the catalogue is keyed by nor the 옵션ID a variant
 * carries. Sent through as a SKU it matched nothing and the ingestion spine built a second product
 * beside the real one — up to one per listing. So the display id is used here as a LOOKUP KEY into the
 * listings this org has actually read, and what travels on is the SKU of the product that listing
 * already belongs to. Nothing the agent sends is trusted as a canonical identity, and this path can no
 * longer create a product at all: an unresolved review is a counted failure, never a new row.
 *
 * <p><b>Reply state is UNKNOWN, permanently.</b> Coupang gives sellers no way to answer a 상품평, so there is no
 * channel statement to preserve and none is fabricated. A review that cannot be replied to is not "unanswered".
 */
@Service
public class AgentReviewHandoffService {

    private static final Logger log = LoggerFactory.getLogger(AgentReviewHandoffService.class);

    static final String REASON_UNKNOWN_SLOT = "UNKNOWN_ACCOUNT_SLOT";
    static final String REASON_CHANNEL_MISMATCH = "CHANNEL_MISMATCH";
    static final String REASON_UNSUPPORTED_CHANNEL = "UNSUPPORTED_CHANNEL";
    static final String REASON_BAD_DATE = "UNPARSEABLE_REVIEW_DATE";
    static final String REASON_BODY_DISAGREES = "BODY_TEXTLESS_DISAGREEMENT";
    /**
     * A row whose 노출상품ID matches no listing this org has read. Counted as a failure and reported;
     * the rest of the batch still stores.
     *
     * <p>It is NOT a batch refusal, unlike an unparseable date. A bad date means the agent and this
     * record disagree about what was on the screen; an unknown display id is an ordinary state of the
     * world — a catalogue not yet read, or a listing the seller has since removed — and refusing a whole
     * live sitting for it would throw away every page the operator turned by hand.
     */
    static final String REASON_UNRESOLVED_PRODUCT = "UNRESOLVED_DISPLAY_PRODUCT_ID";
    /**
     * A row whose 노출상품ID belongs to more than one product. Counted with the unresolved, and it is a
     * real state of the seller's catalogue, not a defect: Coupang lets several 등록상품 sit behind one
     * exposure page, and 5 of this org's 63 display ids did on 2026-08-23.
     *
     * <p>Attaching the review to either candidate would be a coin toss written into the product's own
     * history, and the 상품평 screen's other column — the 옵션ID — is a second key that could break the
     * tie. Using it is a product decision that has not been taken, so this fails closed and says which
     * rows it could not place.
     */
    static final String REASON_AMBIGUOUS_PRODUCT = "AMBIGUOUS_DISPLAY_PRODUCT_ID";
    /**
     * One 옵션ID, two variant rows. Not a state of the seller's catalogue — a state of OURS: the option id is
     * Coupang's immutable per-option key, so within one org and one channel it names one variant or none.
     *
     * <p>Two would mean the catalogue read wrote the same option twice, and resolving through either of them
     * would attach the review to a product chosen by row order. It is the one place in this path that reports
     * a broken invariant rather than an unknown world, and it fails closed like the rest.
     */
    static final String REASON_AMBIGUOUS_OPTION = "AMBIGUOUS_OPTION_ID";

    /** The one channel this path serves. Widening it is a decision, not a configuration. */
    static final String SUPPORTED_CHANNEL = CoupangApiConnector.CHANNEL_CODE;

    private final AccountSessionSlotRepository slots;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final IngestionService ingestion;
    private final SyncJobRepository syncJobs;
    private final IngestFollowUp followUp;
    private final ChannelProductRepository channelProducts;
    private final ProductRepository products;
    private final ProductVariantRepository variants;

    public AgentReviewHandoffService(AccountSessionSlotRepository slots,
                                     SellerAccountRepository accounts,
                                     ChannelRepository channels,
                                     IngestionService ingestion,
                                     SyncJobRepository syncJobs,
                                     IngestFollowUp followUp,
                                     ChannelProductRepository channelProducts,
                                     ProductRepository products,
                                     ProductVariantRepository variants) {
        this.slots = slots;
        this.accounts = accounts;
        this.channels = channels;
        this.ingestion = ingestion;
        this.syncJobs = syncJobs;
        this.followUp = followUp;
        this.channelProducts = channelProducts;
        this.products = products;
        this.variants = variants;
    }

    /**
     * A mapped batch: the rows that resolved to a product this org already holds, and how many did not.
     *
     * <p>The two travel together because the caller must report a received count that covers both — a
     * handoff of 24 reviews that stored 22 and could not place 2 must not report 22 received.
     */
    private record MappedBatch(List<CanonicalReview> rows, int unresolved) {
    }

    /**
     * One row a listing did not claim, held for the length of one batch and never stored.
     *
     * <p>Ambiguous rows are deliberately NOT here: their product IS in the catalogue — twice — which is a
     * different question from the one the coverage diagnosis asks.
     */
    private record Unplaced(String displayProductId, String vendorItemId) {
    }

    /**
     * What one row's product lookup came to: a SKU, or the named reason it has none.
     *
     * <p>The reason travels rather than being logged where it is discovered, so the batch reports one
     * accurate line instead of one line per row — and so the two failure reasons can be counted apart.
     */
    private record Resolution(String sku, String failureReason) {
        static Resolution resolved(String sku) {
            return new Resolution(sku, null);
        }

        static Resolution failed(String reason) {
            return new Resolution(null, reason);
        }
    }

    /**
     * Store an acquisition's reviews. Fail-closed order: slot → org → account → channel guard → supported
     * channel → map every row → ingest. A request that fails any gate has stored nothing.
     *
     * <p>Mapping is all-or-nothing on purpose: one unparseable date refuses the batch rather than importing the
     * rest. A partial import that returns success is the shape that makes a coverage claim wrong later, and the
     * agent already canonicalizes dates before sending, so a bad one here means the two sides disagree — which
     * is exactly when storing "most of it" is the wrong answer.
     */
    public AgentReviewHandoffResultView handOff(UUID orgId, AgentReviewHandoffRequest request) {
        UUID sellerAccountId = resolveAccount(orgId, request.accountSlot());
        SellerAccount account = requireAccount(orgId, sellerAccountId);
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));

        // The declared channel is a GUARD against a mixed-up slot, never a routing key — the account's real
        // channel decides, and a disagreement is refused before anything is stored.
        if (!channel.getCode().equals(request.channelCode())) {
            throw ApiException.badRequest("수집하려는 채널이 이 판매 계정의 채널과 다릅니다. (" + REASON_CHANNEL_MISMATCH + ")");
        }
        if (!SUPPORTED_CHANNEL.equals(channel.getCode())) {
            throw ApiException.badRequest(
                    "이 채널은 화면 기반 상품평 수집을 지원하지 않습니다. (" + REASON_UNSUPPORTED_CHANNEL + ")");
        }

        MappedBatch batch = mapRows(orgId, channel.getId(), request.reviews());
        List<CanonicalReview> rows = batch.rows();
        // **Stamped BEFORE the write, and that is the whole point.** The import's start is what the review
        // list uses to decide which rows arrived in it (`created_at >= startedAt`). Stamping it afterwards
        // put every freshly-written review a few milliseconds BEFORE its own import, so a handoff that had
        // just stored 22 reviews rendered "새 상품평 0". Found live; the clock was the bug, not the query.
        Instant startedAt = Instant.now();
        IngestOutcome outcome = ingestion.ingestReviews(orgId, channel.getId(), rows);

        // The acquired reviews get the SAME follow-up every other ingest path gets: item-analysis,
        // the issue-memory refresh event, and the customer-memory index. Until now this path did
        // none of the three, so 22 live-acquired Coupang 상품평 could never reach the repeated-issue
        // memory (audit defect C) and never produced an analysis row (defect B). Best-effort inside.
        followUp.afterReviewIngest(orgId, channel.getId(), outcome.insertedIds());

        // Received is what the operator's sitting handed over, not what happened to be placeable — a row
        // this org could not resolve was still read off the screen and must be visible in the count.
        int received = request.reviews().size();
        int failed = outcome.failed() + batch.unresolved();
        SyncJob record = recordImport(orgId, channel.getId(), sellerAccountId, request, received, failed,
                outcome, startedAt);
        // The run row exists only now (it carries the counts), so the provenance stamp (V83) follows it.
        // Bounded to the ids this ingest inserted; a swallowed recordImport failure leaves them unstamped,
        // which reads as NONE — the fail-closed side.
        if (record != null) {
            ingestion.stampAcquisition(orgId, outcome.insertedIds(), record.getId());
        }
        // Counts and enums only. The bodies are in hand at this point, which is exactly why they are not here.
        log.info("Coupang review handoff: received={} stored={} skipped={} failed={} unresolved={} "
                        + "complete={} stopReason={}",
                received, outcome.success(), outcome.skipped(), failed, batch.unresolved(),
                request.complete(), request.stopReason());

        return new AgentReviewHandoffResultView(received, outcome.success(), outcome.skipped(),
                failed, request.complete(),
                record == null ? null : record.getId().toString());
    }

    /**
     * One acquired row → the canonical record.
     *
     * <p>{@code externalId} is null because the channel publishes none. {@code sku} is <b>not</b> the id the
     * agent sent: the agent sends 노출상품ID, which this database keys nothing by, and passing it through as a
     * SKU is what made the ingestion spine create a parallel product for every listing. It is used to FIND the
     * listing instead, and the SKU that travels on belongs to the product that listing is already part of —
     * a value read out of this database, never one the caller supplied.
     *
     * <p>A row whose display id matches no listing is dropped from the batch and counted. It is not rounded up
     * into a new product, and it is not silent.
     *
     * <p>The date is stored as UTC start-of-day for the calendar date the screen printed. That keeps the date
     * part of the content hash byte-identical to what the agent read, and lands on the same calendar day in
     * KST — a review dated 2026-08-11 in WING reads 2026-08-11 to the seller.
     */
    private MappedBatch mapRows(UUID orgId, UUID channelId, List<AgentReviewHandoffRequest.Review> rows) {
        List<CanonicalReview> out = new ArrayList<>(rows.size());
        List<Unplaced> unplaced = new ArrayList<>();
        int unresolved = 0;
        int ambiguous = 0;
        int duplicateOption = 0;
        for (int i = 0; i < rows.size(); i++) {
            AgentReviewHandoffRequest.Review row = rows.get(i);
            // The flag and the body must agree. A textless review with text, or a written review with no
            // text, means the agent and this record disagree about what was on the screen — and the dedup
            // key differs between the two, so guessing which is right would key the row wrongly.
            if (row.textless() != row.body().isBlank()) {
                throw ApiException.badRequest(
                        "상품평 본문과 '본문 없음' 표시가 서로 맞지 않습니다. (" + REASON_BODY_DISAGREES + ")");
            }
            Instant receivedAt = parseDate(row.writtenOn());
            Resolution resolution = catalogSkuFor(orgId, channelId, row.productId(), row.vendorItemId());
            if (resolution.sku() == null) {
                unresolved++;
                if (REASON_AMBIGUOUS_PRODUCT.equals(resolution.failureReason())) {
                    ambiguous++;
                } else if (REASON_AMBIGUOUS_OPTION.equals(resolution.failureReason())) {
                    duplicateOption++;
                } else {
                    unplaced.add(new Unplaced(row.productId(), row.vendorItemId()));
                }
                continue;
            }
            String sku = resolution.sku();
            out.add(new CanonicalReview(
                    row.productName(),
                    sku,
                    row.rating(),
                    row.body(),
                    receivedAt,
                    null,
                    i + 1,
                    // Coupang has no seller reply to a 상품평 — there is nothing for the channel to state.
                    ReviewReplyState.UNKNOWN,
                    null,
                    row.vendorItemId(),
                    row.mediaCount(),
                    row.textless()));
        }
        if (unresolved > 0) {
            // The two reasons are counted apart because they mean opposite things to whoever reads this. A
            // display id with no listing is a catalogue that does not cover the review; an ambiguous one is a
            // catalogue that covers it twice. The first live sitting logged 11 rows under the first sentence
            // when one of them was the second, which is the kind of small untruth that sends someone looking
            // in the wrong place. Counts and reason names only — never the ids themselves.
            log.warn("Coupang review handoff: {} row(s) unplaced — {} matched no 옵션ID and no 노출상품ID this "
                            + "org holds ({}), {} matched more than one product and the 옵션ID did not choose "
                            + "exactly one ({}), {} named an 옵션ID this catalogue holds TWICE ({})",
                    unresolved, unresolved - ambiguous - duplicateOption, REASON_UNRESOLVED_PRODUCT,
                    ambiguous, REASON_AMBIGUOUS_PRODUCT,
                    duplicateOption, REASON_AMBIGUOUS_OPTION);
        }
        if (!unplaced.isEmpty()) {
            logCoverageDiagnosis(orgId, unplaced);
        }
        return new MappedBatch(out, unresolved);
    }

    /**
     * Why the catalogue did not cover these rows — <b>as counts, and only for the rows no listing claimed</b>.
     *
     * <p>The live sitting of 2026-08-23 placed 11 of 22 상품평 and refused 10 for want of a listing, and the
     * evidence needed to say WHY does not survive the run: the failed rows are not stored, by design. This
     * asks the one question that separates the two explanations without keeping anything — whether the org
     * already holds the product under a different 노출상품ID, which its 옵션ID would prove.
     *
     * <p><b>It answered, and the answer changed the resolver</b> (2026-08-23): 10 of 10, every unplaced row
     * had its option here. So the reading has moved on with it — the option id now leads, and a row that
     * still reaches this log did NOT match one within its org and channel.
     *
     * <ul>
     *   <li>{@code optionInCatalogue = 0} — expected. The option is nowhere in this org, so the review names
     *       a product that was never read, and the display id could not place it either.</li>
     *   <li>{@code optionInCatalogue > 0} — the option exists in this org but on ANOTHER channel, since the
     *       primary lookup already searched this one. Worth knowing and not worth guessing about: this query
     *       is org-scoped where resolution is org- AND channel-scoped, which is exactly the gap it reports.</li>
     * </ul>
     *
     * <p>Counts only, never an id — the same contract the line above it keeps. And it runs strictly after
     * resolution has already failed: nothing it computes can travel back into what gets stored.
     */
    private void logCoverageDiagnosis(UUID orgId, List<Unplaced> unplaced) {
        Set<String> optionIds = new LinkedHashSet<>();
        Set<String> displayIds = new LinkedHashSet<>();
        int noOption = 0;
        for (Unplaced row : unplaced) {
            if (row.displayProductId() != null && !row.displayProductId().isBlank()) {
                displayIds.add(row.displayProductId());
            }
            if (row.vendorItemId() == null || row.vendorItemId().isBlank()) {
                noOption++;
            } else {
                optionIds.add(row.vendorItemId());
            }
        }
        Set<String> known = optionIds.isEmpty()
                ? Set.of()
                : Set.copyOf(variants.findKnownExternalVariantIds(orgId, optionIds));
        int inCatalogue = 0;
        for (Unplaced row : unplaced) {
            if (row.vendorItemId() != null && known.contains(row.vendorItemId())) {
                inCatalogue++;
            }
        }
        log.warn("Coupang review coverage diagnosis: rows={} distinctDisplayIds={} distinctOptionIds={} "
                        + "optionInCatalogue={} optionNotInCatalogue={} noOptionOnScreen={} — the 옵션ID now "
                        + "resolves first, so zero is the expected reading; a nonzero optionInCatalogue means "
                        + "the option sits in this org on a DIFFERENT channel.",
                unplaced.size(), displayIds.size(), optionIds.size(),
                inCatalogue, unplaced.size() - inCatalogue - noOption, noOption);
    }

    /**
     * 옵션ID first, 노출상품ID second → the SKU of the ONE product the review names, or null.
     *
     * <p><b>Why the order changed (2026-08-23).</b> The display id led for one sitting and placed 12 of 23
     * rows. The diagnosis behind the other 10 came back the opposite of expected: <b>10 of 10 already had a
     * variant in this catalogue</b> under their 옵션ID. Nothing was missing — the 노출상품ID had moved.
     * Coupang may change a {@code productId} by merging or splitting an exposure page, so a 상품평 carries
     * the id it was WRITTEN under while the listing carries the one the API states TODAY, and a column that
     * holds one value cannot hold both. The 옵션ID has no such property: it is the per-option key and it does
     * not move. So it leads, and the display id is what answers when the screen printed no option.
     *
     * <p>The contract, in order, and every step fails closed:
     *
     * <ol>
     *   <li><b>옵션ID, scoped to this org and this channel.</b> Exactly one variant ⇒ that variant's product.
     *       Zero ⇒ fall through to the display id, which is a real case: a review older than the catalogue
     *       read, or an option since removed. More than one ⇒ {@link #REASON_AMBIGUOUS_OPTION}, refused.</li>
     *   <li>the display id selects candidate listings — org- and channel-scoped, {@code RealDataOnly}-filtered;</li>
     *   <li>one candidate product ⇒ resolved;</li>
     *   <li>several listings for the SAME product ⇒ still one answer, resolved;</li>
     *   <li>several DIFFERENT products ⇒ the 옵션ID breaks the tie <b>inside</b> that candidate set;</li>
     *   <li>exactly one variant match ⇒ resolved; zero, several, or no 옵션ID at all ⇒ refused;</li>
     *   <li>and the SKU that leaves here must resolve back to the very product chosen, or nothing does.</li>
     * </ol>
     *
     * <p><b>The scope is org + channel, and that is the finest grain the catalogue has.</b> Neither
     * {@code product_variants} nor {@code channel_products} carries a seller-account column, so an org with
     * two Coupang accounts would have them share this lookup. Stated rather than implied: the account
     * dimension is absent from the catalogue schema, and narrowing to it is a change to that schema, not to
     * this method.
     *
     * <p>The last step is what keeps a wrong id out of the dedup hash. The ingestion spine keys a review on
     * the product it resolves the SKU to, so handing over a SKU that means a different product would write a
     * hash nothing can correct afterwards — the review would be un-findable and would re-store on the next
     * sweep. Cheap to check, and the only way this method can be wrong is if it is not.
     *
     * <p>Nothing here creates a product, a listing, or a variant. Every path returns either a SKU this
     * database already holds or null.
     */
    private Resolution catalogSkuFor(UUID orgId, UUID channelId, String displayProductId, String vendorItemId) {
        if (isPresent(vendorItemId)) {
            List<ProductVariant> options = variants
                    .findByOrgIdAndChannelIdAndExternalVariantId(orgId, channelId, vendorItemId);
            if (options.size() > 1) {
                return Resolution.failed(REASON_AMBIGUOUS_OPTION);
            }
            if (options.size() == 1) {
                return skuOf(orgId, options.get(0).getProductId());
            }
            // Zero. The option is not in this catalogue, so the display id gets its turn.
        }
        return byDisplayProductId(orgId, channelId, displayProductId, vendorItemId);
    }

    /** The 노출상품ID path — unchanged, and now the fallback rather than the lead. */
    private Resolution byDisplayProductId(UUID orgId, UUID channelId, String displayProductId,
                                          String vendorItemId) {
        if (!isPresent(displayProductId)) {
            return Resolution.failed(REASON_UNRESOLVED_PRODUCT);
        }
        List<ChannelProduct> listings = channelProducts
                .findAllByOrgIdAndChannelIdAndExternalDisplayProductId(orgId, channelId, displayProductId);
        if (listings.isEmpty()) {
            return Resolution.failed(REASON_UNRESOLVED_PRODUCT);
        }
        List<UUID> candidates = listings.stream().map(ChannelProduct::getProductId).distinct().toList();

        UUID chosen;
        if (candidates.size() == 1) {
            // One product, however many listings sit in front of it.
            chosen = candidates.get(0);
        } else {
            chosen = tieBreakByOption(orgId, candidates, vendorItemId);
            if (chosen == null) {
                return Resolution.failed(REASON_AMBIGUOUS_PRODUCT);
            }
        }

        return skuOf(orgId, chosen);
    }

    /** Present means "the screen printed something here" — null and blank are the same absence. */
    private static boolean isPresent(String value) {
        return value != null && !value.isBlank();
    }

    /**
     * The chosen product's SKU, or nothing — with the round trip both paths must survive.
     *
     * <p>{@code findAllByOrgIdAndIdIn} passes the {@code RealDataOnly} filter, so a DEMO_SEED product is not
     * reachable here however it was chosen. The round trip then checks the direction the spine will actually
     * travel: it takes a SKU and finds a product, and that product must be this one.
     */
    private Resolution skuOf(UUID orgId, UUID chosen) {
        Product product = products.findAllByOrgIdAndIdIn(orgId, List.of(chosen))
                .stream().findFirst().orElse(null);
        if (product == null || product.getSku() == null || product.getSku().isBlank()) {
            return Resolution.failed(REASON_UNRESOLVED_PRODUCT);
        }
        UUID roundTrip = products.findByOrgIdAndSku(orgId, product.getSku()).map(Product::getId).orElse(null);
        return chosen.equals(roundTrip)
                ? Resolution.resolved(product.getSku())
                : Resolution.failed(REASON_UNRESOLVED_PRODUCT);
    }

    /**
     * The 옵션ID chooses between the candidates, or nobody does.
     *
     * <p>The variant lookup names the candidate products, so a matching option on some other product in the
     * catalogue cannot answer. Exactly one candidate must own the option: zero means the screen and the
     * catalogue disagree, and more than one means the option is not the discriminator here — in both cases
     * the honest answer is that this review's product is unknown.
     */
    private UUID tieBreakByOption(UUID orgId, List<UUID> candidates, String vendorItemId) {
        if (vendorItemId == null || vendorItemId.isBlank()) {
            return null;
        }
        List<UUID> owners = variants
                .findByOrgIdAndProductIdInAndExternalVariantId(orgId, candidates, vendorItemId)
                .stream().map(ProductVariant::getProductId).distinct().toList();
        return owners.size() == 1 ? owners.get(0) : null;
    }

    private Instant parseDate(String writtenOn) {
        try {
            return LocalDate.parse(writtenOn).atStartOfDay(ZoneOffset.UTC).toInstant();
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("상품평 작성일을 읽을 수 없습니다. (" + REASON_BAD_DATE + ")");
        }
    }

    /**
     * The operator's record that the import happened, in the same {@code sync_jobs} table every other
     * collection lands in. {@code method = SELLER_CENTER_READ} is the honest provenance: a screen was read, not
     * a file exported.
     *
     * <p>A failure to record is swallowed. The reviews are already stored, and losing the history row is a
     * strictly smaller harm than turning a successful import into a 500 the agent would report as a failure —
     * the same reasoning the credential handoff applies to its post-store verification.
     */
    private SyncJob recordImport(UUID orgId, UUID channelId, UUID sellerAccountId,
                                 AgentReviewHandoffRequest request, int received, int failed,
                                 IngestOutcome outcome, Instant startedAt) {
        try {
            SyncJob job = new SyncJob();
            job.setOrgId(orgId);
            job.setChannelId(channelId);
            job.setSellerAccountId(sellerAccountId);
            job.setDataType("REVIEW");
            job.setUploadType("REVIEW");
            job.setJobType("AGENT_HANDOFF");
            job.setMethod(CollectionMethod.SELLER_CENTER_READ.name());
            job.setTrigger("ACTION_WINDOW");
            job.setStartedAt(startedAt);
            job.setFinishedAt(Instant.now());
            job.setTotalRows(received);
            job.setSuccessRows(outcome.success());
            job.setSkippedRows(outcome.skipped());
            job.setFailedRows(failed);
            // PARTIAL, not SUCCESS, when the walk did not cover the list: the row is the operator's evidence,
            // and it must not read as a completed import of a list that was never reached the end of.
            job.setStatus(failed > 0 || !request.complete() ? "PARTIAL" : "SUCCESS");
            job.setErrorMessage(request.complete() ? null : request.stopReason());
            return syncJobs.save(job);
        } catch (RuntimeException e) {
            log.warn("Coupang review handoff stored, import history not recorded: type={}",
                    e.getClass().getSimpleName());
            return null;
        }
    }

    /** Resolve the slot inside the caller's org. Absent and other-org give the SAME answer. */
    private UUID resolveAccount(UUID orgId, String accountSlot) {
        return slots.findByAccountSlot(accountSlot)
                .filter(slot -> orgId.equals(slot.getOrgId()))
                .map(AccountSessionSlot::getSellerAccountId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다. (" + REASON_UNKNOWN_SLOT + ")"));
    }

    private SellerAccount requireAccount(UUID orgId, UUID sellerAccountId) {
        SellerAccount account = accounts.findById(sellerAccountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        if (account.isFileUpload()) {
            throw ApiException.badRequest(
                    "이 계정은 파일 업로드 계정이라 화면 기반 수집을 사용할 수 없습니다. (" + REASON_UNSUPPORTED_CHANNEL + ")");
        }
        return account;
    }
}
