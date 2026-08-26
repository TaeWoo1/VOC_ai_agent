package com.sellerops.knowledge.style;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.knowledge.style.dto.AnswerStyleRequest;
import com.sellerops.knowledge.style.dto.AnswerStyleView;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI 답변 스타일 — read and save the one profile this company answers by.
 *
 * <p>Two routes and no org parameter: the org comes from the JWT, so one company's wording is not
 * addressable by another. There is no list route, because there is nothing to list.
 */
@RestController
@RequestMapping("/api/answer-style")
public class AnswerStyleController {

    private final AnswerStyleService styles;

    public AnswerStyleController(AnswerStyleService styles) {
        this.styles = styles;
    }

    @GetMapping
    public AnswerStyleView get(@AuthenticationPrincipal AuthPrincipal principal) {
        return styles.view(principal.orgId());
    }

    @PutMapping
    public AnswerStyleView save(@AuthenticationPrincipal AuthPrincipal principal,
                                @RequestBody AnswerStyleRequest request) {
        return styles.save(principal.orgId(), request, principal.userId());
    }
}
