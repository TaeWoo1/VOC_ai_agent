package com.sellerops.collect;

import com.sellerops.attention.reply.ReviewReplySubmissionTargetService;
import com.sellerops.attention.reply.dto.AgentReplySubmissionTargetRequest;
import com.sellerops.attention.reply.dto.AgentReplySubmissionTargetView;
import com.sellerops.auth.AuthPrincipal;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Local Agent's reply route — the sibling of {@code /review-locate-targets} and
 * {@code /review-acquisition-targets}: it hands over the {@code submissionRef} a guided run was started
 * with and gets back what the run needs. A POST because the ref is spent; the ref in the body because it
 * is a single-use secret; the org from the JWT so another tenant's ref reads as absent.
 */
@RestController
@RequestMapping("/api/agent")
public class AgentReplySubmissionTargetController {

    private final ReviewReplySubmissionTargetService service;

    public AgentReplySubmissionTargetController(ReviewReplySubmissionTargetService service) {
        this.service = service;
    }

    @PostMapping("/reply-submission-targets")
    public AgentReplySubmissionTargetView resolve(@AuthenticationPrincipal AuthPrincipal principal,
                                                  @Valid @RequestBody AgentReplySubmissionTargetRequest request) {
        return service.resolve(principal.orgId(), request.submissionRef());
    }
}
