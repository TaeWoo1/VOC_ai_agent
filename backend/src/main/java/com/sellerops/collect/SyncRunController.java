package com.sellerops.collect;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.collect.dto.SyncRunView;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Unified run history + operator retry. Extends (does not replace) the legacy
 * {@code /api/sync-jobs} read the upload page already uses.
 */
@RestController
@RequestMapping("/api/sync-runs")
public class SyncRunController {

    private final CollectControlService service;

    public SyncRunController(CollectControlService service) {
        this.service = service;
    }

    @GetMapping
    public List<SyncRunView> recent(@AuthenticationPrincipal AuthPrincipal principal,
                                    @RequestParam(required = false) UUID sellerAccountId,
                                    @RequestParam(required = false) UUID channelId,
                                    @RequestParam(required = false) String dataType,
                                    @RequestParam(required = false) String trigger,
                                    @RequestParam(required = false) String status) {
        return service.listRuns(principal.orgId(), sellerAccountId, channelId, dataType, trigger, status);
    }

    @PostMapping("/{id}/retry")
    public SyncRunView retry(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID id) {
        return service.retry(principal.orgId(), id);
    }
}
