package com.sellerops.user;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.auth.AuthService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final AuthService authService;

    public UserController(AuthService authService) {
        this.authService = authService;
    }

    @GetMapping("/me")
    public UserView me(@AuthenticationPrincipal AuthPrincipal principal) {
        return authService.currentUser(principal);
    }
}
