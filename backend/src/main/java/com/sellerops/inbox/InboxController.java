package com.sellerops.inbox;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.inbox.dto.InboxResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/inbox")
public class InboxController {

    private final InboxService inboxService;

    public InboxController(InboxService inboxService) {
        this.inboxService = inboxService;
    }

    @GetMapping
    public InboxResponse inbox(@AuthenticationPrincipal AuthPrincipal principal) {
        return inboxService.inbox(principal.orgId());
    }
}
