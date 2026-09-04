package com.sellerops.report;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.report.dto.AgentReportListItem;
import com.sellerops.report.dto.AgentReportView;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /api/agent-reports} — read a cadence's current report (generating the period's first
 * version if none exists), reopen a stored one, list recent ones, or ask for a new version.
 *
 * <p>Reading never mutates an existing row; {@code current} writes only when the period has no
 * report at all, which is why it is a GET the screen can call on open.
 */
@RestController
@RequestMapping("/api/agent-reports")
public class AgentReportController {

    private final AgentReportService service;

    public AgentReportController(AgentReportService service) {
        this.service = service;
    }

    @GetMapping("/current")
    public AgentReportView current(@AuthenticationPrincipal AuthPrincipal principal,
                                   @RequestParam(defaultValue = "WEEKLY") String kind) {
        return service.current(principal.orgId(), ReportKind.parse(kind));
    }

    @GetMapping
    public List<AgentReportListItem> list(@AuthenticationPrincipal AuthPrincipal principal,
                                          @RequestParam(defaultValue = "WEEKLY") String kind) {
        return service.list(principal.orgId(), ReportKind.parse(kind));
    }

    @GetMapping("/{id}")
    public AgentReportView get(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID id) {
        return service.get(principal.orgId(), id);
    }

    @PostMapping("/regenerate")
    public AgentReportView regenerate(@AuthenticationPrincipal AuthPrincipal principal,
                                      @RequestParam(defaultValue = "WEEKLY") String kind,
                                      @RequestParam(required = false)
                                      @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodStart) {
        return service.regenerate(principal.orgId(), ReportKind.parse(kind), periodStart);
    }
}
