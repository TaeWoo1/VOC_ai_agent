package com.sellerops.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;

/**
 * Picks the one {@link Mailer} for this deployment from `SELLEROPS_MAIL_MODE` (docs/service_readiness_v1.md §2-3):
 * `smtp` needs `spring.mail.host` (Spring's JavaMailSender) and refuses to boot without it — a misconfigured
 * production must not silently become "off"; `dev-outbox` logs mails; `off` (default) drops them.
 */
@Configuration
public class MailerConfiguration {

    private static final Logger log = LoggerFactory.getLogger(MailerConfiguration.class);

    @Bean
    public Mailer mailer(@Value("${sellerops.mail.mode:off}") String mode,
                         @Value("${sellerops.mail.from:no-reply@localhost}") String from,
                         ObjectProvider<JavaMailSender> senders) {
        String normalized = mode == null ? "off" : mode.trim().toLowerCase();
        switch (normalized) {
            case "smtp" -> {
                JavaMailSender sender = senders.getIfAvailable();
                if (sender == null) {
                    throw new IllegalStateException(
                            "SELLEROPS_MAIL_MODE=smtp but no JavaMailSender: set SPRING_MAIL_HOST (spring.mail.host)");
                }
                log.info("mailer: smtp (from={})", from);
                return new SmtpMailer(sender, from);
            }
            case "dev-outbox" -> {
                log.warn("mailer: DEV OUTBOX — mails (including one-time links) are written to this log. Never in production.");
                return new DevOutboxMailer();
            }
            case "off", "" -> {
                log.info("mailer: off — password reset link hidden");
                return new NoopMailer();
            }
            default -> throw new IllegalStateException("unknown SELLEROPS_MAIL_MODE '" + mode + "' (smtp | dev-outbox | off)");
        }
    }
}
