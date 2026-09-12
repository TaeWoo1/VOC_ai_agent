package com.sellerops.operations;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.operations.dto.OperationsHomeView;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * One GET, and <b>no write anywhere on this surface.</b>
 *
 * <p>The Home hands work over; it is not a second place to do it. Every action it offers is a link to
 * the screen that already owns that decision — the review decision workspace, the repeated problem,
 * the inquiry. A Home that could also decide would be a second door onto every decision in the
 * product, and two doors onto one decision eventually disagree about what was decided.
 */
@RestController
@RequestMapping("/api/operations")
public class OperationsHomeController {

    private final OperationsHomeService service;

    public OperationsHomeController(OperationsHomeService service) {
        this.service = service;
    }

    @GetMapping("/home")
    public OperationsHomeView home(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
            LocalDate referenceDate) {
        return service.home(principal.orgId(), referenceDate);
    }
}
