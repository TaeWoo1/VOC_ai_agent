package com.sellerops.inbox;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.inbox.dto.InboxResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/inbox")
public class InboxController {

    private final InboxService inboxService;

    public InboxController(InboxService inboxService) {
        this.inboxService = inboxService;
    }

    /**
     * @param type optional {@code INQUIRY} / {@code REVIEW} — one kind only (the 문의 screen reads inquiries)
     * @param limit rows to return; default 50, ceiling 500. The unanswered count in the response is not capped.
     */
    @GetMapping
    public InboxResponse inbox(@AuthenticationPrincipal AuthPrincipal principal,
                               @RequestParam(required = false) String type,
                               @RequestParam(defaultValue = "50") int limit) {
        return inboxService.inbox(principal.orgId(), type, limit);
    }
}
