package com.sellerops.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mail.javamail.JavaMailSender;

/** docs/service_readiness_v1.md §2-3: the mode switch, and that `smtp` without a host is a refusal, not `off`. */
class MailerConfigurationTest {

    private final MailerConfiguration config = new MailerConfiguration();

    @SuppressWarnings("unchecked")
    private ObjectProvider<JavaMailSender> senders(JavaMailSender sender) {
        ObjectProvider<JavaMailSender> p = mock(ObjectProvider.class);
        org.mockito.Mockito.when(p.getIfAvailable()).thenReturn(sender);
        return p;
    }

    @Test
    void offAndBlankAreTheNoopMailer() {
        assertThat(config.mailer("off", "x@y", senders(null))).isInstanceOf(NoopMailer.class);
        assertThat(config.mailer("", "x@y", senders(null))).isInstanceOf(NoopMailer.class);
        assertThat(config.mailer("off", "x@y", senders(null)).deliverable()).isFalse();
    }

    @Test
    void devOutboxKeepsMailsAndIsDeliverable() {
        Mailer m = config.mailer("dev-outbox", "x@y", senders(null));
        assertThat(m).isInstanceOf(DevOutboxMailer.class);
        assertThat(m.deliverable()).isTrue();
        assertThat(m.devOutbox()).isTrue();
        m.send(new OutboundMail("a@b", "s", "body"));
        assertThat(((DevOutboxMailer) m).outbox()).hasSize(1);
    }

    @Test
    void smtpNeedsASenderAndUnknownModesRefuse() {
        assertThatThrownBy(() -> config.mailer("smtp", "x@y", senders(null))).isInstanceOf(IllegalStateException.class);
        assertThat(config.mailer("smtp", "x@y", senders(mock(JavaMailSender.class)))).isInstanceOf(SmtpMailer.class);
        assertThatThrownBy(() -> config.mailer("carrier-pigeon", "x@y", senders(null))).isInstanceOf(IllegalStateException.class);
    }
}
