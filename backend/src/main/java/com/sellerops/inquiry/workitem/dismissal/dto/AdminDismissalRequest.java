package com.sellerops.inquiry.workitem.dismissal.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.sellerops.inquiry.workitem.dismissal.DismissalManifest;
import java.util.List;
import java.util.UUID;

/**
 * The admin dismissal request body — the approved manifest envelope, flat, plus (for
 * execute) a {@code confirmation} token. The manifest fields are validated by {@link
 * DismissalManifest#validated}; the audit actor and the org are NEVER taken from this
 * body — they are derived from the authenticated principal by the controller.
 *
 * <p>{@code approved_by} / {@code approved_at} are retained purely as approval
 * <i>metadata</i> (who signed off), echoed back distinctly from the authenticated
 * actor; they are never treated as identity or authorization.
 */
public record AdminDismissalRequest(
        boolean approved,
        @JsonProperty("approved_by") String approvedBy,
        @JsonProperty("approved_at") String approvedAt,
        UUID sellerAccountId,
        String disposition,
        String commandId,
        List<UUID> workItemIds,
        String confirmation) {

    /** Project the approval envelope onto the validated manifest type (no confirmation). */
    public DismissalManifest toManifest() {
        return new DismissalManifest(approved, approvedBy, approvedAt, sellerAccountId,
                disposition, commandId, workItemIds);
    }
}
