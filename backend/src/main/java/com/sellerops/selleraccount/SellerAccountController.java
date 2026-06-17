package com.sellerops.selleraccount;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.selleraccount.dto.FileChannelRequest;
import com.sellerops.selleraccount.dto.SellerAccountResponse;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/seller-accounts")
public class SellerAccountController {

    private final SellerAccountService service;

    public SellerAccountController(SellerAccountService service) {
        this.service = service;
    }

    @GetMapping
    public List<SellerAccountResponse> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.listForOrg(principal.orgId());
    }

    @PostMapping("/file-channel")
    public SellerAccountResponse registerFileChannel(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody FileChannelRequest request) {
        return service.registerFileChannel(principal.orgId(), request);
    }
}
