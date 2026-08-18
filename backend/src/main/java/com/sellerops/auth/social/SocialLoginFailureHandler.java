package com.sellerops.auth.social;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.stereotype.Component;

/** Provider denied / cancelled / state mismatch → the login page, told plainly; no provider text reaches the URL. */
@Component
public class SocialLoginFailureHandler implements AuthenticationFailureHandler {

    private static final Logger log = LoggerFactory.getLogger(SocialLoginFailureHandler.class);

    private final SocialLoginProperties props;

    public SocialLoginFailureHandler(SocialLoginProperties props) {
        this.props = props;
    }

    @Override
    public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response,
                                        AuthenticationException exception) throws IOException {
        log.info("social login failed: {}", exception.getClass().getSimpleName());
        response.sendRedirect(props.frontendUrl("/login?social=failed"));
    }
}
