package com.sellerops.connector;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.connector.dto.ConnectorAlertView;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * In-app view of recorded connector/sync alerts for the caller's org, plus the
 * acknowledge (확인 처리) action. Delivery (email/push) is out of scope here.
 */
@RestController
@RequestMapping("/api/connector-alerts")
public class ConnectorAlertController {

    private final ConnectorAlertService service;

    public ConnectorAlertController(ConnectorAlertService service) {
        this.service = service;
    }

    @GetMapping
    public List<ConnectorAlertView> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.list(principal.orgId());
    }

    /** Mark one alert as seen (확인 처리). Org-scoped, idempotent; returns the
     *  updated view. A cross-org or missing id is a 404. */
    @PostMapping("/{id}/acknowledge")
    public ConnectorAlertView acknowledge(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable UUID id) {
        return service.acknowledge(principal.orgId(), id);
    }
}
