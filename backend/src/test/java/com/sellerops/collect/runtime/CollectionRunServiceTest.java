package com.sellerops.collect.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.DataType;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class CollectionRunServiceTest {

    private SyncJobRepository syncJobs;
    private ChannelConnectionStatusRepository connectionStatus;
    private SellerAccountRepository sellerAccounts;
    private CollectionRunService service;

    private final UUID orgId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        syncJobs = mock(SyncJobRepository.class);
        connectionStatus = mock(ChannelConnectionStatusRepository.class);
        sellerAccounts = mock(SellerAccountRepository.class);
        when(syncJobs.save(any(SyncJob.class))).thenAnswer(inv -> inv.getArgument(0));
        when(connectionStatus.save(any(ChannelConnectionStatus.class))).thenAnswer(inv -> inv.getArgument(0));
        service = new CollectionRunService(syncJobs, connectionStatus, sellerAccounts);
    }

    private CollectionDescriptor descriptor(CollectionMethod method, String trigger) {
        return new CollectionDescriptor(orgId, accountId, channelId, "NAVER", DataType.REVIEW, method, trigger);
    }

    private ChannelConnectionStatus existingHealth(String state, int failures) {
        ChannelConnectionStatus c = new ChannelConnectionStatus();
        c.setOrgId(orgId);
        c.setSellerAccountId(accountId);
        c.setState(state);
        c.setConsecutiveFailures(failures);
        return c;
    }

    @Test
    void openCreatesRunningJobStampedWithMethod() {
        SyncJob job = service.open(descriptor(CollectionMethod.MANUAL_UPLOAD, "MANUAL"));
        assertThat(job.getStatus()).isEqualTo("RUNNING");
        assertThat(job.getMethod()).isEqualTo("MANUAL_UPLOAD");
        assertThat(job.getJobType()).isEqualTo("MANUAL_UPLOAD");
        assertThat(job.getDataType()).isEqualTo("REVIEW");
        assertThat(job.getOrgId()).isEqualTo(orgId);
        assertThat(job.getSellerAccountId()).isEqualTo(accountId);
        assertThat(job.getChannelId()).isEqualTo(channelId);
        assertThat(job.getTrigger()).isEqualTo("MANUAL");
        assertThat(job.getStartedAt()).isNotNull();
    }

    @Test
    void finalizeSuccessMarksConnectedAndResetsFailures() {
        SyncJob job = service.open(descriptor(CollectionMethod.API, "SCHEDULED"));
        ChannelConnectionStatus health = existingHealth("DEGRADED", 3);
        when(connectionStatus.findBySellerAccountId(accountId)).thenReturn(Optional.of(health));
        SellerAccount account = new SellerAccount();
        when(sellerAccounts.findById(accountId)).thenReturn(Optional.of(account));

        ConnectorResult r = ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.API,
                10, 2, 0, false, false, null);
        SyncJob done = service.finalizeRun(job, r);

        assertThat(done.getStatus()).isEqualTo("SUCCESS");
        assertThat(done.getTotalRows()).isEqualTo(12);
        assertThat(done.getSuccessRows()).isEqualTo(10);
        assertThat(done.getSkippedRows()).isEqualTo(2);
        assertThat(done.getFinishedAt()).isNotNull();

        ArgumentCaptor<ChannelConnectionStatus> cap = ArgumentCaptor.forClass(ChannelConnectionStatus.class);
        verify(connectionStatus).save(cap.capture());
        assertThat(cap.getValue().getState()).isEqualTo("CONNECTED");
        assertThat(cap.getValue().getConsecutiveFailures()).isZero();
        assertThat(cap.getValue().getLastSuccessAt()).isNotNull();
        assertThat(cap.getValue().getLastError()).isNull();
        verify(sellerAccounts).save(any(SellerAccount.class));
        assertThat(account.getLastSyncedAt()).isNotNull();
    }

    @Test
    void finalizeFailureIncrementsConsecutiveFailuresAndRecordsCode() {
        SyncJob job = service.open(descriptor(CollectionMethod.API, "SCHEDULED"));
        ChannelConnectionStatus health = existingHealth("CONNECTED", 1);
        when(connectionStatus.findBySellerAccountId(accountId)).thenReturn(Optional.of(health));

        ConnectorResult r = ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.API,
                0, 0, 3, false, true, "PROVIDER_UNAVAILABLE");
        SyncJob done = service.finalizeRun(job, r);

        assertThat(done.getStatus()).isEqualTo("FAILED");
        assertThat(done.getErrorMessage()).isEqualTo("PROVIDER_UNAVAILABLE");
        assertThat(health.getConsecutiveFailures()).isEqualTo(2);
        assertThat(health.getLastError()).isEqualTo("PROVIDER_UNAVAILABLE");
        verify(sellerAccounts, never()).save(any());
    }

    @Test
    void finalizeRateLimitedWithNoDataRecordsReasonWithoutEscalating() {
        SyncJob job = service.open(descriptor(CollectionMethod.API, "SCHEDULED"));
        ChannelConnectionStatus health = existingHealth("CONNECTED", 0);
        when(connectionStatus.findBySellerAccountId(accountId)).thenReturn(Optional.of(health));

        ConnectorResult r = ConnectorResult.of("NAVER", DataType.ORDER_SUMMARY, CollectionMethod.API,
                0, 0, 0, true, false, null);
        SyncJob done = service.finalizeRun(job, r);

        assertThat(done.getStatus()).isEqualTo("FAILED");          // no data landed
        assertThat(done.getStatus()).isNotEqualTo("RATE_LIMITED"); // never a status value
        assertThat(done.isRateLimited()).isTrue();
        assertThat(done.getErrorMessage()).isEqualTo("RATE_LIMITED");
        assertThat(health.getConsecutiveFailures()).isZero();      // rate limit must NOT escalate
        assertThat(health.getLastError()).isEqualTo("RATE_LIMITED");
        verify(sellerAccounts, never()).save(any());
    }

    @Test
    void finalizeRateLimitedWithDataCountsAsCollected() {
        SyncJob job = service.open(descriptor(CollectionMethod.API, "SCHEDULED"));
        ChannelConnectionStatus health = existingHealth("DEGRADED", 2);
        when(connectionStatus.findBySellerAccountId(accountId)).thenReturn(Optional.of(health));
        when(sellerAccounts.findById(accountId)).thenReturn(Optional.of(new SellerAccount()));

        ConnectorResult r = ConnectorResult.of("NAVER", DataType.ORDER_SUMMARY, CollectionMethod.API,
                8, 0, 0, true, false, null);
        SyncJob done = service.finalizeRun(job, r);

        assertThat(done.getStatus()).isEqualTo("PARTIAL");         // data landed under throttle
        assertThat(done.isRateLimited()).isTrue();
        assertThat(health.getState()).isEqualTo("CONNECTED");
        assertThat(health.getConsecutiveFailures()).isZero();
    }

    @Test
    void finalizeCreatesHealthRowWhenNoneExists() {
        SyncJob job = service.open(descriptor(CollectionMethod.API, "SCHEDULED"));
        when(connectionStatus.findBySellerAccountId(accountId)).thenReturn(Optional.empty());
        when(sellerAccounts.findById(accountId)).thenReturn(Optional.of(new SellerAccount()));

        ConnectorResult r = ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.API,
                4, 0, 0, false, false, null);
        service.finalizeRun(job, r);

        ArgumentCaptor<ChannelConnectionStatus> cap = ArgumentCaptor.forClass(ChannelConnectionStatus.class);
        verify(connectionStatus).save(cap.capture());
        assertThat(cap.getValue().getOrgId()).isEqualTo(orgId);
        assertThat(cap.getValue().getSellerAccountId()).isEqualTo(accountId);
        assertThat(cap.getValue().getState()).isEqualTo("CONNECTED");
    }

    @Test
    void finalizeSkipsHealthWhenNoSellerAccount() {
        CollectionDescriptor d = new CollectionDescriptor(orgId, null, channelId, "NAVER",
                DataType.REVIEW, CollectionMethod.MANUAL_UPLOAD, "UPLOAD");
        SyncJob job = service.open(d);

        ConnectorResult r = ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.MANUAL_UPLOAD,
                5, 0, 0, false, false, null);
        service.finalizeRun(job, r);

        verify(connectionStatus, never()).findBySellerAccountId(any());
        verify(connectionStatus, never()).save(any());
    }

    @Test
    void openHonorsExplicitJobTypeAndUploadType() {
        // Manual-upload style: keep the legacy connector kind + sub-type, add the method dimension.
        CollectionDescriptor d = new CollectionDescriptor(orgId, null, channelId, "NAVER",
                null, CollectionMethod.MANUAL_UPLOAD, "UPLOAD", "FILE_UPLOAD", "REVIEW");
        SyncJob job = service.open(d);

        assertThat(job.getJobType()).isEqualTo("FILE_UPLOAD");      // connector kind preserved
        assertThat(job.getMethod()).isEqualTo("MANUAL_UPLOAD");     // new orthogonal dimension
        assertThat(job.getUploadType()).isEqualTo("REVIEW");
        assertThat(job.getDataType()).isNull();
        assertThat(job.getSellerAccountId()).isNull();
        assertThat(job.getTrigger()).isEqualTo("UPLOAD");
    }

    @Test
    void finalizeWithExplicitMessageStoresRawMessageWithoutLeakingToHealth() {
        CollectionDescriptor d = new CollectionDescriptor(orgId, null, channelId, "NAVER",
                null, CollectionMethod.MANUAL_UPLOAD, "UPLOAD", "FILE_UPLOAD", "REVIEW");
        SyncJob job = service.open(d);

        ConnectorResult r = ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.MANUAL_UPLOAD,
                2, 0, 1, false, false, null);
        SyncJob done = service.finalizeRun(job, r, "셀 형식 오류");

        assertThat(done.getStatus()).isEqualTo("PARTIAL");
        assertThat(done.getErrorMessage()).isEqualTo("셀 형식 오류");  // explicit raw message, not a bounded code
        // No seller account → the raw message never reaches connection health.
        verify(connectionStatus, never()).findBySellerAccountId(any());
        verify(connectionStatus, never()).save(any());
    }
}
