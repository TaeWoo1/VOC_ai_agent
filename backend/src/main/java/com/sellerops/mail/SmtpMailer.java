package com.sellerops.mail;

import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

/** `SELLEROPS_MAIL_MODE=smtp` — Spring's JavaMail sender configured by `spring.mail.*`. Logs nothing. */
public final class SmtpMailer implements Mailer {

    private final JavaMailSender sender;
    private final String from;

    public SmtpMailer(JavaMailSender sender, String from) {
        this.sender = sender;
        this.from = from;
    }

    @Override
    public boolean deliverable() {
        return true;
    }

    @Override
    public void send(OutboundMail mail) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(mail.to());
        message.setSubject(mail.subject());
        message.setText(mail.text());
        sender.send(message);
    }
}
