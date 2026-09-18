package com.sellerops.review.media;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One photo or video attached to a review, as the channel observation read it — a <b>reference</b>, never the bytes.
 *
 * <p>Two facts live on one row and must never be confused: that the attachment was <i>observed</i> (its address came
 * off the channel) and that it was <i>inspected</i> (a vision model looked at the fetched image). Everything under
 * «inspection» is null until {@link InspectionStatus#INSPECTED}; a database check enforces it.
 */
@Getter
@Setter
@Entity
@Table(name = "review_media")
public class ReviewMedia extends BaseEntity {

    public enum Kind { IMAGE, VIDEO, UNKNOWN }

    public enum InspectionStatus {
        /** Observed only. Nothing has looked at it. */
        NOT_INSPECTED,
        /** A vision model looked at the fetched bytes; {@link #depicts} is what it reported. */
        INSPECTED,
        /** The fetch was refused or failed under the image fetch policy. */
        FETCH_FAILED,
        /** Fetched, but the model did not return a usable answer. */
        MODEL_FAILED,
        /** A video or an unknown attachment: not something this lane inspects. */
        NOT_AN_IMAGE
    }

    /** Whether the photo shows the problem the customer wrote about. UNCLEAR is an answer, not a failure. */
    public enum ProblemVisible { YES, NO, UNCLEAR }

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    @Column(name = "ordinal", nullable = false)
    private int ordinal;

    @Enumerated(EnumType.STRING)
    @Column(name = "media_kind", nullable = false, length = 16)
    private Kind mediaKind;

    @Column(name = "source_url", nullable = false, columnDefinition = "text")
    private String sourceUrl;

    @Column(name = "source_host", nullable = false)
    private String sourceHost;

    /** Which observation read it — the recipe id, e.g. {@code NAVER_REVIEW_OBSERVE_V1}. */
    @Column(name = "observed_by", nullable = false, length = 60)
    private String observedBy;

    @Column(name = "observed_at", nullable = false)
    private Instant observedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "inspection_status", nullable = false, length = 24)
    private InspectionStatus inspectionStatus = InspectionStatus.NOT_INSPECTED;

    @Column(name = "inspected_at")
    private Instant inspectedAt;

    @Column(name = "inspection_model", length = 160)
    private String inspectionModel;

    @Column(name = "depicts", columnDefinition = "text")
    private String depicts;

    @Enumerated(EnumType.STRING)
    @Column(name = "problem_visible", length = 12)
    private ProblemVisible problemVisible;

    @Column(name = "problem_description", columnDefinition = "text")
    private String problemDescription;

    @Column(name = "inspection_failure", length = 40)
    private String inspectionFailure;
}
