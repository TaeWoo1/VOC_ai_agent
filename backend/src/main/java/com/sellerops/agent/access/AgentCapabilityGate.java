package com.sellerops.agent.access;

import java.util.UUID;

/**
 * What a capability's own configuration can answer on its own — split in two so a deployment-level
 * fact and an organisation-level fact stop being one boolean.
 *
 * <p>Every AI capability in this repository is off three ways: a flag, a key, and a list of
 * organisations. The first two are about THIS DEPLOYMENT ("is this capability configured at all"),
 * the third is about WHO MAY USE IT — and until Pilot Readiness Closure v1 they were collapsed into
 * a single {@code isEnabledFor(orgId)}, which is why admitting a new pilot seller meant editing an
 * environment file and restarting the backend.
 *
 * <p>Splitting them changes nothing by itself: {@link #isEnabledFor(UUID)} is still exactly the
 * conjunction it always was, and a deployment that names no access policy behaves byte-identically.
 * What it buys is a seam where {@link AgentCapabilityAccess} can widen the second question — and
 * only the second — from a written-down list to a policy the database can answer.
 */
public interface AgentCapabilityGate {

    /**
     * The capability's own environment-variable PREFIX ({@code SELLEROPS_AGENT_PLAN},
     * {@code SELLEROPS_INQUIRY_SIGNATURE}, …) — so a reader of several capabilities can NAME one
     * without READING one.
     *
     * <p>That distinction is the whole reason this is a method rather than a property key: a file
     * that reads {@code sellerops.agent.draft.*} and {@code sellerops.agent.plan.*} is a file where
     * two separate exposures have become one switch, and {@code AgentDraftBoundaryTest} refuses it.
     * A capability describing itself keeps that invariant intact.
     */
    String capabilityName();

    /** The master switch ALONE — a capability nobody turned on is checked for nothing. */
    boolean isEnabled();

    /** The flag is on AND a key is present: this deployment can make this call at all. */
    boolean isDeployed();

    /** Configuration names at least one organisation: a non-empty list, or the wildcard. */
    boolean namesAnyOrg();

    /** Configuration alone admits this org — the explicit allow-list, or the {@code *} wildcard. */
    boolean isConfiguredFor(UUID orgId);

    /** The historical conjunction, unchanged: configured deployment AND configured org. */
    default boolean isEnabledFor(UUID orgId) {
        return isDeployed() && orgId != null && isConfiguredFor(orgId);
    }
}
