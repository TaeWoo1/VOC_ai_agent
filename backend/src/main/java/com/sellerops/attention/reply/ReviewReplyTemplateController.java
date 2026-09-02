package com.sellerops.attention.reply;

import com.sellerops.attention.reply.dto.ReviewReplyTemplateRequest;
import com.sellerops.attention.reply.dto.ReviewReplyTemplateView;
import com.sellerops.attention.reply.dto.ReviewReplyTemplatesView;
import com.sellerops.auth.AuthPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 리뷰 답변 문구 — read, save and restore this company's wording for the review reply categories.
 *
 * <p>No org parameter on any route: the org comes from the JWT, exactly as
 * {@code AnswerStyleController} does, so one company's templates are not addressable by another. The
 * key in the path is a closed category and an unknown one is a 400, never a silently created row.
 *
 * <p>Nothing here sends, approves, drafts or executes. Saving a template changes what the NEXT
 * suggestion starts from and nothing else — a draft already saved keeps its version and fingerprint,
 * and an approved reply is untouched.
 */
@RestController
@RequestMapping("/api/review-reply-templates")
public class ReviewReplyTemplateController {

    private final ReviewReplyTemplateService templates;

    public ReviewReplyTemplateController(ReviewReplyTemplateService templates) {
        this.templates = templates;
    }

    @GetMapping
    public ReviewReplyTemplatesView list(@AuthenticationPrincipal AuthPrincipal principal) {
        return templates.view(principal.orgId());
    }

    @PutMapping("/{templateKey}")
    public ReviewReplyTemplateView save(@AuthenticationPrincipal AuthPrincipal principal,
                                        @PathVariable String templateKey,
                                        @RequestBody ReviewReplyTemplateRequest request) {
        return templates.save(principal.orgId(), templateKey, request.body(), principal.userId());
    }

    /** 기본값 복원 — removes the override so the shipped wording applies again. */
    @DeleteMapping("/{templateKey}")
    public ReviewReplyTemplateView reset(@AuthenticationPrincipal AuthPrincipal principal,
                                         @PathVariable String templateKey) {
        return templates.reset(principal.orgId(), templateKey);
    }
}
