package com.sellerops.auth.password;

import com.sellerops.auth.social.AuthCodes;
import com.sellerops.common.ApiException;
import com.sellerops.mail.Mailer;
import com.sellerops.mail.OutboundMail;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Password reset by mailed one-time link — docs/service_readiness_v1.md §2-2, §6.
 *
 * <ul>
 *   <li>{@link #requestReset} never reveals whether the email exists or how the account signs in: unknown email,
 *       social-only account, throttled address and a real send all return normally. Only a password account
 *       gets a mail. Older live links of the same user are retired first.</li>
 *   <li>The browser / mail carry the random token; the row keeps its SHA-256; {@link #reset} spends it
 *       atomically — a second use is 401.</li>
 *   <li>The reset URL is handed to the {@link Mailer} and never logged here.</li>
 * </ul>
 */
@Service
public class PasswordResetService {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);
    static final String SUBJECT = "[SellerOps] 비밀번호 재설정 안내";

    private final UserRepository users;
    private final PasswordResetTokenRepository tokens;
    private final PasswordEncoder passwordEncoder;
    private final Mailer mailer;
    private final PasswordResetProperties props;
    private final PasswordResetThrottle throttle;
    private final Clock clock;

    @Autowired
    public PasswordResetService(UserRepository users,
                                PasswordResetTokenRepository tokens,
                                PasswordEncoder passwordEncoder,
                                Mailer mailer,
                                PasswordResetProperties props) {
        this(users, tokens, passwordEncoder, mailer, props, Clock.systemUTC(),
                new PasswordResetThrottle(3, Duration.ofMinutes(15), Clock.systemUTC()));
    }

    PasswordResetService(UserRepository users,
                         PasswordResetTokenRepository tokens,
                         PasswordEncoder passwordEncoder,
                         Mailer mailer,
                         PasswordResetProperties props,
                         Clock clock,
                         PasswordResetThrottle throttle) {
        this.users = users;
        this.tokens = tokens;
        this.passwordEncoder = passwordEncoder;
        this.mailer = mailer;
        this.props = props;
        this.clock = clock;
        this.throttle = throttle;
    }

    /** True when a mailed link can reach someone here (SMTP or the dev outbox); false = the UI hides the entry. */
    public boolean enabled() {
        return mailer.deliverable();
    }

    public boolean devOutbox() {
        return mailer.devOutbox();
    }

    /**
     * Same outcome for the caller in every case. Returns whether a mail was actually handed to the mailer — for
     * tests and the dev outbox only; the controller never surfaces it.
     */
    @Transactional
    public boolean requestReset(String rawEmail) {
        String email = rawEmail == null ? "" : rawEmail.trim().toLowerCase(Locale.ROOT);
        if (email.isEmpty()) {
            return false;
        }
        if (!mailer.deliverable()) {
            log.warn("password reset requested but mail is off (SELLEROPS_MAIL_MODE=off): dropped");
            return false;
        }
        Optional<User> found = users.findByEmailIgnoreCase(email);
        if (found.isEmpty() || found.get().getPasswordHash() == null) {
            // Unknown, or a social-only account: nothing to reset — and nothing to say about it.
            return false;
        }
        if (!throttle.allow(email)) {
            return false;
        }
        User user = found.get();
        Instant now = clock.instant();
        tokens.consumeAllLiveForUser(user.getId(), now);
        String token = AuthCodes.newCode();
        PasswordResetToken row = new PasswordResetToken();
        row.setUserId(user.getId());
        row.setTokenHash(AuthCodes.hash(token));
        row.setExpiresAt(now.plus(props.ttl()));
        tokens.save(row);

        String link = props.publicUrl("/reset-password?token=" + URLEncoder.encode(token, StandardCharsets.UTF_8));
        try {
            mailer.send(new OutboundMail(user.getEmail(), SUBJECT, body(link, props.ttl())));
        } catch (RuntimeException mailFailure) {
            // A mail outage must not become an oracle (500 only for real accounts) nor carry the address into a
            // log or Sentry: same outcome for the caller, an address-free WARN for the operator. The unsent
            // token simply expires.
            log.warn("password reset mail could not be sent ({}); the request was accepted anyway",
                    mailFailure.getClass().getSimpleName());
            return false;
        }
        return true;
    }

    /** Spend the token and set the new password. 401 for an unknown / expired / already-used token. */
    @Transactional
    public void reset(String token, String newPassword) {
        Instant now = clock.instant();
        String hash = AuthCodes.hash(token == null ? "" : token);
        if (tokens.consume(hash, now) != 1) {
            throw ApiException.unauthorized("링크가 만료되었거나 이미 사용되었습니다.");
        }
        PasswordResetToken row = tokens.findByTokenHash(hash)
                .orElseThrow(() -> ApiException.unauthorized("링크가 만료되었거나 이미 사용되었습니다."));
        User user = users.findById(row.getUserId())
                .orElseThrow(() -> ApiException.unauthorized("링크가 만료되었거나 이미 사용되었습니다."));
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        users.save(user);
    }

    @Transactional
    public int purgeExpired() {
        return tokens.deleteExpiredBefore(clock.instant());
    }

    static String body(String link, Duration ttl) {
        long minutes = Math.max(1, ttl.toMinutes());
        return "SellerOps 비밀번호 재설정을 요청하셨습니다.\n\n"
                + "아래 링크를 열어 새 비밀번호를 설정해 주세요. 링크는 " + minutes + "분 동안 한 번만 사용할 수 있습니다.\n\n"
                + link + "\n\n"
                + "직접 요청하지 않으셨다면 이 메일은 무시하셔도 됩니다. 비밀번호는 바뀌지 않습니다.\n";
    }
}
