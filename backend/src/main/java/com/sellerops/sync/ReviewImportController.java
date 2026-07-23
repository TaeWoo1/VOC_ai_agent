package com.sellerops.sync;

import com.sellerops.auth.AuthPrincipal;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The seller's own record of what their review imports brought — the answer to "did it work, and what
 * came in?" after an Action Window export or a file upload.
 *
 * <p><b>Why this is its own read.</b> The two existing history reads cannot answer it:
 * {@code /api/sync-jobs} returns a mixed top-20 (filtering would have to happen after the window, so
 * a busy org loses its review imports), and {@code /api/sync-runs} filters on {@code dataType} /
 * {@code sellerAccountId}, both of which an upload leaves {@code null} — so uploads are invisible to
 * it by construction. Rather than widen a shared endpoint from inside a UI slice, this read is narrow
 * and correct: the predicate lives in the query and the limit applies after it
 * ({@link SyncJobRepository#findReviewImports}).
 *
 * <p>Org-scoped from the JWT, exactly like every sibling read — {@code orgId} is never a parameter.
 * The response carries counts, provenance, outcome and timing only; see {@link ReviewImportView} for
 * what is deliberately not in it.
 */
@RestController
@RequestMapping("/api/imports/reviews")
public class ReviewImportController {

    /** Default page size — "recent history", not an archive. The UI says so too. */
    static final int DEFAULT_LIMIT = 20;
    /**
     * Hard ceiling on the RESULT size. It bounds what is returned and serialized — it does not bound
     * the scan: the predicate still sorts the org's review imports before the limit applies. That is
     * the honest description; `V22` adds the index that makes the read cheap.
     */
    static final int MAX_LIMIT = 50;

    private final SyncJobRepository syncJobs;

    public ReviewImportController(SyncJobRepository syncJobs) {
        this.syncJobs = syncJobs;
    }

    @GetMapping
    public List<ReviewImportView> recent(@AuthenticationPrincipal AuthPrincipal principal,
                                         @RequestParam(required = false) Integer limit) {
        return syncJobs.findReviewImports(principal.orgId(), PageRequest.of(0, clampLimit(limit)))
                .stream()
                .map(ReviewImportView::from)
                .toList();
    }

    /**
     * Absent → the default; out of range → clamped rather than rejected.
     *
     * <p>Clamping beats a 400 here: the parameter is a display convenience, and a client asking for
     * too many rows wants a list, not an error. A non-positive value clamps up to 1 so
     * {@code PageRequest} can never be constructed with an illegal size.
     */
    private static int clampLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_LIMIT;
        }
        return Math.max(1, Math.min(MAX_LIMIT, limit));
    }
}
