package com.sellerops.usage;

import com.sellerops.auth.AuthPrincipal;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The only endpoint that exists to be measured rather than used.
 *
 * <p><b>Why it is a POST of its own, and not a side effect of {@code GET /api/operations/home}.</b>
 * A GET that writes is a GET that a health check, a prefetch, a retry or a smoke script also writes
 * through — and the number would then count this repository's own probes as a seller's morning. One
 * explicit call from the page, with one caller, is a number somebody can still explain in a month.
 *
 * <p>It takes no body and returns no body. There is nothing to send: the organisation comes from the
 * bearer token and the day comes from the server's clock, so a request cannot carry a claim about
 * who or when — which is the same reason it cannot leak one.
 */
@RestController
@RequestMapping("/api/usage")
public class UsageSignalController {

    private final HomeOpenSignal signal;

    public UsageSignalController(HomeOpenSignal signal) {
        this.signal = signal;
    }

    @PostMapping("/home-opened")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void homeOpened(@AuthenticationPrincipal AuthPrincipal principal) {
        if (principal == null) {
            return;
        }
        try {
            signal.homeOpened(principal.orgId());
        } catch (RuntimeException measurementFailure) {
            // Never the seller's problem. The page that called this is already rendered.
        }
    }
}
