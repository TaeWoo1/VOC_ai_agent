package com.sellerops.connector.cafe24;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.DataOrigin;
import com.sellerops.ingest.canonical.SourceThreadRole;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.lifecycle.InquiryOperationalStateProjector;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Write down what a live READ already proved, and nothing else.
 *
 * <p><b>It makes no marketplace call.</b> The structure was observed once, under an approved bounded
 * READ, and frozen into an observation manifest of exact article numbers and their parents. This
 * replays that record onto the rows it names. Re-reading the source to repair rows we have already
 * read would spend the seller's rate limit to learn what we were told.
 *
 * <p><b>Why it is not a dismissal batch.</b> {@code InquiryWorkItemDismissalService} exists and does
 * almost this — but its manifest is an <em>approval envelope</em> ({@code approved=true}, an approver,
 * an approval time, all folded into the idempotency hash), its {@code ELIGIBLE} gate requires every
 * item to be {@code OPEN}, and its audit hard-codes {@code phase_from = OPEN}. This set contains items
 * in {@code PROPOSED}, and no human approved a judgement about any of them: what happened is that the
 * source was re-read. Passing this through that service would mean writing an approval nobody gave
 * and a phase transition that did not happen, for a set it would refuse anyway.
 *
 * <p><b>So it borrows the vocabulary instead of the route.</b> The terminal phase is the existing
 * {@link InquiryWorkItemPhase#DISMISSED} (not {@link InquiryWorkItemPhase#COMPLETED} — nothing was
 * answered), the audit event is the existing {@link InquiryWorkItemEvent#WORK_ITEM_DISMISSED}, and the
 * only new word is the disposition {@link
 * InquiryWorkItemDisposition#SOURCE_THREAD_REPLY}, which is what keeps a data
 * correction distinguishable from a seller's spam judgement forever after. {@code dismissal_batch_id}
 * stays null, because there is no approved batch and inventing one would be the lie.
 *
 * <p><b>All or nothing, and drift aborts it.</b> Every row must still be exactly what the observation
 * saw — same org, same account, REAL, unanswered, operationally active, and in a work-item phase this
 * repair is allowed to leave. One mismatch and nothing at all is written.
 *
 * <p><b>Nothing is deleted.</b> Not an inquiry, not a work item, not a proposal, not an audit row. The
 * body, the status, the timestamps and the customer-memory entry all stay; the row leaves the current
 * reads because every one of them is gated on {@code operational_state = ACTIVE}.
 */
public class Cafe24ThreadRepair {

    private static final Logger log = LoggerFactory.getLogger(Cafe24ThreadRepair.class);
    private static final String TAG = "[cafe24-thread-repair]";

    /** The audit actor. A system tag, never an operator or a seller identity. */
    static final String ACTOR = "SYSTEM:THREAD_RECLASSIFICATION";

    private static final String CAFE24_CHANNEL_CODE = "CAFE24";

    /** Phases this repair may leave. Anything further along is drift, and drift aborts. */
    private static final Set<InquiryWorkItemPhase> REPAIRABLE_PHASES =
            Set.of(InquiryWorkItemPhase.OPEN, InquiryWorkItemPhase.PROPOSED);

    private final InquiryRepository inquiries;
    private final InquiryWorkItemRepository workItems;
    private final InquiryWorkItemAuditRepository audits;
    private final ChannelRepository channels;
    private final InquiryOperationalStateProjector projector;
    private final TransactionTemplate tx;

    public Cafe24ThreadRepair(InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                              InquiryWorkItemAuditRepository audits, ChannelRepository channels,
                              InquiryOperationalStateProjector projector,
                              PlatformTransactionManager txManager) {
        this.inquiries = inquiries;
        this.workItems = workItems;
        this.audits = audits;
        this.channels = channels;
        this.projector = projector;
        this.tx = new TransactionTemplate(txManager);
    }

    /** One observed relation: this article is a reply, and that article is its parent. */
    public record Observation(long articleNo, long parentArticleNo) {
    }

    /**
     * Sanitized outcome — counts only. No article number, title, body, writer or identifier appears
     * here or in any log this class produces.
     *
     * @param manifestRows   relations the manifest declared
     * @param resolved       rows found in this org / account under those article numbers
     * @param drifted        rows that are no longer what the observation saw (any one aborts the run)
     * @param aborted        true when drift or a hash mismatch stopped the run before any write
     * @param rolesWritten   inquiries whose thread role was recorded by this run
     * @param statesExcluded inquiries the projector moved out of current truth
     * @param itemsDismissed work items moved to the terminal DISMISSED phase
     * @param auditsWritten  audit rows appended
     * @param alreadyRepaired rows a previous run had already repaired (idempotent, written again 0)
     */
    public record Result(int manifestRows, int resolved, int drifted, boolean aborted,
                         int rolesWritten, int statesExcluded, int itemsDismissed,
                         int auditsWritten, int alreadyRepaired, boolean dryRun) {
    }

    /**
     * Read the observation manifest: one {@code articleNo<TAB>parentArticleNo} per line, blanks and
     * {@code #} comments ignored. Fails closed on a malformed line, a non-positive number, a
     * self-parent, or a duplicate — a manifest that is not exactly readable is not a manifest.
     */
    public static List<Observation> readManifest(Path path) throws IOException {
        List<Observation> rows = new ArrayList<>();
        Set<Long> seen = new LinkedHashSet<>();
        for (String raw : Files.readAllLines(path, StandardCharsets.UTF_8)) {
            String line = raw.strip();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            String[] parts = line.split("\\s+");
            if (parts.length != 2) {
                throw new IllegalStateException("관측 매니페스트 형식이 올바르지 않습니다.");
            }
            long article;
            long parent;
            try {
                article = Long.parseLong(parts[0]);
                parent = Long.parseLong(parts[1]);
            } catch (NumberFormatException e) {
                throw new IllegalStateException("관측 매니페스트에 숫자가 아닌 값이 있습니다.");
            }
            if (article <= 0 || parent <= 0 || article == parent) {
                throw new IllegalStateException("관측 매니페스트의 글 번호가 올바르지 않습니다.");
            }
            if (!seen.add(article)) {
                throw new IllegalStateException("관측 매니페스트에 중복된 항목이 있습니다.");
            }
            rows.add(new Observation(article, parent));
        }
        if (rows.isEmpty()) {
            throw new IllegalStateException("관측 매니페스트가 비어 있습니다.");
        }
        return rows;
    }

    /** SHA-256 of the manifest file's exact bytes, lowercase hex. */
    public static String hash(Path path) throws IOException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path));
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

    /**
     * Apply the observation to exactly the rows it names.
     *
     * @param commandId the audit idempotency key — same manifest, same key, so a replay appends no
     *                  duplicate audit row (the audit table is unique on work item + command)
     * @param dryRun    when true nothing is persisted; the counts say what WOULD change
     */
    public Result repair(UUID orgId, UUID sellerAccountId, int boardNo, List<Observation> manifest,
                         String commandId, boolean dryRun) {
        UUID channelId = channels.findByCode(CAFE24_CHANNEL_CODE).map(Channel::getId).orElse(null);
        if (channelId == null) {
            log.warn("{} CAFE24 채널을 찾지 못함 — 아무것도 변경하지 않음.", TAG);
            return new Result(manifest.size(), 0, 0, true, 0, 0, 0, 0, 0, dryRun);
        }

        return tx.execute(status -> {
            Map<Observation, Inquiry> rows = new LinkedHashMap<>();
            int drifted = 0;
            int alreadyRepaired = 0;
            for (Observation observation : manifest) {
                Inquiry row = inquiries.findByOrgIdAndChannelIdAndExternalId(orgId, channelId,
                        Cafe24InquiryArticleMapper.externalId(boardNo, observation.articleNo()))
                        .orElse(null);
                if (row != null && isAlreadyRepaired(row)) {
                    // Asked before the drift check on purpose: a row this repair already fixed no
                    // longer looks like what the READ saw, and must not be read as someone else
                    // having changed it.
                    alreadyRepaired++;
                    continue;
                }
                if (row == null || !isAsObserved(row, sellerAccountId)) {
                    drifted++;
                    continue;
                }
                rows.put(observation, row);
            }
            int resolved = rows.size() + alreadyRepaired;
            if (drifted > 0) {
                // One mismatch aborts everything. A partial repair would leave the seller's numbers
                // in a state no record describes.
                status.setRollbackOnly();
                log.warn("{} 중단: 관측과 다른 행 {}건 — 아무것도 변경하지 않음.", TAG, drifted);
                return new Result(manifest.size(), resolved, drifted, true, 0, 0, 0, 0,
                        alreadyRepaired, dryRun);
            }

            int rolesWritten = 0;
            int statesExcluded = 0;
            int itemsDismissed = 0;
            int auditsWritten = 0;
            for (Map.Entry<Observation, Inquiry> entry : rows.entrySet()) {
                Inquiry row = entry.getValue();
                InquiryWorkItem item = workItems.findByInquiryId(row.getId()).orElse(null);
                if (dryRun) {
                    rolesWritten++;
                    statesExcluded++;
                    if (item != null && REPAIRABLE_PHASES.contains(item.getPhase())) {
                        itemsDismissed++;
                        auditsWritten++;
                    }
                    continue;
                }
                row.setThreadRole(SourceThreadRole.REPLY.name());
                row.setThreadParentExternalId(
                        Cafe24InquiryArticleMapper.externalId(boardNo, entry.getKey().parentArticleNo()));
                rolesWritten++;
                if (item != null && REPAIRABLE_PHASES.contains(item.getPhase())) {
                    InquiryWorkItemPhase from = item.getPhase();
                    item.setPhase(InquiryWorkItemPhase.DISMISSED);
                    item.setDisposition(InquiryWorkItemDisposition.SOURCE_THREAD_REPLY);
                    workItems.save(item);
                    itemsDismissed++;
                    audits.save(auditRow(item, from, commandId));
                    auditsWritten++;
                }
                // The projector reads the work item back, so it stays the single writer of the
                // operational state — exactly as the dismissal path does it.
                if (projector.apply(row, item)) {
                    statesExcluded++;
                }
                inquiries.save(row);
            }
            if (dryRun) {
                status.setRollbackOnly();
            }
            return new Result(manifest.size(), resolved, 0, false, rolesWritten, statesExcluded,
                    itemsDismissed, auditsWritten, alreadyRepaired, dryRun);
        });
    }

    /**
     * Is this row still exactly what the READ observed? Same tenant and connection, real data, still
     * unanswered, still in current truth, and its work item not yet moved past where this repair may
     * act. A row that has since been answered, dismissed by the seller, or acted on is NOT repaired
     * silently — it is drift, and drift stops the run.
     */
    private boolean isAsObserved(Inquiry row, UUID sellerAccountId) {
        if (!sellerAccountId.equals(row.getSellerAccountId()) || row.getDataOrigin() != DataOrigin.REAL) {
            return false;
        }
        if (!"UNANSWERED".equals(row.getStatus())
                || row.getOperationalState() != InquiryOperationalState.ACTIVE
                || row.threadRole() != null) {
            return false;
        }
        InquiryWorkItem item = workItems.findByInquiryId(row.getId()).orElse(null);
        return item == null || REPAIRABLE_PHASES.contains(item.getPhase());
    }

    /** A row a previous run already repaired: same role, same exclusion. Counted, never rewritten. */
    private static boolean isAlreadyRepaired(Inquiry row) {
        return row.threadRole() == SourceThreadRole.REPLY
                && row.getOperationalState() == InquiryOperationalState.EXCLUDED_THREAD_REPLY;
    }

    private static InquiryWorkItemAudit auditRow(InquiryWorkItem item, InquiryWorkItemPhase from,
                                                 String commandId) {
        InquiryWorkItemAudit audit = new InquiryWorkItemAudit();
        audit.setOrgId(item.getOrgId());
        audit.setWorkItemId(item.getId());
        audit.setCommandId(commandId);
        audit.setEventType(InquiryWorkItemEvent.WORK_ITEM_DISMISSED);
        // The phase the item was ACTUALLY in — this set is not all OPEN, and an audit that rounded
        // that off would be a record of something that did not happen.
        audit.setPhaseFrom(from);
        audit.setPhaseTo(InquiryWorkItemPhase.DISMISSED);
        audit.setActor(ACTOR);
        audit.setDisposition(InquiryWorkItemDisposition.SOURCE_THREAD_REPLY);
        // No batch: no approval envelope exists for a data correction, and pointing at one would
        // claim an operator signed this off.
        audit.setDismissalBatchId(null);
        return audit;
    }
}
