package com.sellerops.operationscase;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.operationscase.dto.CustomerOperationsHomeView;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Home's 「고객 운영 관리」 read. GET only: a case's status belongs to the reconciler, and a seller acts on the
 * inquiry or review screen that owns the decision — there is no endpoint that resolves, dismisses or sends from here.
 */
@RestController
public class CustomerOperationsHomeController {

    private final CustomerOperationsHomeService service;

    public CustomerOperationsHomeController(CustomerOperationsHomeService service) {
        this.service = service;
    }

    @GetMapping("/api/responsibilities/customer-operations/home")
    public CustomerOperationsHomeView home(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.home(principal.orgId());
    }
}
