package com.sellerops.mail;

/** One plain-text mail. Bodies may carry a one-time link; the mailer decides what happens to it (never a log in production). */
public record OutboundMail(String to, String subject, String text) {
}
