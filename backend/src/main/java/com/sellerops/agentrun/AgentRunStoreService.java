package com.sellerops.agentrun;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agentrun.dto.AgentRunClaimResponse;
import com.sellerops.agentrun.dto.AgentRunStateRequest;
import com.sellerops.agentrun.dto.AgentRunStateResponse;
import com.sellerops.common.ApiException;
import java.time.Duration;
import java.time.Instant;
import java.util.Iterator;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Org-scoped durable store for Agent Runtime run state, with hand-managed optimistic concurrency.
 *
 * <p>The org always comes from the JWT (the controller passes {@code principal.orgId()}); no method
 * trusts an org from the body, and every query is org-scoped, so a run created by one org is invisible
 * and unresumable to any other — a client-supplied thread id can neither collide nor be read across the
 * boundary.
 *
 * <p><b>Privacy defence in depth.</b> The runtime only ever sends a sanitized snapshot (its RunSnapshot
 * types carry no raw title/body/draft), but {@link #assertSanitizedSnapshot} independently rejects a
 * snapshot that carries a raw-content field name before it is ever written — an exact, case-insensitive
 * key match (never a substring, so {@code bodyFingerprint} / {@code draftVersion} are unaffected) plus a
 * size ceiling. This is the write-side complement to the read-side sanitization the runtime already does.
 */
@Service
public class AgentRunStoreService {

    private static final Set<String> DOMAINS = Set.of("INQUIRY", "REVIEW", "ISSUE");
    /** The only statuses a client may WRITE via upsert. RESUMING is set only by the claim lock. */
    private static final Set<String> STATUSES = Set.of("AWAITING_APPROVAL", "DONE");
    private static final String STATUS_DONE = "DONE";

    /**
     * Crash-recovery lease for a claim: a RESUMING row whose claimer died is re-claimable after this
     * long. Sized well above a normal resume (a few backend calls) so it never steals a live claim, and
     * short enough that a wedged run recovers within a pilot's patience.
     */
    private static final Duration CLAIM_LEASE = Duration.ofMinutes(2);

    /**
     * Field names that unambiguously denote raw customer content or PII and never appear in any
     * sanitized run snapshot (verified against the three RunSnapshot/outcome/brief shapes). Matched
     * exactly and case-insensitively — substrings like {@code bodyFingerprint} or {@code draftVersion}
     * are deliberately NOT matched.
     */
    private static final Set<String> FORBIDDEN_KEYS = Set.of(
            "body", "rawbody", "redactedbody", "customerbody",
            "comments", "details", "detail",
            "draft", "draftbody", "drafttext", "replydraft", "replytext", "reply",
            "quote", "safepreview", "content", "text", "subject", "message",
            "writer", "author", "email", "phone", "memo", "address");

    /** A sanitized snapshot is small (ids, enums, a trail, a bounded brief). This bounds abuse. */
    private static final int MAX_SNAPSHOT_BYTES = 256 * 1024;

    private final AgentRunRepository repository;
    private final ObjectMapper objectMapper;

    public AgentRunStoreService(AgentRunRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public AgentRunStateResponse get(UUID orgId, String threadId) {
        AgentRun run = repository.findByOrgIdAndThreadId(orgId, threadId)
                .orElseThrow(() -> ApiException.notFound("no run found for this thread"));
        return toResponse(run);
    }

    /**
     * Insert a new run (when {@code version} is null) or apply a version-guarded update. A stale expected
     * version, or an update of a thread that does not exist, fails closed with 409; inserting a thread
     * that already exists in this org is likewise a 409 (a run is never silently overwritten).
     */
    @Transactional
    public AgentRunStateResponse upsert(UUID orgId, String threadId, AgentRunStateRequest request) {
        if (!DOMAINS.contains(request.domain())) {
            throw ApiException.badRequest("unknown domain");
        }
        if (!STATUSES.contains(request.status())) {
            throw ApiException.badRequest("unknown status");
        }
        // Size cap first (bounds work before the recursive key walk), then the raw-content key check.
        String snapshotText = serialize(request.snapshot());
        assertSanitizedSnapshot(request.snapshot());
        Instant now = Instant.now();

        if (request.version() == null) {
            AgentRun run = new AgentRun();
            run.setOrgId(orgId);
            run.setThreadId(threadId);
            run.setDomain(request.domain());
            run.setStatus(request.status());
            run.setSnapshot(snapshotText);
            run.setVersion(1L);
            try {
                repository.saveAndFlush(run);
            } catch (DataIntegrityViolationException ex) {
                // The (org, thread) unique key already holds a row — a start over an existing thread.
                throw ApiException.conflict("run already exists for this thread");
            }
            return toResponse(run);
        }

        int changed = repository.updateIfVersion(
                orgId, threadId, snapshotText, request.status(), request.version(), now);
        if (changed == 0) {
            throw ApiException.conflict("stale version or unknown thread");
        }
        return get(orgId, threadId);
    }

    /**
     * Attempt to claim a run for resume. Transitions AWAITING_APPROVAL → RESUMING (or re-claims a
     * lease-expired RESUMING), which moves the row out of the claimable state so a staggered concurrent
     * resume cannot re-claim. Exactly one live caller receives CLAIMED; a finished run yields
     * ALREADY_DONE (replay), and an in-flight (fresh RESUMING) claim yields CONFLICT (fail closed). A
     * thread that does not exist is a 404.
     */
    @Transactional
    public AgentRunClaimResponse claim(UUID orgId, String threadId) {
        Instant now = Instant.now();
        int claimed = repository.claimForResume(orgId, threadId, now, now.minus(CLAIM_LEASE));
        AgentRun run = repository.findByOrgIdAndThreadId(orgId, threadId)
                .orElseThrow(() -> ApiException.notFound("no run found for this thread"));
        if (claimed == 1) {
            return new AgentRunClaimResponse("CLAIMED", run.getVersion(), deserialize(run.getSnapshot()));
        }
        if (STATUS_DONE.equals(run.getStatus())) {
            return new AgentRunClaimResponse("ALREADY_DONE", run.getVersion(), deserialize(run.getSnapshot()));
        }
        // A live RESUMING claim is already in flight (its lease has not elapsed) — fail closed.
        return new AgentRunClaimResponse("CONFLICT", run.getVersion(), null);
    }

    @Transactional
    public void delete(UUID orgId, String threadId) {
        repository.findByOrgIdAndThreadId(orgId, threadId).ifPresent(repository::delete);
    }

    // ----------------------------------------------------------------------- helpers

    private AgentRunStateResponse toResponse(AgentRun run) {
        return new AgentRunStateResponse(
                run.getThreadId(), run.getDomain(), run.getStatus(), run.getVersion(), deserialize(run.getSnapshot()));
    }

    private String serialize(JsonNode snapshot) {
        try {
            String text = objectMapper.writeValueAsString(snapshot);
            if (text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_SNAPSHOT_BYTES) {
                throw ApiException.badRequest("snapshot too large");
            }
            return text;
        } catch (JsonProcessingException ex) {
            throw ApiException.badRequest("snapshot is not serializable");
        }
    }

    private JsonNode deserialize(String text) {
        try {
            return objectMapper.readTree(text);
        } catch (JsonProcessingException ex) {
            // A row we wrote is always valid JSON; a parse failure here is an internal fault.
            throw new IllegalStateException("stored snapshot is not valid JSON");
        }
    }

    /**
     * The snapshot must be present (the top-level value is required), and no object key ANYWHERE in
     * its tree may be a raw-content/PII field name. A nested {@code null} VALUE is legitimate (many
     * sanitized outcome fields are nullable — e.g. a rejected run's {@code executionStatus}), so the
     * "required" check applies only at the root; the recursive walk tolerates nulls and only inspects
     * keys.
     */
    private void assertSanitizedSnapshot(JsonNode node) {
        if (node == null || node.isNull()) {
            throw ApiException.badRequest("snapshot is required");
        }
        rejectForbiddenKeys(node);
    }

    /**
     * Reject a snapshot that carries a raw-content/PII field anywhere in its tree. Matches each object
     * key exactly and case-insensitively against {@link #FORBIDDEN_KEYS} (never a substring, so
     * {@code bodyFingerprint} / {@code draftVersion} are unaffected). Null and scalar values are fine.
     */
    private void rejectForbiddenKeys(JsonNode node) {
        if (node == null) {
            return;
        }
        if (node.isObject()) {
            Iterator<String> names = node.fieldNames();
            while (names.hasNext()) {
                String name = names.next();
                if (FORBIDDEN_KEYS.contains(name.toLowerCase(java.util.Locale.ROOT))) {
                    throw ApiException.badRequest("snapshot carries a forbidden raw-content field");
                }
                rejectForbiddenKeys(node.get(name));
            }
        } else if (node.isArray()) {
            for (JsonNode child : node) {
                rejectForbiddenKeys(child);
            }
        }
    }
}
