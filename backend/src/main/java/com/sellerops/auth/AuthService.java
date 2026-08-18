package com.sellerops.auth;

import com.sellerops.auth.dto.AuthResponse;
import com.sellerops.auth.dto.LoginRequest;
import com.sellerops.auth.dto.SignupRequest;
import com.sellerops.common.ApiException;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import com.sellerops.user.UserView;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final OrganizationRepository organizations;
    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider tokenProvider;

    public AuthService(OrganizationRepository organizations,
                       UserRepository users,
                       PasswordEncoder passwordEncoder,
                       JwtTokenProvider tokenProvider) {
        this.organizations = organizations;
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.tokenProvider = tokenProvider;
    }

    @Transactional
    public AuthResponse signup(SignupRequest req) {
        // Case-insensitive: the social-login collision rule (docs/auth_growth_instrumentation_v1.md §2-2) and this
        // check must agree, or "Seller@X.io" + "seller@x.io" would be two accounts for one person.
        if (users.existsByEmailIgnoreCase(req.email())) {
            throw ApiException.conflict("이미 등록된 이메일입니다.");
        }
        Organization org = new Organization();
        org.setName(req.orgName());
        org = organizations.save(org);

        User user = new User();
        user.setOrgId(org.getId());
        user.setEmail(req.email());
        user.setPasswordHash(passwordEncoder.encode(req.password()));
        user.setName(req.name());
        user.setRole("OWNER");
        user = users.save(user);

        return toAuthResponse(user, org.getName());
    }

    @Transactional(readOnly = true)
    public AuthResponse login(LoginRequest req) {
        User user = users.findByEmail(req.email())
                .orElseThrow(() -> ApiException.unauthorized("이메일 또는 비밀번호가 올바르지 않습니다."));
        // A social-only user (Google/NAVER sign-up, no password) fails with the SAME sentence as a wrong
        // password: which sign-in method an email uses is not information for whoever typed it.
        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(req.password(), user.getPasswordHash())) {
            throw ApiException.unauthorized("이메일 또는 비밀번호가 올바르지 않습니다.");
        }
        String orgName = organizations.findById(user.getOrgId())
                .map(Organization::getName)
                .orElse("");
        return toAuthResponse(user, orgName);
    }

    @Transactional(readOnly = true)
    public UserView currentUser(AuthPrincipal principal) {
        User user = users.findById(principal.userId())
                .orElseThrow(() -> ApiException.unauthorized("세션이 만료되었습니다."));
        String orgName = organizations.findById(user.getOrgId())
                .map(Organization::getName)
                .orElse("");
        return toView(user, orgName);
    }

    private AuthResponse toAuthResponse(User user, String orgName) {
        String token = tokenProvider.createToken(user.getId(), user.getOrgId(), user.getEmail());
        return new AuthResponse(token, toView(user, orgName));
    }

    private UserView toView(User user, String orgName) {
        return new UserView(user.getId(), user.getEmail(), user.getName(),
                user.getRole(), user.getOrgId(), orgName);
    }
}
