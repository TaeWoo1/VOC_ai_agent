package com.sellerops.inquiry.lifecycle;

import com.sellerops.auth.AuthPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Rebuild {@code inquiries.operational_state} from this org's dismissal ledger.
 *
 * <p><b>Why this is an endpoint and not a migration.</b> The state it writes is derived from the
 * application's own closed vocabulary ({@code InquiryWorkItemDisposition}); a migration that
 * hard-coded that vocabulary in SQL would become a second authority the moment the enum grew. This
 * calls the same projector the dismissal path calls, so there is exactly one derivation and it is
 * exercised by both.
 *
 * <p>Idempotent and org-scoped: the org comes from the JWT principal, never from the request, and a
 * second run over an already-projected org writes nothing. It deletes nothing — an excluded inquiry
 * keeps its body, its work item, its audit trail and its customer-memory entry; only the current reads
 * pass over it.
 */
@RestController
@RequestMapping("/api/inquiries/operational-state")
public class InquiryOperationalStateController {

    private final InquiryOperationalStateBackfill backfill;

    public InquiryOperationalStateController(InquiryOperationalStateBackfill backfill) {
        this.backfill = backfill;
    }

    @PostMapping("/backfill")
    public InquiryOperationalStateBackfill.Result backfill(@AuthenticationPrincipal AuthPrincipal principal) {
        return backfill.run(principal.orgId());
    }
}
