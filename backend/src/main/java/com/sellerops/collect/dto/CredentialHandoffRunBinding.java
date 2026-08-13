package com.sellerops.collect.dto;

/**
 * **Which approved run this handoff belongs to** — the identity the operator's single-use grant was bound to,
 * presented back by the agent so the backend can check it against what was armed.
 *
 * <p>Every field is an ENVIRONMENT token, never a credential and never a seller identity: two opaque ids minted
 * by the bootstrap, the commit the approval names, and a fixed phase literal. The whole quadruple travels
 * because each field answers a different question, and dropping any one of them leaves a way to reuse a grant:
 * the approval id alone cannot say which run, the run id alone cannot say which approval, the commit is what
 * makes "the code the operator approved" checkable, and the phase is what stops a calibration grant — which is
 * for a run that reads no value — from authorizing the run that reads three.
 *
 * <p>It is presented, not trusted. The backend compares it to the arming it was given out of band; a request
 * that presents an identity nobody armed is refused before the vault is touched.
 */
public record CredentialHandoffRunBinding(String approvalId, String runId, String gitCommit, String phase) {

    /** True when nothing usable was presented. Treated exactly as an absent binding — no partial credit. */
    public boolean isBlank() {
        return blank(approvalId) || blank(runId) || blank(gitCommit) || blank(phase);
    }

    private static boolean blank(String v) {
        return v == null || v.isBlank();
    }

    /**
     * Safe to print in full: there is no secret here. Said out loud because the sibling request record masks
     * everything, and a reader should not have to wonder whether this one is hiding something too.
     */
    @Override
    public String toString() {
        return "CredentialHandoffRunBinding[approvalId=" + approvalId + ", runId=" + runId
                + ", gitCommit=" + gitCommit + ", phase=" + phase + "]";
    }
}
