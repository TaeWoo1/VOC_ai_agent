package com.sellerops.operationscase;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One line of a case's history. Append-only — the migration's trigger refuses UPDATE and DELETE.
 *
 * <p>{@link #provenance} is metadata only (model, versions, tool names with argument digests, short evidence refs,
 * usage). {@code OperationsCasePayloadFloorTest} asserts no customer or seller sentence reaches it.
 */
@Getter
@Setter
@Entity
@Table(name = "operations_case_event")
public class OperationsCaseEvent extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "case_id", nullable = false)
    private UUID caseId;

    @Column(name = "run_id")
    private UUID runId;

    @Enumerated(EnumType.STRING)
    @Column(name = "actor", nullable = false, length = 8)
    private CaseEventActor actor;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, length = 32)
    private CaseEventKind kind;

    @Enumerated(EnumType.STRING)
    @Column(name = "disposition", length = 24)
    private CaseDisposition disposition;

    @Enumerated(EnumType.STRING)
    @Column(name = "resolution_reason", length = 32)
    private CaseResolution resolutionReason;

    @Column(name = "provenance", columnDefinition = "text")
    private String provenance;

    static OperationsCaseEvent of(OperationsCase c, UUID runId, CaseEventActor actor, CaseEventKind kind,
                                  String provenance) {
        OperationsCaseEvent event = new OperationsCaseEvent();
        event.setOrgId(c.getOrgId());
        event.setCaseId(c.getId());
        event.setRunId(runId);
        event.setActor(actor);
        event.setKind(kind);
        event.setDisposition(c.getDisposition());
        event.setResolutionReason(c.getResolutionReason());
        event.setProvenance(provenance);
        return event;
    }
}
