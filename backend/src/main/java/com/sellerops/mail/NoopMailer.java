package com.sellerops.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** `SELLEROPS_MAIL_MODE=off` (the default): mail is dropped; the WARN names no address and no content. */
public final class NoopMailer implements Mailer {

    private static final Logger log = LoggerFactory.getLogger(NoopMailer.class);

    @Override
    public boolean deliverable() {
        return false;
    }

    @Override
    public void send(OutboundMail mail) {
        log.warn("mail dropped: SELLEROPS_MAIL_MODE=off (subject '{}')", mail.subject());
    }
}
