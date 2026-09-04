package com.sellerops.auth.device;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The authenticated half: the seller's session approves a pending helper, lists the helpers linked to the
 * organisation and revokes one (설정 › 연결된 기기). A helper token reaches exactly two of these —
 * {@code GET/DELETE /me}, its own row — by {@link HelperDeviceAuthFilter#ALLOWED}; approve, list and revoke-by-id
 * are the seller's alone.
 */
@RestController
@RequestMapping("/api/helper-devices")
public class HelperDeviceController {

    public record ApproveRequest(@NotBlank String userCode) {}

    private final HelperDeviceService service;

    public HelperDeviceController(HelperDeviceService service) {
        this.service = service;
    }

    @PostMapping("/approve")
    public void approve(@AuthenticationPrincipal AuthPrincipal principal,
                        @RequestBody @jakarta.validation.Valid ApproveRequest request) {
        service.approve(principal, request.userCode());
    }

    @GetMapping
    public List<HelperDeviceView> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.list(principal.orgId());
    }

    @DeleteMapping("/{id}")
    public void revoke(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID id) {
        service.revoke(principal.orgId(), id);
    }

    /** The helper checks its own standing: 200 while linked, 401 (from the filter) once revoked. */
    @GetMapping("/me")
    public HelperDeviceView me(@AuthenticationPrincipal AuthPrincipal principal, HttpServletRequest request) {
        return service.view(principal.orgId(), deviceIdOf(request));
    }

    /** The helper unlinks itself (uninstall). */
    @DeleteMapping("/me")
    public void unlinkSelf(@AuthenticationPrincipal AuthPrincipal principal, HttpServletRequest request) {
        service.revoke(principal.orgId(), deviceIdOf(request));
    }

    private static UUID deviceIdOf(HttpServletRequest request) {
        Object id = request.getAttribute(HelperDeviceAuthFilter.DEVICE_ID_ATTRIBUTE);
        if (!(id instanceof UUID uuid)) {
            // A seller session on /me: there is no "this device" to speak of.
            throw ApiException.notFound("도우미 연결에서만 확인할 수 있습니다.");
        }
        return uuid;
    }
}
