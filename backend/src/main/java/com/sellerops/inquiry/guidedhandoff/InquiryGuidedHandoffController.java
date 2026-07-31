package com.sellerops.inquiry.guidedhandoff;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.inquiry.guidedhandoff.dto.InquiryGuidedHandoffOutcomeRequest;
import com.sellerops.inquiry.guidedhandoff.dto.InquiryGuidedHandoffOutcomeResponse;
import com.sellerops.inquiry.guidedhandoff.dto.InquiryGuidedHandoffView;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Guided Handoff surface for one Cafe24 board-6 inquiry work item: guide the operator to
 * answer on the Cafe24 admin themselves, then record their UNVERIFIED self-report. Keyed by
 * work item id and org-scoped via {@code principal.orgId()} (a foreign/unknown id is a 404).
 *
 * <p><b>No send, and nothing that resembles one.</b> There is no marketplace call behind any
 * route here: {@code /capability} and {@code POST} (mint) are read/guide-only, and
 * {@code /outcome} records only a local operator report. The work-item phase is never changed;
 * completion happens elsewhere, when the answer is re-collected as 처리완료.
 *
 * <p>Nested under {@code /api/inquiries/{workItemId}} but on the {@code /guided-handoff}
 * sub-path, so it never collides with {@code InquiryDetailController}'s {@code /{workItemId}}
 * routes.
 */
@RestController
@RequestMapping("/api/inquiries/{workItemId}/guided-handoff")
public class InquiryGuidedHandoffController {

    private final InquiryGuidedHandoffService service;

    public InquiryGuidedHandoffController(InquiryGuidedHandoffService service) {
        this.service = service;
    }

    /** Read-only eligibility + privacy-safe target hint + manual checklist. Never writes. */
    @GetMapping("/capability")
    public InquiryGuidedHandoffView capability(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable UUID workItemId) {
        return service.capability(principal.orgId(), workItemId);
    }

    /**
     * Mint the guided handoff (records a MINTED audit, idempotent; phase unchanged) and return
     * the descriptor. 409 when the item is not eligible to mint (not OPEN, not a bound Cafe24
     * board-6 inquiry, or a channel that has a live reply adapter).
     */
    @PostMapping
    public InquiryGuidedHandoffView mint(@AuthenticationPrincipal AuthPrincipal principal,
                                         @PathVariable UUID workItemId) {
        return service.mint(principal.orgId(), workItemId, "SELLER:" + principal.userId());
    }

    /**
     * Record the operator's UNVERIFIED report of their own manual reply. 200 for a fresh
     * record and for an exact replay ({@code replayed} distinguishes them); 400 for a blank
     * commandId or unknown outcome; 409 when the item is not a guided Cafe24 inquiry or the
     * commandId was spent on a different outcome. Never completes the work item.
     */
    @PostMapping("/outcome")
    public InquiryGuidedHandoffOutcomeResponse recordOutcome(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID workItemId,
            @RequestBody InquiryGuidedHandoffOutcomeRequest request) {
        return service.recordOutcome(principal.orgId(), workItemId,
                request.commandId(), request.operatorOutcome(), "SELLER:" + principal.userId());
    }
}
