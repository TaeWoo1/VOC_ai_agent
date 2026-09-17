package com.sellerops.responsibility.aside;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.auth.device.HelperDeviceAuthFilter;
import com.sellerops.common.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * <b>The two things an installed helper may say when nobody is watching: «anything for me?» and «here is what
 * it came to».</b>
 *
 * <p>The helper names neither the organisation nor itself. Both are taken from the device token the auth filter
 * already validated — the org from the principal, the device from the attribute that filter set — so a request
 * body cannot point this at another seller's device, and there is no parameter through which it could try.
 *
 * <p>There is also no parameter for what to run. The job's recipe is an allow-listed enum chosen when the job
 * was queued; the response tells the helper which recipe, and the helper resolves that name to a surface this
 * repository serves on its own loopback. A marketplace is unreachable from here because no field in either
 * direction can express one.
 */
@RestController
public class ScheduledAsideJobController {

    private final ScheduledAsideJobService jobs;

    public ScheduledAsideJobController(ScheduledAsideJobService jobs) {
        this.jobs = jobs;
    }

    /**
     * Nothing queued is a normal answer, not an error: {@code jobId} is null and the helper goes back to sleep.
     *
     * <p>{@code accountSlot} and {@code expectedStoreFingerprint} are null for every recipe that reads a surface
     * this repository serves itself, and present only for one that reads the seller's own marketplace screen.
     * Neither is a target and neither is a credential — the slot is the opaque per-account identifier the review
     * handoff is already keyed by (this same helper receives it on the seller-pressed lane), and the fingerprint
     * is a digest the helper compares the screen against so it can refuse to read the wrong store. The route
     * still comes from the recipe's own bound workflow on the helper side; nothing in this response can move it.
     */
    public record ClaimResponse(UUID jobId, String recipe, Instant leaseUntil, String accountSlot,
                                String expectedStoreFingerprint) {
        static final ClaimResponse NONE = new ClaimResponse(null, null, null, null, null);
    }

    /**
     * A closed outcome token, a count, and a digest of the surface's own item refs. No message, no page text,
     * no target — and the digest is validated as 64 hex characters, so it cannot become a text channel.
     */
    public record ReportRequest(String outcome, Integer observedCount, String contentDigest) {
    }

    public record ReportResponse(UUID jobId, String status, String outcome) {
    }

    @PostMapping("/api/helper-devices/jobs/claim")
    public ClaimResponse claim(@AuthenticationPrincipal AuthPrincipal principal, HttpServletRequest request) {
        UUID deviceId = deviceOf(request);
        return jobs.claim(principal.orgId(), deviceId)
                .map(claimed -> new ClaimResponse(claimed.jobId(), claimed.recipe().name(), claimed.leaseUntil(),
                        claimed.target() == null ? null : claimed.target().accountSlot(),
                        claimed.target() == null ? null : claimed.target().expectedStoreFingerprint()))
                .orElse(ClaimResponse.NONE);
    }

    @PostMapping("/api/helper-devices/jobs/{jobId}/report")
    public ReportResponse report(@AuthenticationPrincipal AuthPrincipal principal, HttpServletRequest request,
                                 @PathVariable UUID jobId, @RequestBody ReportRequest body) {
        UUID deviceId = deviceOf(request);
        ScheduledAsideJob settled = jobs.settle(principal.orgId(), deviceId, jobId, outcomeOf(body.outcome()),
                body.observedCount(), body.contentDigest());
        return new ReportResponse(settled.getId(), settled.getStatus().name(),
                settled.getOutcome() == null ? null : settled.getOutcome().name());
    }

    /**
     * Which device is asking. Set by {@link HelperDeviceAuthFilter} from the token it validated — absent means
     * something other than a helper reached this route, and that is a refusal rather than a guess.
     */
    private static UUID deviceOf(HttpServletRequest request) {
        Object attribute = request.getAttribute(HelperDeviceAuthFilter.DEVICE_ID_ATTRIBUTE);
        if (!(attribute instanceof UUID deviceId)) {
            throw ApiException.forbidden("이 요청은 연결된 도우미만 보낼 수 있습니다.");
        }
        return deviceId;
    }

    /** An outcome this backend does not publish is refused, never coerced into the nearest one. */
    private static AsideJobOutcome outcomeOf(String raw) {
        if (raw == null || raw.isBlank()) {
            throw ApiException.badRequest("작업 결과가 필요합니다.");
        }
        try {
            return AsideJobOutcome.valueOf(raw.strip());
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("알 수 없는 작업 결과입니다.");
        }
    }
}
