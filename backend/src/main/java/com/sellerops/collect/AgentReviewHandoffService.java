package com.sellerops.collect;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.dto.AgentReviewHandoffRequest;
import com.sellerops.collect.dto.AgentReviewHandoffResultView;
import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.common.ApiException;
import com.sellerops.connector.coupang.CoupangApiConnector;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalReview;
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

    /** The one channel this path serves. Widening it is a decision, not a configuration. */
    static final String SUPPORTED_CHANNEL = CoupangApiConnector.CHANNEL_CODE;

    private final AccountSessionSlotRepository slots;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final IngestionService ingestion;
    private final SyncJobRepository syncJobs;

    public AgentReviewHandoffService(AccountSessionSlotRepository slots,
                                     SellerAccountRepository accounts,
                                     ChannelRepository channels,
                                     IngestionService ingestion,
                                     SyncJobRepository syncJobs) {
        this.slots = slots;
        this.accounts = accounts;
        this.channels = channels;
        this.ingestion = ingestion;
        this.syncJobs = syncJobs;
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

        List<CanonicalReview> rows = mapRows(request.reviews());
        // **Stamped BEFORE the write, and that is the whole point.** The import's start is what the review
        // list uses to decide which rows arrived in it (`created_at >= startedAt`). Stamping it afterwards
        // put every freshly-written review a few milliseconds BEFORE its own import, so a handoff that had
        // just stored 22 reviews rendered "새 상품평 0". Found live; the clock was the bug, not the query.
        Instant startedAt = Instant.now();
        IngestOutcome outcome = ingestion.ingestReviews(orgId, channel.getId(), rows);

        SyncJob record = recordImport(orgId, channel.getId(), sellerAccountId, request, rows.size(), outcome,
                startedAt);
        // Counts and enums only. The bodies are in hand at this point, which is exactly why they are not here.
        log.info("Coupang review handoff: received={} stored={} skipped={} failed={} complete={} stopReason={}",
                rows.size(), outcome.success(), outcome.skipped(), outcome.failed(),
                request.complete(), request.stopReason());

        return new AgentReviewHandoffResultView(rows.size(), outcome.success(), outcome.skipped(),
                outcome.failed(), request.complete(),
                record == null ? null : record.getId().toString());
    }

    /**
     * One acquired row → the canonical record. {@code externalId} is null because the channel publishes none;
     * {@code sku} is Coupang's 노출상품ID, which is the catalog identity the seller sees on the screen.
     *
     * <p>The date is stored as UTC start-of-day for the calendar date the screen printed. That keeps the date
     * part of the content hash byte-identical to what the agent read, and lands on the same calendar day in
     * KST — a review dated 2026-08-11 in WING reads 2026-08-11 to the seller.
     */
    private List<CanonicalReview> mapRows(List<AgentReviewHandoffRequest.Review> rows) {
        List<CanonicalReview> out = new ArrayList<>(rows.size());
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
            out.add(new CanonicalReview(
                    row.productName(),
                    row.productId(),
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
        return out;
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
                                 AgentReviewHandoffRequest request, int received, IngestOutcome outcome,
                                 Instant startedAt) {
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
            job.setFailedRows(outcome.failed());
            // PARTIAL, not SUCCESS, when the walk did not cover the list: the row is the operator's evidence,
            // and it must not read as a completed import of a list that was never reached the end of.
            job.setStatus(outcome.failed() > 0 || !request.complete() ? "PARTIAL" : "SUCCESS");
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
