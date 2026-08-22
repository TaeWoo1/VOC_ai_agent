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
import java.util.List;
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

    public AgentReviewHandoffService(AccountSessionSlotRepository slots,
                                     SellerAccountRepository accounts,
                                     ChannelRepository channels,
                                     IngestionService ingestion,
                                     SyncJobRepository syncJobs,
                                     IngestFollowUp followUp,
                                     ChannelProductRepository channelProducts,
                                     ProductRepository products) {
        this.slots = slots;
        this.accounts = accounts;
        this.channels = channels;
        this.ingestion = ingestion;
        this.syncJobs = syncJobs;
        this.followUp = followUp;
        this.channelProducts = channelProducts;
        this.products = products;
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
        int unresolved = 0;
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
            String sku = catalogSkuFor(orgId, channelId, row.productId());
            if (sku == null) {
                unresolved++;
                continue;
            }
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
            // Counts only, and the reason by name. The display ids themselves are the seller's catalogue
            // identifiers and there is nothing a log line does with them that a count does not.
            log.warn("Coupang review handoff: {} row(s) named a 노출상품ID this org holds no listing for ({})",
                    unresolved, REASON_UNRESOLVED_PRODUCT);
        }
        return new MappedBatch(out, unresolved);
    }

    /**
     * 노출상품ID → the SKU of the product that listing belongs to, or null when this org holds no such listing.
     *
     * <p>Four fail-closed steps, and none of them creates anything. The listing lookup is org-scoped and
     * passes through the {@code RealDataOnly} filter, so a synthetic listing cannot answer for a real review.
     * A listing whose product has since gone, or a product with no SKU to identify it by, is treated the same
     * as no listing at all: this method exists to hand the ingestion spine a key that means exactly one
     * product, and "probably that one" is not that.
     */
    private String catalogSkuFor(UUID orgId, UUID channelId, String displayProductId) {
        if (displayProductId == null || displayProductId.isBlank()) {
            return null;
        }
        List<ChannelProduct> listings = channelProducts
                .findAllByOrgIdAndChannelIdAndExternalDisplayProductId(orgId, channelId, displayProductId);
        if (listings.isEmpty()) {
            return null;
        }
        // Several listings behind one exposure page are fine as long as they are the SAME product — that
        // is one product listed twice, and the review belongs to it either way. Two products is a
        // question this row cannot answer, and a guess would be indistinguishable from a fact afterwards.
        List<UUID> candidates = listings.stream().map(ChannelProduct::getProductId).distinct().toList();
        if (candidates.size() > 1) {
            log.warn("Coupang review handoff: a 노출상품ID maps to {} products ({})",
                    candidates.size(), REASON_AMBIGUOUS_PRODUCT);
            return null;
        }
        ChannelProduct listing = listings.get(0);
        // findAllByOrgIdAndIdIn, deliberately, and NOT findById: a Hibernate filter does not touch a
        // findById, so the id-lookup would hand back a synthetic product the listing lookup had just
        // refused to return. Same filter on both sides, or the fence has a door in it.
        Product product = products.findAllByOrgIdAndIdIn(orgId, List.of(listing.getProductId()))
                .stream().findFirst().orElse(null);
        if (product == null || product.getSku() == null || product.getSku().isBlank()) {
            return null;
        }
        return product.getSku();
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
