package com.sellerops.order;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.order.dto.OrderSummaryResponse;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    /** Order/sales summary. {@code from}/{@code to} (ISO date) and {@code channelId}
     *  are optional; default is the last 7 days, all channels. Unparseable params
     *  or an invalid range yield 400. */
    @GetMapping("/summary")
    public OrderSummaryResponse summary(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) UUID channelId) {
        return orderService.summary(principal.orgId(), from, to, channelId);
    }
}
