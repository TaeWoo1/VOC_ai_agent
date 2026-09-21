package com.sellerops.inquiry.goal;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * <b>What the interpreter read one customer message as</b> — stored once per (inquiry, message, contract).
 *
 * <p>The row is the reuse: a second path asking the same question of the same sentence under the same prompt reads
 * this instead of a vendor. See {@code V115__inquiry_goal_interpretation.sql} for why a refusal is kept and a
 * transport failure is not.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_goal_interpretation")
public class InquiryGoalInterpretation extends BaseEntity {

    /** A reading either produced a set, or produced a reason it could not. */
    public enum Outcome { INTERPRETED, REFUSED }

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "inquiry_id", nullable = false)
    private UUID inquiryId;

    /** sha256 of the normalized message actually read — the reuse key and the invalidation. */
    @Column(name = "source_fingerprint", nullable = false, length = 64)
    private String sourceFingerprint;

    @Column(name = "prompt_version", nullable = false, length = 64)
    private String promptVersion;

    @Column(name = "model_version", length = 120)
    private String modelVersion;

    @jakarta.persistence.Enumerated(jakarta.persistence.EnumType.STRING)
    @Column(name = "outcome", nullable = false, length = 16, columnDefinition = "varchar(16)")
    private Outcome outcome;

    /** {"goals": [...], "relations": [...]} exactly as the contract admitted it. Null when REFUSED. */
    @Column(name = "goal_set", columnDefinition = "text")
    private String goalSet;

    /** A closed {@link CustomerGoalResponseParser} token. Null when INTERPRETED. */
    @Column(name = "failure", length = 32)
    private String failure;
}
