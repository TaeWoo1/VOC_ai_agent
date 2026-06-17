package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorAlert;
import com.sellerops.connector.ConnectorAlertRepository;
import com.sellerops.connector.ConnectorCapability;
import com.sellerops.connector.ConnectorCapabilityRepository;
import com.sellerops.credential.ConnectorCredential;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.sync.SyncCursor;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Slice 1 schema/entity round-trips: confirms the new scheduled-collection
 * entities persist and that the additive sync_jobs columns apply their defaults
 * (trigger=UPLOAD, attempt=1, rate_limited=false) so the Phase 2 upload path is
 * unaffected. No business logic is exercised — there is none yet.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ScheduledCollectionSchemaTest {

    @Autowired SyncJobRepository syncJobs;
    @Autowired SyncCursorRepository cursors;
    @Autowired SyncScheduleRepository schedules;
    @Autowired ConnectorCapabilityRepository capabilities;
    @Autowired ChannelConnectionStatusRepository connectionStatus;
    @Autowired ConnectorAlertRepository alerts;
    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();

    @Test
    void syncJobAppliesUploadDefaultsForBackwardCompatibility() {
        SyncJob job = new SyncJob();
        job.setOrgId(org);
        job.setJobType("FILE_UPLOAD");
        job.setStatus("SUCCESS");
        UUID id = syncJobs.save(job).getId();
        syncJobs.flush();

        SyncJob reloaded = syncJobs.findById(id).orElseThrow();
        assertThat(reloaded.getTrigger()).isEqualTo("UPLOAD");
        assertThat(reloaded.getAttempt()).isEqualTo(1);
        assertThat(reloaded.isRateLimited()).isFalse();
        assertThat(reloaded.getSellerAccountId()).isNull();
        assertThat(reloaded.getDataType()).isNull();
    }

    @Test
    void syncCursorRoundTripsAndIsFoundByNaturalKey() {
        SyncCursor cursor = new SyncCursor();
        cursor.setOrgId(org);
        cursor.setSellerAccountId(account);
        cursor.setDataType("ORDER_SUMMARY");
        cursor.setCursorKey("last_order_at");
        cursor.setCursorValue("2026-06-01T00:00:00Z");
        cursors.save(cursor);
        cursors.flush();

        Optional<SyncCursor> found = cursors
                .findByOrgIdAndSellerAccountIdAndDataTypeAndCursorKey(org, account, "ORDER_SUMMARY", "last_order_at");
        assertThat(found).isPresent();
        assertThat(found.get().getCursorValue()).isEqualTo("2026-06-01T00:00:00Z");
    }

    @Test
    void backboneEntitiesPersist() {
        SyncSchedule schedule = new SyncSchedule();
        schedule.setOrgId(org);
        schedule.setSellerAccountId(account);
        schedule.setDataType("INQUIRY");
        schedule.setCadenceKind("INTERVAL");
        schedule.setIntervalMinutes(60);
        assertThat(schedules.save(schedule).getId()).isNotNull();
        assertThat(schedule.isEnabled()).isFalse();

        ConnectorCapability cap = new ConnectorCapability();
        cap.setChannelCode("COUPANG");
        cap.setConnectorClass("API");
        cap.setDataType("REVIEW");
        cap.setSupported(false);
        cap.setVerificationStatus("UNSUPPORTED");
        capabilities.save(cap);
        assertThat(capabilities.findByChannelCodeAndConnectorClassAndDataType("COUPANG", "API", "REVIEW"))
                .isPresent();

        ChannelConnectionStatus status = new ChannelConnectionStatus();
        status.setOrgId(org);
        status.setSellerAccountId(account);
        status.setState("CONNECTED");
        connectionStatus.save(status);
        assertThat(connectionStatus.findBySellerAccountId(account)).isPresent();

        ConnectorAlert alert = new ConnectorAlert();
        alert.setOrgId(org);
        alert.setSellerAccountId(account);
        alert.setSeverity("WARNING");
        alert.setType("REPEATED_FAILURE");
        alert.setMessage("3회 연속 수집 실패");
        alerts.save(alert);
        assertThat(alerts.findBySellerAccountIdOrderByCreatedAtDesc(account)).hasSize(1);

        ConnectorCredential cred = new ConnectorCredential();
        cred.setOrgId(org);
        cred.setSellerAccountId(account);
        cred.setConnectorClass("API");
        cred.setAuthType("HMAC");
        credentials.save(cred);
        Optional<ConnectorCredential> savedCred = credentials.findBySellerAccountId(account);
        assertThat(savedCred).isPresent();
        // Slice 1 stores no secret material; payload stays null until the vault slice.
        assertThat(savedCred.get().getEncryptedPayload()).isNull();
    }
}
