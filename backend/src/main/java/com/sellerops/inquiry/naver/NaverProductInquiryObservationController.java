package com.sellerops.inquiry.naver;

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
 * <b>Where an installed helper hands in the 상품 문의 a scheduled NAVER read saw — for the job it holds, and no
 * other.</b> The sibling of {@code NaverReviewObservationController}, under the same device-token-only route family;
 * the organisation and device come from the validated token, never from the body.
 */
@RestController
public class NaverProductInquiryObservationController {

    private final NaverProductInquiryObservationService service;

    public NaverProductInquiryObservationController(NaverProductInquiryObservationService service) {
        this.service = service;
    }

    @PostMapping("/api/helper-devices/jobs/{jobId}/naver-product-inquiries")
    public NaverProductInquiryObservationView deliver(@AuthenticationPrincipal AuthPrincipal principal,
                                                      HttpServletRequest request, @PathVariable UUID jobId,
                                                      @RequestBody NaverProductInquiryObservationRequest body) {
        Object device = request.getAttribute(HelperDeviceAuthFilter.DEVICE_ID_ATTRIBUTE);
        if (!(device instanceof UUID deviceId)) {
            throw ApiException.forbidden("이 요청은 연결된 도우미만 보낼 수 있습니다.");
        }
        return service.deliver(principal.orgId(), deviceId, jobId, body);
    }
}
