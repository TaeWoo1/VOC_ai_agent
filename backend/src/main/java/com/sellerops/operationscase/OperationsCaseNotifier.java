package com.sellerops.operationscase;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.mail.Mailer;
import com.sellerops.mail.OutboundMail;
import com.sellerops.responsibility.Responsibility;
import com.sellerops.responsibility.ResponsibilityRepository;
import com.sellerops.responsibility.ResponsibilityRollout;
import com.sellerops.responsibility.ResponsibilityRun;
import com.sellerops.responsibility.ResponsibilityRunRepository;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * <b>At most one mail per run end, and only when something new needs the seller.</b>
 *
 * <p>Something new means: an open NEEDS_DECISION customer case, or an open gap the seller has to fix, that no earlier
 * summary included. Each case is mailed at most once ({@code notified_at}); a gap that fails again in the next run is
 * the same case and sends nothing. The run records what happened to its summary — NONE_NEEDED, SENT, UNDELIVERABLE
 * (no mailer, or nobody to send to; the cases stay un-notified and ride the next summary) or FAILED — and a run that
 * already recorded one is never summarised twice.
 *
 * <p>The existing {@link Mailer} is the only channel: SMTP in a deployment that configured it, the dev outbox
 * locally, dropped when mail is off. No new provider, no per-case mail.
 */
@Component
public class OperationsCaseNotifier {

    private static final Logger log = LoggerFactory.getLogger(OperationsCaseNotifier.class);

    public enum Outcome { NONE_NEEDED, SENT, UNDELIVERABLE, FAILED, ALREADY_DECIDED, NOT_APPLICABLE }

    private final ResponsibilityRunRepository runs;
    private final ResponsibilityRepository responsibilities;
    private final ResponsibilityRollout rollout;
    private final OperationsCaseRepository cases;
    private final OperationsCaseEventRepository events;
    private final ChannelRepository channels;
    private final UserRepository users;
    private final Mailer mailer;
    private final String publicBaseUrl;
    private final Clock clock;

    @Autowired
    public OperationsCaseNotifier(ResponsibilityRunRepository runs, ResponsibilityRepository responsibilities,
                                  ResponsibilityRollout rollout, OperationsCaseRepository cases,
                                  OperationsCaseEventRepository events, ChannelRepository channels,
                                  UserRepository users, Mailer mailer,
                                  @Value("${sellerops.public-base-url:http://localhost:5173}") String publicBaseUrl) {
        this(runs, responsibilities, rollout, cases, events, channels, users, mailer, publicBaseUrl,
                Clock.systemUTC());
    }

    public OperationsCaseNotifier(ResponsibilityRunRepository runs, ResponsibilityRepository responsibilities,
                                  ResponsibilityRollout rollout, OperationsCaseRepository cases,
                                  OperationsCaseEventRepository events, ChannelRepository channels,
                                  UserRepository users, Mailer mailer, String publicBaseUrl, Clock clock) {
        this.runs = runs;
        this.responsibilities = responsibilities;
        this.rollout = rollout;
        this.cases = cases;
        this.events = events;
        this.channels = channels;
        this.users = users;
        this.mailer = mailer;
        this.publicBaseUrl = publicBaseUrl;
        this.clock = clock;
    }

    public Outcome afterFinish(UUID runId) {
        ResponsibilityRun run = runs.findById(runId).orElse(null);
        if (run == null || !rollout.allows(run.getOrgId())) {
            return Outcome.NOT_APPLICABLE;
        }
        if (run.getNotificationState() != null) {
            return Outcome.ALREADY_DECIDED;
        }
        Responsibility responsibility = responsibilities.findById(run.getResponsibilityId()).orElse(null);
        if (responsibility == null) {
            return Outcome.NOT_APPLICABLE;
        }
        List<OperationsCase> pending = cases.findByOrgIdAndResponsibilityIdAndStatusAndNotifiedAtIsNull(
                run.getOrgId(), responsibility.getId(), OperationsCaseStatus.PREPARED);
        List<OperationsCase> decisions = pending.stream()
                .filter(c -> c.getCaseKind() == OperationsCaseKind.CUSTOMER_WORK
                        && c.getDisposition() == CaseDisposition.NEEDS_DECISION)
                .toList();
        List<OperationsCase> gaps = pending.stream()
                .filter(c -> c.getCaseKind() == OperationsCaseKind.OBSERVATION_GAP)
                .toList();
        if (decisions.isEmpty() && gaps.isEmpty()) {
            return record(run, Outcome.NONE_NEEDED, "NONE_NEEDED");
        }
        String recipient = responsibility.getActivatedBy() == null ? null
                : users.findById(responsibility.getActivatedBy())
                        .filter(u -> run.getOrgId().equals(u.getOrgId()))
                        .map(User::getEmail).orElse(null);
        if (recipient == null || recipient.isBlank() || !mailer.deliverable()) {
            log.info("responsibility: 예외 요약을 보낼 수 없습니다 run={} 결정={} 장애={} 사유={}", runId,
                    decisions.size(), gaps.size(), recipient == null ? "NO_RECIPIENT" : "MAIL_NOT_DELIVERABLE");
            return record(run, Outcome.UNDELIVERABLE, "UNDELIVERABLE");
        }
        Map<UUID, String> channelNames = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Channel::getNameKo, (a, b) -> a));
        List<ExceptionSummaryMail.GapLine> gapLines = new ArrayList<>();
        for (OperationsCase gap : gaps.stream().sorted(Comparator.comparing(OperationsCase::getCreatedAt)).toList()) {
            gapLines.add(new ExceptionSummaryMail.GapLine(
                    gap.getChannelId() == null ? null : channelNames.get(gap.getChannelId()),
                    gap.getSourceState().contains("family=AUTH") ? "AUTH" : "CONNECTION",
                    dataTypesOf(gap.getSourceState())));
        }
        OutboundMail mail = ExceptionSummaryMail.compose(recipient, decisions.size(), gapLines,
                publicBaseUrl + "/customer-operations");
        // Recorded before sending: a crash after the send must not mail the same run end twice.
        record(run, Outcome.SENT, "SENT");
        try {
            mailer.send(mail);
        } catch (RuntimeException e) {
            log.warn("responsibility: 예외 요약 발송 실패 run={} 사유={}", runId, e.getClass().getSimpleName());
            ResponsibilityRun reread = runs.findById(runId).orElse(run);
            reread.setNotificationState("FAILED");
            runs.save(reread);
            return Outcome.FAILED;
        }
        Instant now = clock.instant();
        List<OperationsCase> included = new ArrayList<>(decisions);
        included.addAll(gaps);
        for (OperationsCase c : included) {
            c.setNotifiedAt(now);
            OperationsCase saved = cases.save(c);
            events.save(OperationsCaseEvent.of(saved, runId, CaseEventActor.SYSTEM, CaseEventKind.NOTIFIED,
                    "{\"channel\":\"EMAIL\",\"decisions\":" + decisions.size() + ",\"gaps\":" + gaps.size() + "}"));
        }
        log.info("responsibility: 예외 요약 1통 발송 run={} 결정={} 장애={}", runId, decisions.size(), gaps.size());
        return Outcome.SENT;
    }

    private Outcome record(ResponsibilityRun run, Outcome outcome, String state) {
        run.setNotificationState(state);
        if (outcome == Outcome.SENT) {
            run.setNotifiedAt(clock.instant());
        }
        runs.save(run);
        return outcome;
    }

    private static List<String> dataTypesOf(String sourceState) {
        int at = sourceState.indexOf("types=");
        if (at < 0) {
            return List.of();
        }
        return Arrays.stream(sourceState.substring(at + "types=".length()).split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
