package com.sellerops.auth.password;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.auth.social.AuthCodes;
import com.sellerops.common.ApiException;
import com.sellerops.mail.DevOutboxMailer;
import com.sellerops.mail.NoopMailer;
import com.sellerops.mail.OutboundMail;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.password.PasswordEncoder;

/** docs/service_readiness_v1.md §2-2 / §6 — the account-existence silence and the one-time link, against mocks. */
class PasswordResetServiceTest {

    private final Instant now = Instant.parse("2026-08-19T09:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    private final UserRepository users = mock(UserRepository.class);
    private final PasswordResetTokenRepository tokens = mock(PasswordResetTokenRepository.class);
    private final PasswordEncoder encoder = mock(PasswordEncoder.class);
    private final DevOutboxMailer outbox = new DevOutboxMailer();
    private final PasswordResetProperties props = new PasswordResetProperties(1800, "https://app.example.test/");
    private PasswordResetService service;

    @BeforeEach
    void setUp() {
        service = new PasswordResetService(users, tokens, encoder, outbox, props, clock,
                new PasswordResetThrottle(3, Duration.ofMinutes(15), clock));
        when(tokens.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private User passwordUser(String email) {
        User u = new User();
        u.setId(UUID.randomUUID());
        u.setEmail(email);
        u.setPasswordHash("$2a$hash");
        return u;
    }

    @Test
    void unknownEmailSendsNothingAndAnswersLikeEverythingElse() {
        when(users.findByEmailIgnoreCase("nobody@x.io")).thenReturn(Optional.empty());
        assertThat(service.requestReset("nobody@x.io")).isFalse();
        assertThat(outbox.outbox()).isEmpty();
        verify(tokens, never()).save(any());
    }

    @Test
    void socialOnlyAccountSendsNothing() {
        User social = passwordUser("s@x.io");
        social.setPasswordHash(null);
        when(users.findByEmailIgnoreCase("s@x.io")).thenReturn(Optional.of(social));
        assertThat(service.requestReset("S@x.io")).isFalse();
        assertThat(outbox.outbox()).isEmpty();
    }

    @Test
    void passwordAccountGetsAMailWhoseLinkTokenIsStoredOnlyAsAHashAndRetiresOlderLinks() {
        User u = passwordUser("owner@x.io");
        when(users.findByEmailIgnoreCase("owner@x.io")).thenReturn(Optional.of(u));

        assertThat(service.requestReset("  Owner@x.io ")).isTrue();

        verify(tokens).consumeAllLiveForUser(u.getId(), now);
        ArgumentCaptor<PasswordResetToken> saved = ArgumentCaptor.forClass(PasswordResetToken.class);
        verify(tokens).save(saved.capture());
        assertThat(outbox.outbox()).hasSize(1);
        OutboundMail mail = outbox.outbox().get(0);
        assertThat(mail.to()).isEqualTo("owner@x.io");
        assertThat(mail.subject()).isEqualTo(PasswordResetService.SUBJECT);
        Matcher m = Pattern.compile("https://app\\.example\\.test/reset-password\\?token=([A-Za-z0-9_-]+)").matcher(mail.text());
        assertThat(m.find()).isTrue();
        String token = m.group(1);
        assertThat(saved.getValue().getTokenHash()).isEqualTo(AuthCodes.hash(token)).isNotEqualTo(token);
        assertThat(saved.getValue().getExpiresAt()).isEqualTo(now.plusSeconds(1800));
        assertThat(saved.getValue().getUserId()).isEqualTo(u.getId());
        assertThat(mail.text()).contains("30분");
    }

    @Test
    void throttleStopsTheFourthMailInTheWindowSilently() {
        User u = passwordUser("owner@x.io");
        when(users.findByEmailIgnoreCase("owner@x.io")).thenReturn(Optional.of(u));
        assertThat(service.requestReset("owner@x.io")).isTrue();
        assertThat(service.requestReset("owner@x.io")).isTrue();
        assertThat(service.requestReset("owner@x.io")).isTrue();
        assertThat(service.requestReset("owner@x.io")).isFalse();
        assertThat(outbox.outbox()).hasSize(3);
    }

    @Test
    void aMailerFailureIsSwallowedAddressFreeAndTheAnswerDoesNotChange() {
        com.sellerops.mail.Mailer broken = new com.sellerops.mail.Mailer() {
            @Override public boolean deliverable() { return true; }
            @Override public void send(OutboundMail mail) { throw new org.springframework.mail.MailSendException("smtp down for " + mail.to()); }
        };
        PasswordResetService svc = new PasswordResetService(users, tokens, encoder, broken, props, clock,
                new PasswordResetThrottle(3, Duration.ofMinutes(15), clock));
        when(users.findByEmailIgnoreCase("owner@x.io")).thenReturn(Optional.of(passwordUser("owner@x.io")));
        assertThat(svc.requestReset("owner@x.io")).isFalse(); // no exception → the controller still answers 202
    }

    @Test
    void mailOffMeansDisabledAndNoTokenIsMinted() {
        PasswordResetService off = new PasswordResetService(users, tokens, encoder, new NoopMailer(), props, clock,
                new PasswordResetThrottle(3, Duration.ofMinutes(15), clock));
        when(users.findByEmailIgnoreCase(anyString())).thenReturn(Optional.of(passwordUser("owner@x.io")));
        assertThat(off.enabled()).isFalse();
        assertThat(off.requestReset("owner@x.io")).isFalse();
        verify(tokens, never()).save(any());
    }

    @Test
    void resetSpendsTheTokenOnceAndStoresABcryptHash() {
        User u = passwordUser("owner@x.io");
        PasswordResetToken row = new PasswordResetToken();
        row.setUserId(u.getId());
        row.setTokenHash(AuthCodes.hash("tok"));
        when(tokens.consume(AuthCodes.hash("tok"), now)).thenReturn(1, 0);
        when(tokens.findByTokenHash(AuthCodes.hash("tok"))).thenReturn(Optional.of(row));
        when(users.findById(u.getId())).thenReturn(Optional.of(u));
        when(encoder.encode("newpass1")).thenReturn("$2a$new");

        service.reset("tok", "newpass1");
        assertThat(u.getPasswordHash()).isEqualTo("$2a$new");
        verify(users).save(u);

        assertThatThrownBy(() -> service.reset("tok", "again123"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus().value()).isEqualTo(401));
    }

    @Test
    void unknownTokenIs401NeverA500() {
        when(tokens.consume(anyString(), eq(now))).thenReturn(0);
        assertThatThrownBy(() -> service.reset("nope", "newpass1")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.reset(null, "newpass1")).isInstanceOf(ApiException.class);
    }
}
