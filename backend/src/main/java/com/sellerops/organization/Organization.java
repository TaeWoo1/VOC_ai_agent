package com.sellerops.organization;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "organizations")
public class Organization extends BaseEntity {

    @Column(nullable = false)
    private String name;

    /**
     * When this org's Proactive Operations Agent was activated — and therefore the line between its
     * historical backlog and its current work.
     *
     * <p><b>Null means not activated</b>, and an org with no baseline prepares nothing. Written once,
     * by {@code ProactiveCaseReconciler}, on the first tick it runs for the org: activation IS the
     * baseline, so there is nothing for an operator to set and nothing to mistype. Never moved
     * afterwards — moving it forward would hide work, and moving it back would re-open the flood it
     * exists to prevent.
     *
     * <p>It lives here, on the org, because this repository has no org-settings persistence to reuse
     * (audited: {@code organizations} carried a name and nothing else) and one timestamp does not
     * justify inventing one. It is deliberately not a watermark: there is no cursor to advance and no
     * progress to resume.
     */
    @Column(name = "proactive_baseline_at")
    private Instant proactiveBaselineAt;
}
