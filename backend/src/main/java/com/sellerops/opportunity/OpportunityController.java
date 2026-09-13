package com.sellerops.opportunity;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.opportunity.dto.OpportunityDraftRequest;
import com.sellerops.opportunity.dto.OpportunityView;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Improvement opportunities — READ of derived objects, and the seller's decisions about them.
 *
 * <p>Identity in the path is {@code (issueId, kind)}: an opportunity has no id of its own. Every
 * mutation re-derives before it writes, so a decision can only be recorded about an opportunity the
 * evidence supports right now. Nothing here sends, publishes, or approves anything.
 *
 * <p>Each mutation also appends one row to the opportunity's decision trail, which rides back on the
 * view — there is no separate history endpoint, because a screen that can render the decision can
 * always render how it got there and should never be able to show one without the other.
 */
@RestController
@RequestMapping("/api/opportunities")
public class OpportunityController {

    private final OpportunityService service;

    public OpportunityController(OpportunityService service) {
        this.service = service;
    }

    @GetMapping
    public List<OpportunityView> list(@AuthenticationPrincipal AuthPrincipal principal,
                                      @RequestParam(required = false) UUID productId,
                                      @RequestParam(required = false) UUID issueId,
                                      @RequestParam(defaultValue = "false") boolean includeDismissed,
                                      @RequestParam(required = false) LocalDate referenceDate) {
        return service.list(principal.orgId(), orToday(referenceDate), productId, issueId, includeDismissed);
    }

    @PostMapping("/{issueId}/{kind}/accept")
    public OpportunityView accept(@AuthenticationPrincipal AuthPrincipal principal,
                                  @PathVariable UUID issueId, @PathVariable OpportunityKind kind,
                                  @RequestParam(required = false) LocalDate referenceDate) {
        return service.accept(principal.orgId(), principal.userId(), issueId, kind, orToday(referenceDate));
    }

    @PostMapping("/{issueId}/{kind}/dismiss")
    public OpportunityView dismiss(@AuthenticationPrincipal AuthPrincipal principal,
                                   @PathVariable UUID issueId, @PathVariable OpportunityKind kind,
                                   @RequestParam(required = false) LocalDate referenceDate) {
        return service.dismiss(principal.orgId(), principal.userId(), issueId, kind, orToday(referenceDate));
    }

    @PostMapping("/{issueId}/{kind}/restore")
    public OpportunityView restore(@AuthenticationPrincipal AuthPrincipal principal,
                                   @PathVariable UUID issueId, @PathVariable OpportunityKind kind,
                                   @RequestParam(required = false) LocalDate referenceDate) {
        return service.restore(principal.orgId(), principal.userId(), issueId, kind, orToday(referenceDate));
    }

    @PutMapping("/{issueId}/{kind}/draft")
    public OpportunityView updateDraft(@AuthenticationPrincipal AuthPrincipal principal,
                                       @PathVariable UUID issueId, @PathVariable OpportunityKind kind,
                                       @RequestParam(required = false) LocalDate referenceDate,
                                       @RequestBody OpportunityDraftRequest request) {
        return service.updateDraft(principal.orgId(), principal.userId(), issueId, kind, orToday(referenceDate), request);
    }

    private static LocalDate orToday(LocalDate date) {
        return date != null ? date : LocalDate.now(ZoneOffset.UTC);
    }
}
