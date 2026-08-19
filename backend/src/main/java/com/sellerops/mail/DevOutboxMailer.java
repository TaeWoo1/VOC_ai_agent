package com.sellerops.mail;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * `SELLEROPS_MAIL_MODE=dev-outbox` — the local / self-pilot path when no SMTP exists: the mail is kept in a
 * bounded in-memory outbox and written in full (including a reset link) to the backend log under a
 * `[DEV MAIL OUTBOX]` prefix, so the local seller copies the link from the terminal. This is the ONLY mailer
 * that ever logs a body; it is a separate mode that production never sets (docs/service_readiness_v1.md §2-3).
 */
public final class DevOutboxMailer implements Mailer {

    private static final Logger log = LoggerFactory.getLogger(DevOutboxMailer.class);
    private static final int CAPACITY = 20;

    private final Deque<OutboundMail> outbox = new ArrayDeque<>();

    @Override
    public boolean deliverable() {
        return true;
    }

    @Override
    public boolean devOutbox() {
        return true;
    }

    @Override
    public synchronized void send(OutboundMail mail) {
        if (outbox.size() >= CAPACITY) {
            outbox.removeFirst();
        }
        outbox.addLast(mail);
        log.info("[DEV MAIL OUTBOX] to={} subject={}\n{}", mail.to(), mail.subject(), mail.text());
    }

    /** Newest last. Test / local inspection only. */
    public synchronized List<OutboundMail> outbox() {
        return List.copyOf(outbox);
    }
}
