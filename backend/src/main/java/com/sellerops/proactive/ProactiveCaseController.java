package com.sellerops.proactive;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.proactive.dto.ProactiveCaseListResponse;
import com.sellerops.proactive.dto.ProactiveCaseView;
import com.sellerops.proactive.dto.ProactiveSummaryView;
import com.sellerops.proactive.dto.ProactiveTelemetryView;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 「AI가 먼저 확인한 일」 — read, plus the one write a seller's click is the only evidence for.
 *
 * <p><b>There is no endpoint here that changes a case's status</b>, and that is the API-shaped form
 * of the same rule the reconciler states: status is derived from the work, so the way to resolve a
 * card is to do the work — through the flows that already exist. A "dismiss this card" control would
 * be a second, weaker dismissal that the inquiry queue and the review reply ledger knew nothing about.
 *
 * <p>Org-scoped from the JWT on every route; sanitized rows only.
 */
@RestController
@RequestMapping("/api/proactive")
public class ProactiveCaseController {

    private final ProactiveCaseService service;

    public ProactiveCaseController(ProactiveCaseService service) {
        this.service = service;
    }

    @GetMapping("/cases")
    public ProactiveCaseListResponse cases(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(defaultValue = "20") int limit) {
        return service.list(principal.orgId(), limit);
    }

    @GetMapping("/summary")
    public ProactiveSummaryView summary(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.summary(principal.orgId());
    }

    /**
     * The seller opened this card. A POST because it records something — the first time a person
     * looked — and a GET that quietly wrote would be a GET that lies about itself.
     */
    @PostMapping("/cases/{caseId}/opened")
    public ProactiveCaseView opened(@AuthenticationPrincipal AuthPrincipal principal,
                                    @PathVariable UUID caseId) {
        return service.open(principal.orgId(), caseId);
    }

    @GetMapping("/telemetry")
    public ProactiveTelemetryView telemetry(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.telemetry(principal.orgId());
    }
}
