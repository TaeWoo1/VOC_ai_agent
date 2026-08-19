package com.sellerops.mail;

/**
 * The email sender abstraction (docs/service_readiness_v1.md §2-3). Exactly one implementation is wired per
 * deployment by {@link MailerConfiguration}: SMTP, the dev-only outbox, or off. Callers never know which.
 */
public interface Mailer {

    /** True when a mail sent here can actually reach a person (SMTP) or be read by the local operator (dev outbox). */
    boolean deliverable();

    /** True only for the dev outbox — the UI may then say where the mail went. */
    default boolean devOutbox() {
        return false;
    }

    void send(OutboundMail mail);
}
