package com.sellerops.inquiry.esmimport;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.connector.esm.EsmApiConnector;
import com.sellerops.credential.CredentialVault;
import com.sellerops.ingest.parse.FileParser;
import com.sellerops.ingest.parse.ParsedTable;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.esmimport.EsmInquiryImportWriter.ApplyResult;
import com.sellerops.inquiry.esmimport.dto.EsmInquiryConfirmResponse;
import com.sellerops.inquiry.esmimport.dto.EsmInquiryPreviewResponse;
import com.sellerops.inquiry.esmimport.dto.EsmInquiryRowErrorDto;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Orchestrates the ESM inquiry Excel-import: a strict two-step preview → confirm feeding
 * the existing canonical inquiry workflow. Preview writes nothing and returns a signed,
 * expiring token binding the exact file + account + marketplace + canonical result +
 * existing DB state. Confirm re-parses the re-uploaded file, and:
 * <ol>
 *   <li>verifies the file/contract bindings (fileHash, headers, row count, canonical hash);</li>
 *   <li>if a completed batch already exists for this exact file+account+marketplace,
 *       returns its durable prior result (idempotent replay) with zero writes;</li>
 *   <li>otherwise verifies the existing-state hash (drift → reject) and applies the whole
 *       import as one file-level transaction ({@link EsmInquiryImportWriter}).</li>
 * </ol>
 * Fail-closed throughout; buyer id and inquiry/answer content are never logged or returned.
 * Registered only when {@code sellerops.inquiry-import.esm.enabled=true}.
 */
@Service
@ConditionalOnProperty(name = "sellerops.inquiry-import.esm.enabled", havingValue = "true")
public class EsmInquiryImportService {

    static final String CONFIRM_VALUE = "CONFIRM_IMPORT";
    private static final long PREVIEW_TTL_MS = 30 * 60 * 1000L;

    private final FileParser fileParser;
    private final EsmInquiryRowMapper mapper;
    private final InquiryRepository inquiries;
    private final InquiryWorkItemRepository workItems;
    private final InquiryImportBatchRepository batches;
    private final SellerAccountRepository sellerAccounts;
    private final ChannelRepository channels;
    private final CredentialVault vault;
    private final PreviewTokenService tokenService;
    private final EsmInquiryImportWriter writer;

    public EsmInquiryImportService(FileParser fileParser, EsmInquiryRowMapper mapper,
                                   InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                                   InquiryImportBatchRepository batches,
                                   SellerAccountRepository sellerAccounts, ChannelRepository channels,
                                   CredentialVault vault, PreviewTokenService tokenService,
                                   EsmInquiryImportWriter writer) {
        this.fileParser = fileParser;
        this.mapper = mapper;
        this.inquiries = inquiries;
        this.workItems = workItems;
        this.batches = batches;
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
        this.vault = vault;
        this.tokenService = tokenService;
        this.writer = writer;
    }

    // ---- preview (zero writes) -------------------------------------------------

    public EsmInquiryPreviewResponse preview(UUID orgId, UUID channelId, UUID sellerAccountId,
                                             EsmMarketplace marketplace, String filename, byte[] bytes,
                                             Instant now) {
        Prepared p = prepare(orgId, channelId, sellerAccountId, marketplace, filename, bytes, true);
        Plan plan = plan(orgId, p);

        PreviewToken claims = new PreviewToken(orgId, sellerAccountId, marketplace,
                p.fileHash, EsmInquiryImportHeaders.signature(), p.rowCount, p.canonicalPreviewHash,
                plan.existingStateHash, now.toEpochMilli(), now.toEpochMilli() + PREVIEW_TTL_MS);
        String token = tokenService.issue(claims);

        // Only malformed buyer rows are errors; excluded (operational/unsupported) rows are not.
        List<EsmInquiryRowErrorDto> errors = p.classified.stream()
                .filter(r -> r.reason() != null)
                .map(r -> new EsmInquiryRowErrorDto(r.sourceRow(), r.reason().name()))
                .toList();

        return new EsmInquiryPreviewResponse(plan.newUnanswered, plan.newAnswered, plan.statusUpdates,
                plan.unchangedDuplicates, plan.operationalNotices, plan.unsupported, plan.invalid,
                errors, token);
    }

    // ---- confirm (persists) ----------------------------------------------------

    public EsmInquiryConfirmResponse confirm(UUID orgId, UUID uploadedBy, String previewToken,
                                             String confirmation, String filename, byte[] bytes,
                                             Instant now) {
        if (!CONFIRM_VALUE.equals(confirmation)) {
            throw ApiException.badRequest("확인 값이 올바르지 않습니다.");
        }
        PreviewToken claims = tokenService.verify(previewToken, now);
        if (!claims.orgId().equals(orgId)) {
            throw ApiException.forbidden("미리보기 토큰이 현재 조직의 것이 아닙니다.");
        }
        UUID sellerAccountId = claims.sellerAccountId();
        EsmMarketplace marketplace = claims.marketplace();

        // Re-derive the file/contract bindings from the re-uploaded file.
        Prepared p = prepare(orgId, null, sellerAccountId, marketplace, filename, bytes, false);
        requireMatch(claims.fileHash(), p.fileHash);
        requireMatch(claims.headerSignature(), EsmInquiryImportHeaders.signature());
        requireMatch(Integer.toString(claims.rowCount()), Integer.toString(p.rowCount));
        requireMatch(claims.canonicalPreviewHash(), p.canonicalPreviewHash);

        // (1) Idempotent replay: the same file already imported returns its durable result,
        //     independent of any DB-state drift the successful first import itself caused.
        Optional<InquiryImportBatch> existing = batches
                .findByOrgIdAndSellerAccountIdAndMarketplaceAndFileHash(
                        orgId, sellerAccountId, marketplace, p.fileHash);
        if (existing.isPresent()) {
            return replayResult(existing.get(), p);
        }

        // (2) Fresh import: only now does the existing-state hash matter (drift → reject).
        Plan plan = plan(orgId, p);
        requireMatch(claims.existingStateHash(), plan.existingStateHash);

        // (3) A file with no buyer rows (e.g. only operational notices) writes nothing —
        //     no batch, no domain rows — and reports the excluded counts.
        if (!plan.hasBuyerRows()) {
            return new EsmInquiryConfirmResponse(null, 0, 0, 0, 0,
                    plan.operationalNotices, plan.unsupported, false);
        }

        EsmImportContext ctx = new EsmImportContext(orgId, sellerAccountId, p.gmarketChannelId,
                marketplace, filename, p.fileHash, EsmInquiryImportHeaders.signature(),
                p.canonicalPreviewHash, p.rowCount, uploadedBy);
        try {
            ApplyResult r = writer.apply(ctx, plan.rows);
            return new EsmInquiryConfirmResponse(r.batchId(), r.inserted(), r.statusUpdated(),
                    r.skipped(), r.rejected(), plan.operationalNotices, plan.unsupported, false);
        } catch (DataIntegrityViolationException raced) {
            // A concurrent confirm won the batch unique key and committed first; the whole
            // apply rolled back — return the winner's durable result.
            InquiryImportBatch winner = batches.findByOrgIdAndSellerAccountIdAndMarketplaceAndFileHash(
                    orgId, sellerAccountId, marketplace, p.fileHash).orElseThrow(() -> raced);
            return replayResult(winner, p);
        }
    }

    /** Return a completed batch's durable totals, verifying it is the same import contract. */
    private EsmInquiryConfirmResponse replayResult(InquiryImportBatch batch, Prepared p) {
        if (!batch.getCanonicalPreviewHash().equals(p.canonicalPreviewHash)
                || !batch.getHeaderSignature().equals(EsmInquiryImportHeaders.signature())
                || batch.getRowCount() != p.rowCount) {
            // Same file hash but a different canonical contract — refuse rather than
            // return another import's result.
            throw ApiException.conflict("기존 가져오기 배치와 파일 계약이 일치하지 않습니다.");
        }
        // Operational/unsupported counts are file-intrinsic — recompute from the re-parsed
        // file (they are never stored in the batch, so no migration is needed).
        int operationalNotices = (int) p.classified.stream()
                .filter(EsmClassifiedRow::operationalNotice).count();
        int unsupported = (int) p.classified.stream()
                .filter(EsmClassifiedRow::unsupported).count();
        return new EsmInquiryConfirmResponse(batch.getId(), batch.getInserted(),
                batch.getStatusUpdated(), batch.getSkipped(), batch.getRejected(),
                operationalNotices, unsupported, true);
    }

    // ---- shared preparation ----------------------------------------------------

    private Prepared prepare(UUID orgId, UUID channelId, UUID sellerAccountId,
                             EsmMarketplace marketplace, String filename, byte[] bytes,
                             boolean enforceRequestChannel) {
        if (bytes == null || bytes.length == 0) {
            throw ApiException.badRequest("파일이 비어 있습니다.");
        }
        if (marketplace == null) {
            throw ApiException.badRequest("마켓플레이스(GMARKET/AUCTION)를 선택해야 합니다.");
        }
        UUID gmarketChannelId = gmarketChannelId();
        if (enforceRequestChannel && !gmarketChannelId.equals(channelId)) {
            throw ApiException.badRequest("channelId는 GMARKET 채널이어야 합니다.");
        }

        SellerAccount account = sellerAccounts.findByIdAndOrgId(sellerAccountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        if (!gmarketChannelId.equals(account.getChannelId())) {
            throw ApiException.badRequest("선택한 판매 계정이 GMARKET 채널이 아닙니다.");
        }

        String fileHash = sha256Hex(bytes);
        ParsedTable table = fileParser.parse(filename, new ByteArrayInputStream(bytes));
        if (!EsmInquiryImportHeaders.matches(table)) {
            throw ApiException.badRequest("ESM 문의 엑셀 형식이 아닙니다. 헤더가 정확히 일치해야 합니다.");
        }

        List<EsmClassifiedRow> classified = mapper.classify(table, marketplace, sellerAccountId);
        crossCheckSellingId(orgId, sellerAccountId, marketplace, classified);

        String canonicalPreviewHash = canonicalPreviewHash(classified);
        return new Prepared(gmarketChannelId, fileHash, table.rows().size(), classified, canonicalPreviewHash);
    }

    /**
     * Fail-closed selling-id validation: <b>every</b> data row must carry a 판매아이디, all
     * rows must share the same one, and it must equal the account's configured selling id
     * for the marketplace. Any blank, mixed, or mismatched value — or a missing configured
     * identity — rejects the whole file.
     */
    private void crossCheckSellingId(UUID orgId, UUID sellerAccountId, EsmMarketplace marketplace,
                                     List<EsmClassifiedRow> classified) {
        if (!vault.hasCredential(orgId, sellerAccountId)) {
            throw ApiException.badRequest("판매 계정의 자격 증명(판매자 ID)이 없습니다.");
        }
        String configured = vault.open(orgId, sellerAccountId).secrets().get(marketplace.sellerIdSecretKey());
        if (configured == null || configured.isBlank()) {
            throw ApiException.badRequest("선택한 마켓플레이스의 판매자 ID가 설정되어 있지 않습니다.");
        }
        String expected = configured.strip();

        Set<String> distinct = new LinkedHashSet<>();
        for (EsmClassifiedRow row : classified) {
            if (row.sellerId() == null || row.sellerId().isBlank()) {
                throw ApiException.badRequest("판매아이디가 비어 있는 행이 있습니다.");
            }
            distinct.add(row.sellerId().strip());
        }
        if (distinct.size() > 1) {
            throw ApiException.badRequest("파일에 서로 다른 판매자 ID가 섞여 있습니다.");
        }
        for (String id : distinct) {
            if (!id.equals(expected)) {
                throw ApiException.badRequest("파일의 판매자 ID가 선택한 계정과 일치하지 않습니다.");
            }
        }
    }

    // ---- planning against current DB state (read only) -------------------------

    private Plan plan(UUID orgId, Prepared p) {
        List<PlannedRow> rows = new ArrayList<>();
        Set<String> seenExternal = new LinkedHashSet<>();
        List<String> stateLines = new ArrayList<>();
        int newUnanswered = 0;
        int newAnswered = 0;
        int statusUpdates = 0;
        int unchanged = 0;
        int operationalNotices = 0;
        int unsupported = 0;
        int invalid = 0;

        for (EsmClassifiedRow row : p.classified) {
            // Excluded (non-buyer) kinds never persist and are not malformed errors.
            if (row.operationalNotice()) {
                rows.add(new PlannedRow(row, EsmRowDisposition.OPERATIONAL_NOTICE, null));
                operationalNotices++;
                continue;
            }
            if (row.unsupported()) {
                rows.add(new PlannedRow(row, EsmRowDisposition.UNSUPPORTED, null));
                unsupported++;
                continue;
            }
            if (!row.valid()) {
                rows.add(new PlannedRow(row, EsmRowDisposition.INVALID, null));
                invalid++;
                continue;
            }
            String externalId = row.canonical().externalId();
            if (!seenExternal.add(externalId)) {
                rows.add(new PlannedRow(row, EsmRowDisposition.UNCHANGED_DUPLICATE, null));
                unchanged++;
                continue;
            }
            Optional<Inquiry> existing = inquiries
                    .findByOrgIdAndChannelIdAndExternalId(orgId, p.gmarketChannelId, externalId);
            if (existing.isEmpty()) {
                boolean answered = EsmInquiryStatusClassifier.ANSWERED.equals(row.status());
                rows.add(new PlannedRow(row,
                        answered ? EsmRowDisposition.NEW_ANSWERED : EsmRowDisposition.NEW_UNANSWERED, null));
                if (answered) {
                    newAnswered++;
                } else {
                    newUnanswered++;
                }
                continue;
            }
            Inquiry inq = existing.get();
            Optional<InquiryWorkItem> wi = workItems.findByInquiryId(inq.getId());
            InquiryWorkItemPhase phase = wi.map(InquiryWorkItem::getPhase).orElse(null);
            EsmRowDisposition disp = EsmInquiryReconciler.decide(inq.getStatus(), phase, row.status());
            rows.add(new PlannedRow(row, disp, inq.getId()));
            if (disp == EsmRowDisposition.STATUS_UPDATE) {
                statusUpdates++;
            } else {
                unchanged++;
            }
            // Bind existing DB state (no content/PII) so a later change invalidates confirm.
            stateLines.add(inq.getId() + "|" + inq.getStatus() + "|"
                    + wi.map(w -> w.getId().toString()).orElse("") + "|"
                    + (phase == null ? "" : phase.name()));
        }
        Collections.sort(stateLines);
        String existingStateHash = sha256Hex(String.join("\n", stateLines).getBytes(StandardCharsets.UTF_8));
        return new Plan(rows, existingStateHash, newUnanswered, newAnswered, statusUpdates, unchanged,
                operationalNotices, unsupported, invalid);
    }

    /**
     * File-intrinsic canonical result hash: fully determined by (file bytes, marketplace,
     * seller account) and independent of DB state, so preview and confirm reproduce it
     * identically. Per row: source row, verdict (status or INVALID+reason), fingerprint.
     */
    private String canonicalPreviewHash(List<EsmClassifiedRow> classified) {
        StringBuilder sb = new StringBuilder();
        for (EsmClassifiedRow row : classified) {
            sb.append(row.sourceRow()).append('|');
            sb.append(rowVerdict(row)).append('|');
            sb.append(row.valid() ? row.fingerprint() : "").append('\n');
        }
        return sha256Hex(sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    /** Deterministic per-row verdict marker for the canonical hash (file-intrinsic). */
    private static String rowVerdict(EsmClassifiedRow row) {
        if (row.operationalNotice()) {
            return "OPERATIONAL_NOTICE";
        }
        if (row.unsupported()) {
            return "UNSUPPORTED";
        }
        return row.valid() ? row.status() : "INVALID:" + row.reason().name();
    }

    UUID gmarketChannelId() {
        return channels.findByCode(EsmApiConnector.CHANNEL_CODE)
                .map(Channel::getId)
                .orElseThrow(() -> ApiException.badRequest("GMARKET 채널이 없습니다."));
    }

    private static void requireMatch(String expected, String actual) {
        if (!expected.equals(actual)) {
            throw ApiException.badRequest("재업로드한 파일 또는 상태가 미리보기와 일치하지 않습니다. 다시 미리보기를 실행해 주세요.");
        }
    }

    private static String sha256Hex(byte[] bytes) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** Shared, write-free result of parsing + classifying a file. */
    private record Prepared(UUID gmarketChannelId, String fileHash, int rowCount,
                            List<EsmClassifiedRow> classified, String canonicalPreviewHash) {
    }

    /** The full plan for a file: per-row dispositions, DB-state binding, and counts. */
    private record Plan(List<PlannedRow> rows, String existingStateHash, int newUnanswered, int newAnswered,
                        int statusUpdates, int unchangedDuplicates, int operationalNotices, int unsupported,
                        int invalid) {

        /** Buyer rows are the only ones that yield a batch; excluded-only files write nothing. */
        boolean hasBuyerRows() {
            return rows.stream().anyMatch(pr -> pr.row().buyerInquiry());
        }
    }
}
