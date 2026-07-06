package com.sellerops.inquiry.workitem.dismissal;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Reusable, org-scoped service that dismisses <b>exact</b> inquiry work-item ids
 * (e.g. spam) via an audited {@link InquiryWorkItemPhase#OPEN OPEN} &rarr; {@link
 * InquiryWorkItemPhase#DISMISSED DISMISSED} terminal transition. It never answers or
 * completes an inquiry, never hard-deletes, and never selects rows by date, text, or
 * inferred criteria — only the ids handed to it are considered.
 *
 * <p><b>Only two entry points:</b> {@link #preview} (read-only classification, zero
 * writes) and {@link #executeAllOrNothing} (all-or-nothing execution). There is no
 * partial-execution path — a caller can never mutate only the eligible subset of a
 * mixed chunk.
 *
 * <p><b>Safety invariants:</b>
 * <ul>
 *   <li>every id is resolved and scoped to the caller's {@code orgId}; a foreign-org,
 *       foreign-account, or foreign-channel id makes the whole chunk abort untouched;</li>
 *   <li>{@link #executeAllOrNothing} requires the confirmation token {@value
 *       #CONFIRM_TOKEN}, is bounded to {@value #MAX_CHUNK} ids, and commits the batch
 *       ledger row, the item transitions, and the item audits in one transaction;</li>
 *   <li><b>idempotency is anchored on the durable batch ledger:</b> {@code (org_id,
 *       command_id)} is unique and each batch stores the {@link #manifestHash} of its
 *       exact approved payload. Same command + same payload ⇒ idempotent replay (no
 *       new rows); same command + different payload ⇒ 409, zero mutations; a command
 *       id reused in another org is isolated.</li>
 * </ul>
 */
@Service
public class InquiryWorkItemDismissalService {

    /** Hard maximum ids processed in a single execution (bounded chunk). */
    public static final int MAX_CHUNK = 500;

    /** The exact confirmation value execution requires; anything else fails closed. */
    public static final String CONFIRM_TOKEN = "CONFIRM_DISMISS";

    /** Tolerance for an approved_at slightly ahead of server time (clock skew). */
    private static final Duration FUTURE_TOLERANCE = Duration.ofMinutes(5);

    /** Channel every dismissible item in this slice must belong to. */
    private static final String CAFE24_CHANNEL_CODE = "CAFE24";

    private final InquiryWorkItemRepository workItems;
    private final InquiryWorkItemAuditRepository audits;
    private final InquiryWorkItemDismissalBatchRepository batches;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final TransactionTemplate tx;

    public InquiryWorkItemDismissalService(InquiryWorkItemRepository workItems,
                                           InquiryWorkItemAuditRepository audits,
                                           InquiryWorkItemDismissalBatchRepository batches,
                                           SellerAccountRepository accounts,
                                           ChannelRepository channels,
                                           PlatformTransactionManager txManager) {
        this.workItems = workItems;
        this.audits = audits;
        this.batches = batches;
        this.accounts = accounts;
        this.channels = channels;
        this.tx = new TransactionTemplate(txManager);
    }

    /** The disposition of each requested id relative to the caller's tenant/account. */
    private enum Category { ELIGIBLE, ALREADY_DISMISSED, MISSING, WRONG_ORG, WRONG_PHASE, REJECTED }

    /**
     * A dismissal request over exact ids for one seller account. {@code executedBy} is
     * the authenticated executor tag (never taken from request/manifest); it is the
     * audit actor and the batch's {@code executed_by}.
     */
    public record DismissalCommand(UUID orgId, UUID sellerAccountId,
                                   InquiryWorkItemDisposition disposition, String commandId,
                                   String executedBy, List<UUID> workItemIds) {
    }

    /**
     * Classification counts for a set of requested ids. In {@link #preview} {@code
     * dismissed} is {@code 0} and {@code eligible} is what <i>would</i> be dismissed;
     * on a fresh execute {@code dismissed} equals the eligible count; on an idempotent
     * replay {@code dismissed} is {@code 0} and {@code alreadyDismissed} is the batch's
     * item count. Buckets are mutually exclusive per id.
     */
    public record DismissalCounts(boolean executed, int requested, int eligible, int dismissed,
                                  int alreadyDismissed, int missing, int wrongOrg, int wrongPhase,
                                  int rejected) {
    }

    /** Result of an execution: the counts, the persisted batch id, and replay flag. */
    public record ExecuteResult(DismissalCounts counts, UUID batchId, boolean idempotentReplay) {
    }

    /**
     * Classify the ids without changing any data. Validates the command shape (fails
     * closed on a bad chunk) but performs no writes and needs no confirmation.
     */
    public DismissalCounts preview(DismissalCommand command) {
        validateShape(command);
        return tx.execute(status -> {
            status.setRollbackOnly(); // belt-and-suspenders: a preview never commits.
            Map<UUID, Category> byId = classify(command);
            return counts(false, command.workItemIds().size(), byId, 0);
        });
    }

    /**
     * All-or-nothing chunk dismissal for an operator-approved manifest. Requires {@code
     * confirmation} to equal {@value #CONFIRM_TOKEN}. {@code approvedBy}/{@code
     * approvedAt} are approval metadata persisted on the batch ledger (never identity/
     * authorization); {@code approvedAt} must be a real, offset-bearing timestamp that
     * is not unreasonably in the future.
     *
     * <p>Order of enforcement, all inside one transaction:
     * <ol>
     *   <li><b>Ledger idempotency</b> — if a batch already exists for {@code (org,
     *       commandId)}: same {@link #manifestHash} ⇒ return the prior result adding no
     *       rows; different hash ⇒ 409 with zero mutations.</li>
     *   <li><b>All-eligible gate</b> — every requested id must be {@code ELIGIBLE}, or
     *       the whole chunk aborts (409) with zero mutations.</li>
     *   <li><b>Atomic apply</b> — persist the batch row, transition every item, and
     *       append every batch-linked audit together.</li>
     * </ol>
     */
    public ExecuteResult executeAllOrNothing(DismissalCommand command, String confirmation,
                                             String approvedBy, String approvedAt) {
        validateShape(command);
        if (!CONFIRM_TOKEN.equals(confirmation)) {
            throw ApiException.badRequest("실행 확인 값이 올바르지 않습니다.");
        }
        if (approvedBy == null || approvedBy.isBlank()) {
            throw ApiException.badRequest("approved_by가 필요합니다.");
        }
        Instant approvedInstant = parseApprovedAt(approvedAt);
        String manifestHash = manifestHash(command, approvedBy, approvedAt);

        return tx.execute(status -> {
            var existing = batches.findByOrgIdAndCommandId(command.orgId(), command.commandId());
            if (existing.isPresent()) {
                InquiryWorkItemDismissalBatch batch = existing.get();
                if (!batch.getManifestHash().equals(manifestHash)) {
                    // Same command id, different approved payload — never re-apply.
                    throw ApiException.conflict(
                            "commandId가 이미 다른 매니페스트 페이로드로 사용되었습니다.");
                }
                // Exact replay: return the prior result, add nothing.
                return new ExecuteResult(replayCounts(batch), batch.getId(), true);
            }

            Map<UUID, Category> byId = classify(command);
            int requested = command.workItemIds().size();
            long eligible = byId.values().stream().filter(c -> c == Category.ELIGIBLE).count();
            if (eligible != requested) {
                throw ApiException.conflict("일괄 반려 중단: 모든 항목이 처리 대상(ELIGIBLE)이 아닙니다. "
                        + summary(byId, requested));
            }

            InquiryWorkItemDismissalBatch batch = new InquiryWorkItemDismissalBatch();
            batch.setOrgId(command.orgId());
            batch.setSellerAccountId(command.sellerAccountId());
            batch.setCommandId(command.commandId());
            batch.setDisposition(command.disposition());
            batch.setManifestHash(manifestHash);
            batch.setItemCount(requested);
            batch.setApprovedBy(approvedBy);
            batch.setApprovedAt(approvedInstant);
            batch.setExecutedBy(command.executedBy());
            batch.setExecutedAt(Instant.now());
            batch.setStatus(DismissalBatchStatus.EXECUTED);
            InquiryWorkItemDismissalBatch savedBatch = batches.save(batch);

            for (UUID id : command.workItemIds()) {
                dismissOne(workItems.findById(id).orElseThrow(), command, savedBatch.getId());
            }
            return new ExecuteResult(counts(true, requested, byId, requested), savedBatch.getId(), false);
        });
    }

    /** Transition a single OPEN item to DISMISSED and append its batch-linked audit. */
    private void dismissOne(InquiryWorkItem item, DismissalCommand command, UUID batchId) {
        item.setPhase(InquiryWorkItemPhase.DISMISSED);
        item.setDisposition(command.disposition());
        workItems.save(item);

        InquiryWorkItemAudit audit = new InquiryWorkItemAudit();
        audit.setOrgId(item.getOrgId());
        audit.setWorkItemId(item.getId());
        audit.setCommandId(command.commandId());
        audit.setEventType(InquiryWorkItemEvent.WORK_ITEM_DISMISSED);
        audit.setPhaseFrom(InquiryWorkItemPhase.OPEN);
        audit.setPhaseTo(InquiryWorkItemPhase.DISMISSED);
        audit.setActor(command.executedBy());
        audit.setDisposition(command.disposition());
        audit.setDismissalBatchId(batchId);
        audits.save(audit);
    }

    /** Counts describing a prior successful batch (idempotent replay: nothing new done). */
    private static DismissalCounts replayCounts(InquiryWorkItemDismissalBatch batch) {
        int n = batch.getItemCount();
        return new DismissalCounts(true, n, 0, 0, n, 0, 0, 0, 0);
    }

    /**
     * Deterministic SHA-256 of the canonical approved payload: authenticated org,
     * seller account, disposition, the <b>sorted</b> exact work-item ids, and the
     * approval metadata. Excludes JSON field order and the confirmation string, so the
     * hash depends only on <i>what</i> was approved, not how it was serialized.
     */
    static String manifestHash(DismissalCommand command, String approvedBy, String approvedAt) {
        List<String> sortedIds = new ArrayList<>(command.workItemIds().stream().map(UUID::toString).toList());
        sortedIds.sort(String::compareTo);
        String canonical = String.join("\n",
                "org=" + command.orgId(),
                "account=" + command.sellerAccountId(),
                "disposition=" + command.disposition().name(),
                "approvedBy=" + approvedBy,
                "approvedAt=" + approvedAt,
                "items=" + String.join(",", sortedIds));
        return sha256Hex(canonical);
    }

    /** Parse approved_at as an offset-bearing ISO timestamp; reject malformed/too-future. */
    private static Instant parseApprovedAt(String approvedAt) {
        if (approvedAt == null || approvedAt.isBlank()) {
            throw ApiException.badRequest("approved_at이 필요합니다.");
        }
        Instant approved;
        try {
            approved = OffsetDateTime.parse(approvedAt).toInstant();
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("approved_at 형식이 올바르지 않습니다 (오프셋 포함 ISO-8601 필요).");
        }
        if (approved.isAfter(Instant.now().plus(FUTURE_TOLERANCE))) {
            throw ApiException.badRequest("approved_at이 미래 시각입니다.");
        }
        return approved;
    }

    private static String summary(Map<UUID, Category> byId, int requested) {
        DismissalCounts c = counts(false, requested, byId, 0);
        return "eligible=" + c.eligible() + " alreadyDismissed=" + c.alreadyDismissed()
                + " missing=" + c.missing() + " wrongOrg=" + c.wrongOrg()
                + " wrongPhase=" + c.wrongPhase() + " rejected=" + c.rejected();
    }

    /** Fail-closed structural validation shared by preview and execute. */
    private void validateShape(DismissalCommand command) {
        if (command.orgId() == null || command.sellerAccountId() == null) {
            throw ApiException.badRequest("org 및 sellerAccountId가 필요합니다.");
        }
        if (command.disposition() == null) {
            throw ApiException.badRequest("disposition이 필요합니다.");
        }
        if (command.commandId() == null || command.commandId().isBlank()) {
            throw ApiException.badRequest("commandId가 필요합니다.");
        }
        if (command.executedBy() == null || command.executedBy().isBlank()) {
            throw ApiException.badRequest("executedBy가 필요합니다.");
        }
        List<UUID> ids = command.workItemIds();
        if (ids == null || ids.isEmpty()) {
            throw ApiException.badRequest("workItemIds가 비어 있습니다.");
        }
        if (ids.size() > MAX_CHUNK) {
            throw ApiException.badRequest(
                    "한 번에 처리 가능한 최대 개수(" + MAX_CHUNK + ")를 초과했습니다.");
        }
        Set<UUID> seen = new HashSet<>();
        for (UUID id : ids) {
            if (id == null) {
                throw ApiException.badRequest("workItemIds에 빈 값이 있습니다.");
            }
            if (!seen.add(id)) {
                throw ApiException.badRequest("workItemIds에 중복된 항목이 있습니다.");
            }
        }
    }

    /**
     * Classify each requested id. The seller account must belong to the caller's org
     * (else those ids are rejected — an account the caller cannot see must never
     * dismiss). Runs inside the caller's transaction; reads only.
     */
    private Map<UUID, Category> classify(DismissalCommand command) {
        SellerAccount account = accounts
                .findByIdAndOrgId(command.sellerAccountId(), command.orgId())
                .orElse(null);
        UUID cafe24ChannelId = channels.findByCode(CAFE24_CHANNEL_CODE)
                .map(Channel::getId).orElse(null);

        Map<UUID, Category> result = new LinkedHashMap<>();
        for (UUID id : command.workItemIds()) {
            result.put(id, categorize(id, command, account, cafe24ChannelId));
        }
        return result;
    }

    private Category categorize(UUID id, DismissalCommand command, SellerAccount account,
                                UUID cafe24ChannelId) {
        InquiryWorkItem item = workItems.findById(id).orElse(null);
        if (item == null) {
            return Category.MISSING;
        }
        if (!command.orgId().equals(item.getOrgId())) {
            return Category.WRONG_ORG;
        }
        // Account/channel guards: the named account must exist in this org and be the
        // item's account, and the item must be on the CAFE24 channel. Any mismatch is
        // reported, never dismissed.
        if (account == null || !account.getId().equals(item.getSellerAccountId())) {
            return Category.REJECTED;
        }
        if (cafe24ChannelId == null || !cafe24ChannelId.equals(item.getChannelId())) {
            return Category.REJECTED;
        }
        if (item.getPhase() == InquiryWorkItemPhase.DISMISSED) {
            return Category.ALREADY_DISMISSED;
        }
        if (item.getPhase() != InquiryWorkItemPhase.OPEN) {
            return Category.WRONG_PHASE;
        }
        return Category.ELIGIBLE;
    }

    private static DismissalCounts counts(boolean executed, int requested,
                                          Map<UUID, Category> byId, int dismissed) {
        int eligible = 0, alreadyDismissed = 0, missing = 0, wrongOrg = 0, wrongPhase = 0, rejected = 0;
        for (Category c : byId.values()) {
            switch (c) {
                case ELIGIBLE -> eligible++;
                case ALREADY_DISMISSED -> alreadyDismissed++;
                case MISSING -> missing++;
                case WRONG_ORG -> wrongOrg++;
                case WRONG_PHASE -> wrongPhase++;
                case REJECTED -> rejected++;
            }
        }
        return new DismissalCounts(executed, requested, eligible, dismissed,
                alreadyDismissed, missing, wrongOrg, wrongPhase, rejected);
    }

    private static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", e);
        }
    }
}
