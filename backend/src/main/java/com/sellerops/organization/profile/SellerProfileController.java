package com.sellerops.organization.profile;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.organization.profile.dto.SellerProfileRequest;
import com.sellerops.organization.profile.dto.SellerProfileView;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 회사 정보 — read and save this company's own description.
 *
 * <p>Two routes and no org parameter: the org comes from the JWT, so one company's profile is not
 * addressable by another. The Agent runtime reads the same GET with the seller's forwarded bearer.
 */
@RestController
@RequestMapping("/api/seller-profile")
public class SellerProfileController {

    private final SellerProfileService profiles;

    public SellerProfileController(SellerProfileService profiles) {
        this.profiles = profiles;
    }

    @GetMapping
    public SellerProfileView get(@AuthenticationPrincipal AuthPrincipal principal) {
        return profiles.view(principal.orgId());
    }

    @PutMapping
    public SellerProfileView save(@AuthenticationPrincipal AuthPrincipal principal,
                                  @RequestBody SellerProfileRequest request) {
        return profiles.save(principal.orgId(), request, principal.userId());
    }
}
