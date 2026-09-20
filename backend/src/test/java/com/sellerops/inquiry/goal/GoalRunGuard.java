package com.sellerops.inquiry.goal;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * <b>What an approval is bound to, and what breaks it</b> (Inquiry v3.5) — the whole of the approval contract that
 * has to be right, in one place with no dependencies.
 *
 * <p>It lives alone for two reasons. It is the only code in the harness where being wrong means <b>spending money
 * against an authorization nobody gave</b>, so it is the one place worth mutation-testing; and a class whose only
 * imports are {@code java.util} can be compiled from source inside a test, which is what makes that possible.
 *
 * <h2>The rule</h2>
 *
 * <p>An operator approves a <b>manifest</b>, not an intention. The manifest fixes a list of facts about the run that
 * would happen; a run may proceed only when every one of those facts is <b>still true at the moment of sending</b>.
 * Any difference — a commit, a prompt byte, a model, a cap — revokes it, because the thing that was approved is no
 * longer the thing that would run.
 *
 * <p><b>This is why a prose manifest cannot authorize anything.</b> A document describes a run; it does not fix one.
 * {@link #BOUND} names the fields that must be carried and compared, and a manifest that does not carry all of them
 * cannot be bound to — {@link #missing} refuses it before any comparison is attempted, so "approved" can never mean
 * "approved as far as we bothered to check".
 */
public final class GoalRunGuard {

    /**
     * Every field an approval is bound to. A change to any one of them revokes it.
     *
     * <p>The list is the revocation policy, written once. Four groups: <b>what code would run</b> (commit, tree,
     * runner), <b>what would be sent</b> (prompt version, the two prompt fingerprints, the input set, the exact
     * request bytes, model, reasoning effort), <b>how much</b> (calls, hard cap, retry policy, scope) and
     * <b>by what tool</b> (transport).
     *
     * <p>{@code transport} is here because the live approval contract §4 puts it here: <i>"a change of the execution
     * TOOL (CLI/driver) ⇒ the existing manifest is immediately REVOKED. The tool is part of the manifest; you cannot
     * approve one tool and run another."</i> A rehearsal against a deterministic fake and a run against a vendor are
     * different tools, so an approval for one refuses the other — rather than a rehearsal being a real approval with
     * a note beside it, which is the shape this harness has twice established cannot authorize anything.
     */
    public static final List<String> BOUND = List.of(
            "commit", "tree_clean", "runner", "prompt_version", "system_fp", "schema_fp", "input_set_fp",
            "request_fp_set", "model", "reasoning_effort", "calls", "hard_cap", "retry_policy", "scope",
            "transport");

    private GoalRunGuard() {
    }

    /** Bound fields the manifest does not carry. A manifest missing any of them cannot be bound to at all. */
    public static List<String> missing(Map<String, String> manifest) {
        List<String> out = new ArrayList<>();
        for (String field : BOUND) {
            String value = manifest == null ? null : manifest.get(field);
            if (value == null || value.isBlank()) {
                out.add(field);
            }
        }
        return List.copyOf(out);
    }

    /**
     * Why this run may not proceed, or an empty list. Identity first — a run carrying the wrong {@code approvalId} or
     * {@code runId} is not this approval at all and is refused before its contents are even compared.
     *
     * @param approved the manifest the operator approved
     * @param actual   the same fields, read from the world at the moment of sending
     */
    public static List<String> refusals(String approvedApprovalId, String approvedRunId, Map<String, String> approved,
                                        String attemptApprovalId, String attemptRunId, Map<String, String> actual) {
        List<String> out = new ArrayList<>();
        if (approvedApprovalId == null || approvedApprovalId.isBlank() || approvedRunId == null
                || approvedRunId.isBlank()) {
            out.add("UNIDENTIFIED_APPROVAL");
            return List.copyOf(out);
        }
        if (!approvedApprovalId.equals(attemptApprovalId)) {
            out.add("APPROVAL_ID");
        }
        if (!approvedRunId.equals(attemptRunId)) {
            out.add("RUN_ID");
        }
        if (!out.isEmpty()) {
            return List.copyOf(out);
        }
        for (String field : missing(approved)) {
            out.add("UNBOUND:" + field);
        }
        if (!out.isEmpty()) {
            return List.copyOf(out);
        }
        for (String field : BOUND) {
            String was = approved.get(field);
            String now = actual == null ? null : actual.get(field);
            if (now == null || !was.equals(now)) {
                out.add(field);
            }
        }
        return List.copyOf(out);
    }

    /**
     * The hard cap, checked <b>before</b> a send rather than after it. {@code calls} is how many have already gone
     * out, so the call about to be made is the {@code calls + 1}-th and the cap is reached when they are equal.
     *
     * @throws IllegalStateException always, when the next send would exceed the cap
     */
    public static void checkCap(int calls, int cap) {
        if (cap < 0) {
            throw new IllegalStateException("GOAL_CAP_INVALID: " + cap);
        }
        if (calls >= cap) {
            throw new IllegalStateException("GOAL_MAX_CALLS reached: " + calls + " of " + cap);
        }
    }

    /** The bound view of a run, in {@link #BOUND} order so two of them compare and print the same way. */
    public static Map<String, String> view(Map<String, String> values) {
        Map<String, String> out = new LinkedHashMap<>();
        for (String field : BOUND) {
            out.put(field, values == null ? null : values.get(field));
        }
        return out;
    }
}
