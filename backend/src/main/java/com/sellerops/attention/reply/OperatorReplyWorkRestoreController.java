package com.sellerops.attention.reply;

import com.sellerops.attention.reply.dto.ReviewReplyWorkRestoreRequest;
import com.sellerops.attention.reply.dto.ReviewReplyWorkRestoreResponse;
import com.sellerops.auth.AuthPrincipal;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 복원 — bring one review that was set aside back onto the 내 답변 작업 to-do. The mirror of
 * {@link OperatorReplyWorkDismissalController}.
 *
 * <p>The org comes from the authenticated principal (never the client); the account and the
 * {@code actionRef} are the address the write is authorized against. It writes only an append-only
 * restore — no draft is touched, no disposition is changed, no outcome is recorded, no completion is
 * implied — and it outranks the dismissal it reverses rather than deleting it.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}/attention/items/{actionRef}/reply-work")
public class OperatorReplyWorkRestoreController {

    private static final String ACTOR_PREFIX = "SELLER:";

    private final ReviewReplyWorkRestoreService service;

    public OperatorReplyWorkRestoreController(ReviewReplyWorkRestoreService service) {
        this.service = service;
    }

    @PostMapping("/restore")
    public ReviewReplyWorkRestoreResponse restore(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID accountId,
            @PathVariable String actionRef,
            @RequestBody ReviewReplyWorkRestoreRequest request) {
        return service.restore(principal.orgId(), accountId, actionRef,
                request.commandId(), ACTOR_PREFIX + principal.userId());
    }
}
