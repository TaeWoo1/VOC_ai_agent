package com.sellerops.sync;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * Resumable collection position per (seller account x data type x cursor key).
 * Stores e.g. a last-seen timestamp or page token as an opaque string, so both
 * date-range and page-token style APIs fit the same model.
 *
 * The underlying {@code sync_cursors} table carries a legacy V1 {@code channel_id}
 * column (now nullable, unused) kept only for additive migration — this entity
 * intentionally does not map it.
 */
@Getter
@Setter
@Entity
@Table(name = "sync_cursors", uniqueConstraints = @UniqueConstraint(
        name = "uq_sync_cursors_natural",
        columnNames = {"org_id", "seller_account_id", "data_type", "cursor_key"}))
public class SyncCursor extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "data_type", nullable = false)
    private String dataType;

    @Column(name = "cursor_key", nullable = false)
    private String cursorKey;

    @Column(name = "cursor_value", columnDefinition = "text")
    private String cursorValue;
}
