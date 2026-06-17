package com.sellerops.sync;

import com.sellerops.auth.AuthPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/sync-jobs")
public class SyncJobController {

    private final SyncJobRepository syncJobs;

    public SyncJobController(SyncJobRepository syncJobs) {
        this.syncJobs = syncJobs;
    }

    @GetMapping
    public List<SyncJobView> recent(@AuthenticationPrincipal AuthPrincipal principal) {
        return syncJobs.findTop20ByOrgIdOrderByCreatedAtDesc(principal.orgId()).stream()
                .map(SyncJobView::from)
                .toList();
    }
}
