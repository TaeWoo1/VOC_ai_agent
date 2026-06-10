package com.sellerops.order;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.order.dto.OrderSummaryResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @GetMapping("/summary")
    public OrderSummaryResponse summary(@AuthenticationPrincipal AuthPrincipal principal) {
        return orderService.summary(principal.orgId());
    }
}
