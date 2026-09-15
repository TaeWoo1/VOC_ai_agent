package com.sellerops.responsibility;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.responsibility.dto.ResponsibilityView;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 「고객 운영 관리」 — take the job on, hand it back, and read how each window was worked.
 *
 * <p>There is deliberately no «run now»: a responsibility works its windows on its own schedule, and the only
 * run a person causes is the one activation (or resume) starts for the window that is open.
 */
@RestController
@RequestMapping("/api/responsibilities/customer-operations")
public class ResponsibilityController {

    private final ResponsibilityService service;

    public ResponsibilityController(ResponsibilityService service) {
        this.service = service;
    }

    @GetMapping
    public ResponsibilityView get(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.view(principal.orgId());
    }

    @PostMapping("/activate")
    public ResponsibilityView activate(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.activate(principal.orgId(), principal.userId());
    }

    @PostMapping("/pause")
    public ResponsibilityView pause(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.pause(principal.orgId());
    }

    @PostMapping("/resume")
    public ResponsibilityView resume(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.resume(principal.orgId());
    }

    @PostMapping("/stop")
    public ResponsibilityView stop(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.stop(principal.orgId());
    }
}
