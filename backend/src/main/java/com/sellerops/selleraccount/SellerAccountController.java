package com.sellerops.selleraccount;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.credential.CredentialDiagnosis;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.dto.ApiChannelRequest;
import com.sellerops.selleraccount.dto.FileChannelRequest;
import com.sellerops.selleraccount.dto.SellerAccountResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/seller-accounts")
public class SellerAccountController {

    private final SellerAccountService service;
    private final CredentialVault vault;

    public SellerAccountController(SellerAccountService service, CredentialVault vault) {
        this.service = service;
        this.vault = vault;
    }

    @GetMapping
    public List<SellerAccountResponse> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.listForOrg(principal.orgId());
    }

    /**
     * Why this account's stored credential can or cannot be opened right now — the seller-facing
     * answer to "연결했는데 왜 안 되나요?".
     *
     * <p>Reads no secret material and attempts no channel call, so it is safe to poll from a
     * troubleshooting screen. It exists because the three failures a seller experiences identically
     * ("복호화 실패") need three completely different responses: a server-side key configuration fix,
     * a key recovery, or an actual reconnection. Sending a seller to re-do OAuth for a problem that
     * was a server env var is the specific waste this endpoint prevents.
     */
    @GetMapping("/{accountId}/credential-diagnosis")
    public CredentialDiagnosis diagnoseCredential(@AuthenticationPrincipal AuthPrincipal principal,
                                                  @PathVariable UUID accountId) {
        return vault.diagnose(principal.orgId(), accountId);
    }

    @PostMapping("/file-channel")
    public SellerAccountResponse registerFileChannel(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody FileChannelRequest request) {
        return service.registerFileChannel(principal.orgId(), request);
    }

    /**
     * Start an official-API channel connection (e.g. the NAVER guided-connection wizard): find-or-create
     * the PENDING API-mode account this org will attach credentials to. Idempotent — re-entering the
     * wizard returns the existing account without downgrading a settled connection.
     */
    @PostMapping("/api-channel")
    public SellerAccountResponse registerApiChannel(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody ApiChannelRequest request) {
        return service.registerApiChannel(principal.orgId(), request);
    }
}
