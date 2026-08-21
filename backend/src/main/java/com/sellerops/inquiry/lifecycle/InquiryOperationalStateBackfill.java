package com.sellerops.inquiry.lifecycle;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Rebuilds {@code inquiries.operational_state} for one org from the dismissal ledger.
 *
 * <p><b>Why a backfill exists at all.</b> The seller's spam decisions predate the column that records
 * their consequence: on the demo org, 3,199 Cafe24 work items have been {@code DISMISSED / SPAM} since
 * 2026-07-06 while every current-truth read went on counting the inquiries behind them. This walks the
 * ledger and makes the projection agree with it.
 *
 * <p><b>Idempotent, and symmetric.</b> It is not "apply dismissals" — it is "make the projection equal
 * what the ledger says", in both directions: a dismissed inquiry becomes {@code EXCLUDED_SPAM}, and an
 * inquiry marked {@code EXCLUDED_SPAM} whose dismissal has since been reversed becomes {@code ACTIVE}
 * again. Running it twice writes nothing the second time, which is what makes it safe to run from an
 * endpoint, from a test, and after a restore.
 *
 * <p><b>It never deletes anything</b> — not an inquiry, not a work item, not a customer-memory entry.
 * Exclusion is a state the current reads honour; the history stays whole underneath it.
 */
@Service
public class InquiryOperationalStateBackfill {

    private static final Logger log = LoggerFactory.getLogger(InquiryOperationalStateBackfill.class);

    /** Rows loaded per transaction chunk. Matches the dismissal service's bound, for the same reason. */
    static final int CHUNK = 500;

    private final InquiryRepository inquiries;
    private final InquiryWorkItemRepository workItems;
    private final InquiryOperationalStateProjector projector;

    public InquiryOperationalStateBackfill(InquiryRepository inquiries,
                                           InquiryWorkItemRepository workItems,
                                           InquiryOperationalStateProjector projector) {
        this.inquiries = inquiries;
        this.workItems = workItems;
        this.projector = projector;
    }

    /**
     * @param examined rows the ledger pointed at (dismissed + currently-excluded), deduplicated
     * @param excluded rows moved into {@code EXCLUDED_SPAM} by this run
     * @param restored rows moved back to {@code ACTIVE} because their dismissal no longer stands
     */
    public record Result(int examined, int excluded, int restored) {
        public int changed() {
            return excluded + restored;
        }
    }

    @Transactional
    public Result run(UUID orgId) {
        // Both directions in one candidate set: what the ledger says should be excluded, plus what is
        // currently excluded (so a reversal is seen even though the ledger no longer mentions it).
        Set<UUID> candidates = new LinkedHashSet<>(workItems.findInquiryIdsByOrgIdAndPhaseAndDisposition(
                orgId, InquiryWorkItemPhase.DISMISSED, InquiryWorkItemDisposition.SPAM));
        candidates.addAll(inquiries.findIdsByOrgIdAndOperationalState(orgId, InquiryOperationalState.EXCLUDED_SPAM));

        int excluded = 0;
        int restored = 0;
        List<UUID> all = new ArrayList<>(candidates);
        for (int from = 0; from < all.size(); from += CHUNK) {
            List<UUID> chunk = all.subList(from, Math.min(from + CHUNK, all.size()));
            List<Inquiry> rows = inquiries.findAllById(chunk).stream()
                    .filter(q -> orgId.equals(q.getOrgId()))
                    .toList();
            Map<UUID, InquiryWorkItem> byInquiry = workItems.findByInquiryIdIn(chunk).stream()
                    .filter(w -> orgId.equals(w.getOrgId()))
                    .collect(Collectors.toMap(InquiryWorkItem::getInquiryId, Function.identity(), (a, b) -> a));
            for (Inquiry row : rows) {
                if (!projector.apply(row, byInquiry.get(row.getId()))) {
                    continue;
                }
                inquiries.save(row);
                if (row.getOperationalState() == InquiryOperationalState.EXCLUDED_SPAM) {
                    excluded++;
                } else {
                    restored++;
                }
            }
        }
        // Counts only — never an inquiry id, a title, or a body.
        log.info("문의 운영 상태 backfill: 대상={} 제외={} 복원={}", candidates.size(), excluded, restored);
        return new Result(candidates.size(), excluded, restored);
    }
}
