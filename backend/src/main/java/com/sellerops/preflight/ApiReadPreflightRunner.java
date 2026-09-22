package com.sellerops.preflight;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.function.BooleanSupplier;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;

/**
 * Runs {@link ApiReadPreflight} once at boot, and only when a READ approval id and an org id are both given.
 *
 * <p><b>After every setting was validated, never before</b> (2026-09-22). It was an {@code ApplicationRunner}, and
 * runners run before {@code ApplicationReadyEvent} — the event {@code PilotConfigValidator} refuses a misconfigured
 * process on. The first live preflight therefore made its marketplace reads in a process that refused to boot a
 * moment later. It is now the last ready listener, and it also asks the validator whether it passed: order is the
 * first guard, the explicit {@code settingsValidated} answer is the second, and either alone stops the read.
 *
 * <p><b>Fails closed on concurrency.</b> A preflight whose counts could be another collector's is not a preflight
 * (live approval contract §6b), so it refuses while the collect scheduler, the responsibility scheduler, the
 * self-pilot reconciler or the proactive tick is armed in this process.
 */
public class ApiReadPreflightRunner {

    private static final Logger log = LoggerFactory.getLogger(ApiReadPreflightRunner.class);
    private static final String TAG = "[api-read-preflight]";
    /** Same shape as the other live approval ids: a prefix and 8–32 hex. Never a credential. */
    static final Pattern APPROVAL_ID = Pattern.compile("apr-api-read-[0-9a-f]{8,32}");

    private final ApiReadPreflight preflight;
    private final String approvalId;
    private final String orgId;
    private final int days;
    private final int limit;
    private final String outputPath;
    private final boolean anySchedulerArmed;
    private final BooleanSupplier settingsValidated;
    private final ObjectMapper json;

    public ApiReadPreflightRunner(ApiReadPreflight preflight, String approvalId, String orgId, int days, int limit,
                                  String outputPath, boolean anySchedulerArmed, BooleanSupplier settingsValidated,
                                  ObjectMapper json) {
        this.preflight = preflight;
        this.approvalId = approvalId;
        this.orgId = orgId;
        this.days = days;
        this.limit = limit;
        this.outputPath = outputPath;
        this.anySchedulerArmed = anySchedulerArmed;
        this.settingsValidated = settingsValidated;
        this.json = json;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Order(Ordered.LOWEST_PRECEDENCE)
    public void onReady() throws Exception {
        run();
    }

    void run() throws Exception {
        if (settingsValidated == null || !settingsValidated.getAsBoolean()) {
            log.warn("{} REFUSED settings were not validated in this process — no marketplace call.", TAG);
            return;
        }
        if (approvalId == null || !APPROVAL_ID.matcher(approvalId.strip()).matches()) {
            log.warn("{} REFUSED approval id missing or malformed — no marketplace call.", TAG);
            return;
        }
        if (orgId == null || orgId.isBlank()) {
            log.warn("{} REFUSED org id missing — no marketplace call.", TAG);
            return;
        }
        if (anySchedulerArmed) {
            log.warn("{} REFUSED a scheduler is armed in this process — counts would not be attributable.", TAG);
            return;
        }
        if (days < 1 || days > 31 || limit < 1 || limit > 100) {
            log.warn("{} REFUSED window {}d / limit {} out of bounds.", TAG, days, limit);
            return;
        }
        log.info("{} start approval={} days={} limit={}", TAG, approvalId.strip(), days, limit);
        ApiReadPreflight.Report report = preflight.run(UUID.fromString(orgId.strip()), days, limit);
        for (ApiReadPreflight.Row r : report.rows()) {
            log.info("{} {} {} resolved={} supports={} window={} outcome={} records={} hasMore={} category={} type={} ms={}",
                    TAG, r.channelCode(), r.dataType(), r.connectorResolved(), r.codeSupports(), r.window(),
                    r.outcome(), r.records(), r.hasMore(), r.failureCategory(), r.failureType(), r.elapsedMs());
        }
        log.info("{} responsibility sources={}", TAG, report.responsibilitySources());
        if (outputPath != null && !outputPath.isBlank()) {
            Files.writeString(Path.of(outputPath.strip()), json.writerWithDefaultPrettyPrinter().writeValueAsString(report));
        }
        log.info("{} done", TAG);
    }
}
