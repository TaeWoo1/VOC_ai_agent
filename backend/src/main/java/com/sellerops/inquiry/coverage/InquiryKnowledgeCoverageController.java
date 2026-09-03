package com.sellerops.inquiry.coverage;

import com.sellerops.auth.AuthPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The knowledge-coverage audit, over the caller's own org.
 *
 * <p><b>Not a seller-facing screen.</b> No navigation reaches it and no component calls it. It exists
 * so the question "how much of this backlog can we now answer from evidence" has a reproducible
 * answer that anyone can re-run, instead of a number someone counted by hand once.
 *
 * <p>Org-scoped from the JWT and returns integers only — the corpus it walks is real customer mail
 * and nothing derived from an individual row leaves this route.
 */
@RestController
@RequestMapping("/api/inquiries")
public class InquiryKnowledgeCoverageController {

    private final InquiryKnowledgeCoverageService coverage;

    public InquiryKnowledgeCoverageController(InquiryKnowledgeCoverageService coverage) {
        this.coverage = coverage;
    }

    /**
     * What one inquiry's reply could be grounded in, without writing a draft.
     *
     * <p>Read-only in the strong sense: no draft version is appended, no work item moves, no channel
     * is reached, and no per-question model call is spent — see
     * {@code InquiryKnowledgeCoverageService#measured}, which is what makes that sentence true again
     * rather than merely written down. Returns the seller's own document titles and provenance
     * strings — never the customer's words and never the passage text.
     */
    @GetMapping("/{workItemId}/knowledge-evidence")
    public InquiryKnowledgeCoverageService.EvidencePreview preview(
            @AuthenticationPrincipal AuthPrincipal principal,
            @org.springframework.web.bind.annotation.PathVariable java.util.UUID workItemId) {
        return coverage.preview(principal.orgId(), workItemId);
    }

    @GetMapping("/knowledge-coverage")
    public InquiryKnowledgeCoverageService.CoverageReport measure(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam String channelCode) {
        return coverage.measure(principal.orgId(), channelCode);
    }
}
