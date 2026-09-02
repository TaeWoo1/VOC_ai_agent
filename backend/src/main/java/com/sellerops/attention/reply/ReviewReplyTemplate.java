package com.sellerops.attention.reply;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One organization's wording for one review reply category (V89).
 *
 * <p><b>A row is an override, and only an override.</b> No row is written on signup, none is
 * backfilled, and restoring the default deletes the row rather than storing the shipped text — so a
 * company that never opened the settings screen keeps following {@link ReviewReplyTemplateKey}
 * forever, including through a future change to the shipped wording.
 */
@Getter
@Setter
@Entity
@Table(name = "review_reply_template",
        uniqueConstraints = @UniqueConstraint(name = "uq_review_reply_template_org_key",
                columnNames = {"org_id", "template_key"}))
public class ReviewReplyTemplate extends BaseEntity {

    @Column(name = "org_id", nullable = false, updatable = false)
    private UUID orgId;

    /** {@link ReviewReplyTemplateKey#category()} — validated against the enum before it is stored. */
    @Column(name = "template_key", nullable = false, updatable = false)
    private String templateKey;

    @Column(nullable = false)
    private String body;

    @Column(name = "updated_by")
    private UUID updatedBy;
}
