package com.sellerops.connector;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.connector.dto.ConnectorAlertView;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read-only in-app view of recorded connector/sync alerts for the caller's org.
 * Delivery (email/push) and acknowledgement are out of scope here.
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
}
