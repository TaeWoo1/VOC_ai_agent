package com.sellerops.sync;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/** Record of one ingestion run (file upload now; API pulls later). */
@Getter
@Setter
@Entity
@Table(name = "sync_jobs")
public class SyncJob extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "channel_id")
    private UUID channelId;

    /** Connector kind, e.g. FILE_UPLOAD. */
    @Column(name = "job_type", nullable = false)
    private String jobType;

    @Column(name = "upload_type")
    private String uploadType;

    /** RUNNING / SUCCESS / PARTIAL / FAILED. */
    @Column(nullable = false)
    private String status;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "total_rows", nullable = false)
    private int totalRows;

    @Column(name = "success_rows", nullable = false)
    private int successRows;

    @Column(name = "skipped_rows", nullable = false)
    private int skippedRows;

    @Column(name = "failed_rows", nullable = false)
    private int failedRows;

    @Column(name = "error_message", columnDefinition = "text")
    private String errorMessage;
}
