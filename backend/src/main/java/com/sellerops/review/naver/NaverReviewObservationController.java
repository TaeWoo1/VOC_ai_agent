package com.sellerops.review.naver;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.auth.device.HelperDeviceAuthFilter;
import com.sellerops.common.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * <b>Where an installed helper hands in the reviews a scheduled NAVER read saw — for the job it holds, and no
 * other.</b>
 *
 * <p>The route sits under {@code /api/helper-devices/jobs/{jobId}} on purpose: it is part of reporting a job, it is
 * reachable only with a device token (a seller's session cannot supply the device this checks), and the job id is
 * what binds the delivery to one claim. The organisation and device come from the validated token, never from the
 * body. The store is judged here, on the backend, against the organisation's own catalogue — the helper is never
 * handed the thing it would be compared with.
 */
@RestController
public class NaverReviewObservationController {

    private final NaverReviewObservationService service;

    public NaverReviewObservationController(NaverReviewObservationService service) {
        this.service = service;
    }

    @PostMapping("/api/helper-devices/jobs/{jobId}/naver-reviews")
    public NaverReviewObservationView deliver(@AuthenticationPrincipal AuthPrincipal principal,
                                              HttpServletRequest request, @PathVariable UUID jobId,
                                              @RequestBody NaverReviewObservationRequest body) {
        Object device = request.getAttribute(HelperDeviceAuthFilter.DEVICE_ID_ATTRIBUTE);
        if (!(device instanceof UUID deviceId)) {
            throw ApiException.forbidden("이 요청은 연결된 도우미만 보낼 수 있습니다.");
        }
        return service.deliver(principal.orgId(), deviceId, jobId, body);
    }
}
