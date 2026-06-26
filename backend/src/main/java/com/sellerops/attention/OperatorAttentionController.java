package com.sellerops.attention;

import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.auth.AuthPrincipal;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Operator attention view for one connected account — a ranked "오늘 확인할 일" list
 * over an explicit [from, to] window. Thin delegate over
 * {@link OperatorAttentionService}; orgId always comes from the authenticated
 * principal, never the client.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}")
public class OperatorAttentionController {

    private final OperatorAttentionService service;

    public OperatorAttentionController(OperatorAttentionService service) {
        this.service = service;
    }

    /** Ranked attention signals over an explicit [from, to] window (KST calendar dates). */
    @GetMapping("/attention")
    public OperatorAttentionSummary attention(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID accountId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return service.attention(principal.orgId(), accountId, from, to);
    }
}
