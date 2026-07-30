package com.sellerops.reviewissue;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.dto.IssueContextView;
import com.sellerops.reviewissue.dto.IssueEvidenceSummaryView;
import com.sellerops.reviewissue.dto.ReviewIssueDetailView;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Repeated-issue surface. Every endpoint requires a JWT and is org-scoped via
 * {@code principal.orgId()}.
 *
 * <p><b>{@code referenceDate} is a parameter everywhere</b>, defaulting to today. That is what makes
 * a weekly report reproducible ("what did this look like on the 18th") and what lets the judgements
 * be tested at their exact boundaries. Nothing below reads a clock except to compute that default.
 *
 * <p><b>What is deliberately absent.</b> There is no "mark resolved" endpoint: RESOLVED is reachable
 * only from 개선 확인 중 after enough quiet weeks, so that the conclusion rests on observed evidence
 * rather than on someone asserting it (see {@code contracts/review-issue/v1/THRESHOLDS.md} §4).
 */
@RestController
@RequestMapping("/api/review-issues")
public class ReviewIssueController {

    private final ReviewIssueQueryService query;
    private final ReviewIssueLifecycleService lifecycle;
    private final ReviewIssueExtractionService extraction;
    private final ReviewRepository reviews;

    public ReviewIssueController(ReviewIssueQueryService query,
                                 ReviewIssueLifecycleService lifecycle,
                                 ReviewIssueExtractionService extraction,
                                 ReviewRepository reviews) {
        this.query = query;
        this.lifecycle = lifecycle;
        this.extraction = extraction;
        this.reviews = reviews;
    }

    /**
     * The working list. {@code dismissed=true} returns the 중요하지 않음 list instead — a separate
     * request rather than a merged one, so issues the operator explicitly set aside never reappear
     * among the ones asking for attention. Without it, dismissal would be a one-way door.
     */
    @GetMapping
    public List<ReviewIssueView> list(@AuthenticationPrincipal AuthPrincipal principal,
                                      @RequestParam(required = false) LocalDate referenceDate,
                                      @RequestParam(defaultValue = "false") boolean dismissed) {
        return query.list(principal.orgId(), orToday(referenceDate), dismissed);
    }

    @GetMapping("/{issueId}")
    public ReviewIssueDetailView detail(@AuthenticationPrincipal AuthPrincipal principal,
                                       @PathVariable UUID issueId,
                                       @RequestParam(required = false) LocalDate referenceDate) {
        return query.detail(principal.orgId(), issueId, orToday(referenceDate));
    }

    /**
     * Read-only, quote-free issue drill-downs for the operations-brief agent. Three narrow reads so
     * an agent never has to pull the human detail surface (whose evidence carries masked customer
     * quotes and whose history carries the operator's free-text note): {@code /context} is identity +
     * lifecycle history (note-free), {@code /evidence-summary} is the sanitized evidence roll-up, and
     * {@code /trend} is the current severity/change/concentration signal. All org-scoped, all
     * side-effect-free — they read the same {@link ReviewIssueQueryService} the human surface uses.
     */
    @GetMapping("/{issueId}/context")
    public IssueContextView context(@AuthenticationPrincipal AuthPrincipal principal,
                                    @PathVariable UUID issueId,
                                    @RequestParam(required = false) LocalDate referenceDate) {
        return query.context(principal.orgId(), issueId, orToday(referenceDate));
    }

    @GetMapping("/{issueId}/evidence-summary")
    public IssueEvidenceSummaryView evidenceSummary(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @PathVariable UUID issueId) {
        return query.evidenceSummary(principal.orgId(), issueId);
    }

    @GetMapping("/{issueId}/trend")
    public ReviewIssueView trend(@AuthenticationPrincipal AuthPrincipal principal,
                                 @PathVariable UUID issueId,
                                 @RequestParam(required = false) LocalDate referenceDate) {
        return query.issueView(principal.orgId(), issueId, orToday(referenceDate));
    }

    /**
     * Bounded, idempotent extraction over this org's reviews. Manual, following the precedent of
     * {@code /api/item-analysis/reanalyze}: nothing runs on deploy, because an automatic pass would
     * re-shape the issue list mid-session.
     *
     * <p>Page through the corpus by incrementing {@code page} until {@code reviewsScanned < limit}.
     * There is no "remaining" counter and no un-extracted flag, because extraction is idempotent by
     * key — a re-run is cheap rather than incorrect, so paging needs no server-side bookmark.
     */
    @PostMapping("/extract")
    public ExtractionBatchResult extract(@AuthenticationPrincipal AuthPrincipal principal,
                                         @RequestParam(defaultValue = "500") int limit,
                                         @RequestParam(defaultValue = "0") int page) {
        List<Review> batch = reviews.findForIssueExtraction(
                principal.orgId(), PageRequest.of(page, limit));
        int evidenceAdded = 0;
        int unknownAdded = 0;
        int issuesCreated = 0;
        int reopened = 0;
        for (Review review : batch) {
            ReviewIssueExtractionService.ExtractionResult result = extraction.extract(review);
            evidenceAdded += result.evidenceAdded();
            unknownAdded += result.unknownAdded();
            issuesCreated += result.issuesCreated();
            reopened += result.issuesReopened();
        }
        return new ExtractionBatchResult(batch.size(), evidenceAdded, unknownAdded, issuesCreated,
                reopened);
    }

    /**
     * Apply the two automatic lifecycle transitions. Idempotent for a given reference date, so it is
     * safe on a schedule and safe to re-run after a failure.
     */
    @PostMapping("/lifecycle-pass")
    public ReviewIssueLifecycleService.AutomaticPassResult lifecyclePass(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) LocalDate referenceDate) {
        return lifecycle.runAutomaticPass(principal.orgId(), orToday(referenceDate));
    }

    /** 확인 필요 → 조치 중. */
    @PostMapping("/{issueId}/acting")
    public ReviewIssueView startActing(@AuthenticationPrincipal AuthPrincipal principal,
                                       @PathVariable UUID issueId,
                                       @RequestBody(required = false) Map<String, String> body) {
        lifecycle.startActing(principal.orgId(), issueId, noteOf(body));
        return query.detail(principal.orgId(), issueId, LocalDate.now(ZoneOffset.UTC)).issue();
    }

    /** 조치 중 → 개선 확인 중. From here a quiet period becomes evidence rather than a coincidence. */
    @PostMapping("/{issueId}/remediated")
    public ReviewIssueView markRemediated(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable UUID issueId,
                                          @RequestBody(required = false) Map<String, String> body) {
        lifecycle.markRemediated(principal.orgId(), issueId, noteOf(body));
        return query.detail(principal.orgId(), issueId, LocalDate.now(ZoneOffset.UTC)).issue();
    }

    @PostMapping("/{issueId}/dismiss")
    public ReviewIssueView dismiss(@AuthenticationPrincipal AuthPrincipal principal,
                                   @PathVariable UUID issueId) {
        lifecycle.dismiss(principal.orgId(), issueId);
        return query.detail(principal.orgId(), issueId, LocalDate.now(ZoneOffset.UTC)).issue();
    }

    @PostMapping("/{issueId}/restore")
    public ReviewIssueView restore(@AuthenticationPrincipal AuthPrincipal principal,
                                   @PathVariable UUID issueId) {
        lifecycle.restore(principal.orgId(), issueId);
        return query.detail(principal.orgId(), issueId, LocalDate.now(ZoneOffset.UTC)).issue();
    }

    /**
     * UTC, matching how {@code reviews.received_at} was written — see
     * {@code contracts/review-issue/v1/THRESHOLDS.md} §1. Using a local zone here would put the
     * default reference date in a different day from the buckets it is compared against.
     */
    private static LocalDate orToday(LocalDate referenceDate) {
        return referenceDate == null ? LocalDate.now(ZoneOffset.UTC) : referenceDate;
    }

    private static String noteOf(Map<String, String> body) {
        return body == null ? null : body.get("note");
    }

    /**
     * What one extraction batch changed. All zeros with a non-zero {@code reviewsScanned} is the
     * normal, correct result of a re-run — reported rather than hidden, because "analysis complete"
     * with nothing behind it is the kind of claim this codebase avoids.
     */
    public record ExtractionBatchResult(int reviewsScanned, int evidenceAdded, int unknownAdded,
                                        int issuesCreated, int issuesReopened) {
    }
}
