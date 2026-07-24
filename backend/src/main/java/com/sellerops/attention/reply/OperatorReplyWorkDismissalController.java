package com.sellerops.attention.reply;

import com.sellerops.attention.reply.dto.ReviewReplyWorkDismissalRequest;
import com.sellerops.attention.reply.dto.ReviewReplyWorkDismissalResponse;
import com.sellerops.auth.AuthPrincipal;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 작업에서 제외 — set one review aside from the 내 답변 작업 to-do.
 *
 * <p>The org comes from the authenticated principal (never the client); the account and the
 * {@code actionRef} are the address the write is authorized against. It writes only an append-only
 * dismissal — no draft is touched, no outcome is recorded, no completion is implied — and the review
 * re-enters the to-do on its own once the operator re-marks 대응 필요 or saves a new draft.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}/attention/items/{actionRef}/reply-work")
public class OperatorReplyWorkDismissalController {

    private static final String ACTOR_PREFIX = "SELLER:";

    private final ReviewReplyWorkDismissalService service;

    public OperatorReplyWorkDismissalController(ReviewReplyWorkDismissalService service) {
        this.service = service;
    }

    @PostMapping("/dismiss")
    public ReviewReplyWorkDismissalResponse dismiss(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID accountId,
            @PathVariable String actionRef,
            @RequestBody ReviewReplyWorkDismissalRequest request) {
        return service.dismiss(principal.orgId(), accountId, actionRef,
                request.commandId(), ACTOR_PREFIX + principal.userId());
    }
}
