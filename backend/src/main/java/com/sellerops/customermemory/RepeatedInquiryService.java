package com.sellerops.customermemory;

import com.sellerops.customermemory.dto.RepeatedInquiryView;
import com.sellerops.reviewissue.IssueWindows;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Repeated-inquiry detection — the third capability the audit found missing entirely
 * ({@code docs/demo_baseline_recovery_audit_2026-08-21.md} §2.3(c), gap I: "반복 문의"는 미착수,
 * {@code reviewissue} references inquiries zero times).
 *
 * <p><b>It is an aggregate, not a pipeline.</b> There is no second extraction, no second table, and no
 * background job: it groups the SAME customer-memory index that recall reads, over a window built by
 * the SAME {@link IssueWindows} the review issue memory uses. The alternative — extending
 * {@code reviewissue} to inquiries — would have meant a second lifecycle, a second evidence table and a
 * second set of thresholds for a question that is one {@code GROUP BY} away from data we already keep.
 *
 * <p><b>Two axes, reported separately.</b> A repeat on the {@code aspect:problem} signature is a sharp
 * signal (the same problem, twice). A repeat on the analysis topic is a soft one (both about 배송).
 * Blending them would let ten unrelated 배송 questions outrank three identical 접착:탈락 ones, so they
 * are returned as separate rows carrying their axis, and the reader decides.
 *
 * <p><b>Thresholds are local and deliberately conservative.</b> They are NOT borrowed from
 * {@code ReviewIssueThresholds}: those are tuned against review volume and a surge model this axis does
 * not have. Two occurrences is the floor because one is not a repeat by definition.
 */
@Service
public class RepeatedInquiryService {

    /** The default window. 28 days matches {@code CONCENTRATION_WINDOW_DAYS} — a month of operations. */
    public static final int DEFAULT_WINDOW_DAYS = 28;

    /** Below this, it is not a repeat. One occurrence is a question; two is a pattern worth naming. */
    public static final long MIN_OCCURRENCES = 2;

    /** Ceiling on returned rows, so a noisy org cannot turn a signal into a wall. */
    public static final int MAX_ROWS = 20;

    private final CustomerMemoryEntryRepository entries;

    public RepeatedInquiryService(CustomerMemoryEntryRepository entries) {
        this.entries = entries;
    }

    /**
     * Repeated inquiries in the window ending at {@code referenceDate}, sharpest first.
     *
     * <p>{@code referenceDate} is the same reproducibility anchor {@code /api/review-issues} takes: pin
     * it and the answer is stable across a restart; omit it and the backend uses today (UTC).
     */
    @Transactional(readOnly = true)
    public List<RepeatedInquiryView> repeats(UUID orgId, LocalDate referenceDate, int windowDays) {
        int days = windowDays <= 0 ? DEFAULT_WINDOW_DAYS : windowDays;
        LocalDate at = referenceDate == null ? LocalDate.now(ZoneOffset.UTC) : referenceDate;
        IssueWindows.DateRange window = IssueWindows.trailing(at, days);

        List<RepeatedInquiryView> rows = new ArrayList<>();
        for (Object[] row : entries.repeatedInquirySignatures(orgId, window.fromInclusive(), window.toInclusive())) {
            long count = ((Number) row[1]).longValue();
            if (count < MIN_OCCURRENCES) {
                continue;
            }
            String key = (String) row[0];
            rows.add(new RepeatedInquiryView(RepeatedInquiryView.AXIS_SIGNATURE, key, signatureLabel(key),
                    count, answeredCount(orgId, key, null, window), (LocalDate) row[2], (LocalDate) row[3],
                    days));
        }
        for (Object[] row : entries.repeatedInquiryTopics(orgId, window.fromInclusive(), window.toInclusive(),
                com.sellerops.itemanalysis.ItemAnalysisCategories.FALLBACK)) {
            long count = ((Number) row[1]).longValue();
            if (count < MIN_OCCURRENCES) {
                continue;
            }
            String key = (String) row[0];
            rows.add(new RepeatedInquiryView(RepeatedInquiryView.AXIS_TOPIC, key, key, count,
                    answeredCount(orgId, null, key, window), (LocalDate) row[2], (LocalDate) row[3], days));
        }

        return rows.stream()
                // Signature repeats first (the sharp axis), then by size, then by key for a total order.
                .sorted(Comparator
                        .comparingInt((RepeatedInquiryView v) ->
                                RepeatedInquiryView.AXIS_SIGNATURE.equals(v.axis()) ? 0 : 1)
                        .thenComparing(Comparator.comparingLong(RepeatedInquiryView::occurrences).reversed())
                        .thenComparing(RepeatedInquiryView::key))
                .limit(MAX_ROWS)
                .toList();
    }

    /**
     * How many of a repeat's occurrences are already answered.
     *
     * <p>Counted in Java over the window's rows rather than as a fifth grouped query: the row count per
     * key is small by construction (a repeat is a handful of inquiries), and a second GROUP BY would
     * have to repeat the window arithmetic that {@link IssueWindows} owns.
     */
    private long answeredCount(UUID orgId, String signatureKey, String topic, IssueWindows.DateRange window) {
        return entries.findCandidates(orgId, signatureKey, topic,
                        org.springframework.data.domain.PageRequest.of(0, 200)).stream()
                .filter(e -> e.getEntryKind() == CustomerMemoryKind.INQUIRY)
                .filter(e -> !e.getOccurredOn().isBefore(window.fromInclusive()))
                .filter(e -> !e.getOccurredOn().isAfter(window.toInclusive()))
                .filter(CustomerMemoryEntry::isAnswered)
                .count();
    }

    /** {@code 배송:지연} → {@code 배송 지연}, matching {@code IssueSignature.titleKo()}'s shape. */
    private static String signatureLabel(String signatureKey) {
        return signatureKey == null ? "" : signatureKey.replace(':', ' ');
    }
}
