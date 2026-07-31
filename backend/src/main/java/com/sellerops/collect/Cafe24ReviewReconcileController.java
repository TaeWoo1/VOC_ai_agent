package com.sellerops.collect;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.ingest.Cafe24ReviewPromotionReconciler;
import com.sellerops.ingest.Cafe24ReviewPromotionReconciler.ReconcileResult;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Operator-triggered, bounded reconcile that promotes ALREADY-STORED Cafe24 board-4 public REVIEW
 * articles for one account and exact KST window into the existing Issue-Memory pipeline — with
 * <b>no Cafe24 API call</b> (reads storage only). Closes the historical gap for reviews stored before
 * the fresh-ingest bridge existed. Returns sanitized counts only.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}/reviews")
public class Cafe24ReviewReconcileController {

    private final Cafe24ReviewPromotionReconciler reconciler;

    public Cafe24ReviewReconcileController(Cafe24ReviewPromotionReconciler reconciler) {
        this.reconciler = reconciler;
    }

    @PostMapping("/reconcile-issue-memory")
    public ReconcileResult reconcile(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID accountId,
            @RequestParam @NotNull @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam @NotNull @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate) {
        return reconciler.reconcile(principal.orgId(), accountId, startDate, endDate);
    }
}
