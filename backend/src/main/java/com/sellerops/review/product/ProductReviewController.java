package com.sellerops.review.product;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.product.dto.ProductReviewPageView;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * READ: one product's review record — the door the 상품 screen's 리뷰 figure opens.
 *
 * <p>Org-scoped from the JWT, never from a parameter. Reads and writes nothing: no channel is contacted
 * and no state moves.
 */
@RestController
@RequestMapping("/api/products/{productId}/reviews")
public class ProductReviewController {

    private final ProductReviewsService service;

    public ProductReviewController(ProductReviewsService service) {
        this.service = service;
    }

    @GetMapping
    public ProductReviewPageView reviews(@AuthenticationPrincipal AuthPrincipal principal,
                                         @PathVariable UUID productId,
                                         @RequestParam(required = false) Integer page,
                                         @RequestParam(required = false) Integer size) {
        return service.page(principal.orgId(), productId, page, size);
    }
}
