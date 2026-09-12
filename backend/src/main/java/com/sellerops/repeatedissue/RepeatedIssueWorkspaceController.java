package com.sellerops.repeatedissue;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.repeatedissue.dto.RepeatedIssueContextView;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * One GET. <b>There is deliberately no write here.</b>
 *
 * <p>A seller's decision about a repeated problem is the issue lifecycle, and those four transitions
 * have belonged to {@code ReviewIssueController} since the lifecycle existed — with the state machine
 * that refuses the ones only evidence may make. Minting a second door onto the same decision is how
 * two surfaces come to disagree about what was decided, and the workspace this read serves calls the
 * existing endpoints unchanged.
 */
@RestController
@RequestMapping("/api/review-issues/{issueId}")
public class RepeatedIssueWorkspaceController {

    private final RepeatedIssueWorkspaceService service;

    public RepeatedIssueWorkspaceController(RepeatedIssueWorkspaceService service) {
        this.service = service;
    }

    @GetMapping("/repeat-context")
    public RepeatedIssueContextView repeatContext(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID issueId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
            LocalDate referenceDate) {
        LocalDate on = referenceDate == null ? LocalDate.now(ZoneOffset.UTC) : referenceDate;
        return service.context(principal.orgId(), issueId, on);
    }
}
