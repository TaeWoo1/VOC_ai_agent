package com.sellerops.collect;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.collect.dto.ConnectionStatusView;
import com.sellerops.collect.dto.CredentialIntakeRequest;
import com.sellerops.collect.dto.ManualSyncRequest;
import com.sellerops.collect.dto.SchedulePutRequest;
import com.sellerops.collect.dto.ScheduleView;
import com.sellerops.collect.dto.SyncRunView;
import com.sellerops.credential.CredentialMetadata;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Per-account collection controls — thin delegate over {@link CollectControlService}. */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}")
public class SellerAccountCollectController {

    private final CollectControlService service;

    public SellerAccountCollectController(CollectControlService service) {
        this.service = service;
    }

    @GetMapping("/schedule")
    public List<ScheduleView> schedules(@AuthenticationPrincipal AuthPrincipal principal,
                                        @PathVariable UUID accountId) {
        return service.listSchedules(principal.orgId(), accountId);
    }

    @PutMapping("/schedule")
    public ScheduleView putSchedule(@AuthenticationPrincipal AuthPrincipal principal,
                                    @PathVariable UUID accountId,
                                    @Valid @RequestBody SchedulePutRequest request) {
        return service.putSchedule(principal.orgId(), accountId, request);
    }

    @PostMapping("/sync")
    public SyncRunView manualSync(@AuthenticationPrincipal AuthPrincipal principal,
                                  @PathVariable UUID accountId,
                                  @Valid @RequestBody ManualSyncRequest request) {
        return service.manualSync(principal.orgId(), accountId, request.dataType());
    }

    @GetMapping("/connection-status")
    public ConnectionStatusView connectionStatus(@AuthenticationPrincipal AuthPrincipal principal,
                                                 @PathVariable UUID accountId) {
        return service.connectionStatus(principal.orgId(), accountId);
    }

    /** Write-only credential intake — responds with masked metadata, never secrets. */
    @PostMapping("/credentials")
    public CredentialMetadata storeCredential(@AuthenticationPrincipal AuthPrincipal principal,
                                              @PathVariable UUID accountId,
                                              @Valid @RequestBody CredentialIntakeRequest request) {
        return service.storeCredential(principal.orgId(), accountId, request, principal.userId());
    }

    /** Masked credential metadata — no plaintext, ciphertext, IV, or refresh token. */
    @GetMapping("/credentials")
    public CredentialMetadata readCredential(@AuthenticationPrincipal AuthPrincipal principal,
                                             @PathVariable UUID accountId) {
        return service.readCredential(principal.orgId(), accountId);
    }
}
