package com.sellerops.inquiry.goal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * <b>The thing an operator approves</b> (Inquiry v3.5) — produced by a preflight, never written by hand.
 *
 * <p>The live approval contract says the one-line grant binds to a manifest's {@code approvalId}, {@code runId} and
 * scope. A paragraph in a design document has none of those, which is why one cannot authorize anything: it describes
 * a run rather than fixing one, and the run that eventually happens can differ from it in every particular without
 * anybody noticing.
 *
 * <p>So this record carries the facts, {@link GoalRunGuard#BOUND} names the subset a run is held to, and
 * {@link #bound()} is the exact view compared at send time. Everything else here — the environment readiness, the
 * cost estimate, the side-effect declarations — is for the human deciding, not for the machine comparing.
 *
 * <p><b>Secrets never appear.</b> The environment is reported as variable NAMES with {@code PRESENT} or
 * {@code MISSING} beside each. Not a value, not a prefix, not a length, not a hash: a hash of a short secret is a
 * secret with an extra step.
 */
public record ApprovalManifest(String approvalId, String runId, String preparedAt, String commit, boolean treeClean,
                               String runner, String promptVersion, String systemFp, String schemaFp,
                               String inputSetFp, String requestFpSet, String model, String reasoningEffort,
                               int calls, int hardCap, String retryPolicy, String scope,
                               boolean realCustomerText, List<String> inputIds, List<String> requestFps,
                               Map<String, String> environment, String outputLocation,
                               Map<String, Object> estimate, List<String> notes) {

    private static final ObjectMapper JSON = new ObjectMapper();

    /** No retry, ever, unless a future manifest says otherwise and is approved on its own terms. */
    public static final String NO_RETRY = "NONE — one request per input; a failed call is a recorded failure";

    /**
     * The side effects this run is declared to have. All zero, and they are written down rather than assumed because
     * "we did not intend to" is not a property anybody can check afterwards.
     */
    public static Map<String, Object> sideEffects() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("marketplace_calls", 0);
        m.put("marketplace_writes", 0);
        m.put("db_writes", 0);
        m.put("migrations", 0);
        m.put("production_cases_changed", 0);
        m.put("external_writes", 0);
        m.put("judge_calls", 0);
        m.put("draft_calls", 0);
        m.put("retrieval_calls", 0);
        m.put("raw_before_scoring", true);
        return m;
    }

    /** The fields an approval is held to. Compared at send time against the same view read from the world. */
    public Map<String, String> bound() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("commit", commit);
        m.put("tree_clean", String.valueOf(treeClean));
        m.put("runner", runner);
        m.put("prompt_version", promptVersion);
        m.put("system_fp", systemFp);
        m.put("schema_fp", schemaFp);
        m.put("input_set_fp", inputSetFp);
        m.put("request_fp_set", requestFpSet);
        m.put("model", model);
        m.put("reasoning_effort", reasoningEffort);
        m.put("calls", String.valueOf(calls));
        m.put("hard_cap", String.valueOf(hardCap));
        m.put("retry_policy", retryPolicy);
        m.put("scope", scope);
        return GoalRunGuard.view(m);
    }

    public ObjectNode toJson() {
        ObjectNode root = JSON.createObjectNode();
        root.put("kind", "APPROVAL_MANIFEST").put("contract", "docs/sellerops_live_approval_contract.md");
        root.put("approval_id", approvalId).put("run_id", runId).put("prepared_at", preparedAt);
        ObjectNode b = root.putObject("bound");
        bound().forEach(b::put);
        root.put("real_customer_text", realCustomerText);
        ArrayNode ids = root.putArray("input_ids");
        inputIds.forEach(ids::add);
        ArrayNode fps = root.putArray("request_fingerprints");
        requestFps.forEach(fps::add);
        ObjectNode env = root.putObject("environment");
        environment.forEach(env::put);
        root.put("output_location", outputLocation);
        ObjectNode effects = root.putObject("side_effects");
        sideEffects().forEach((k, v) -> effects.putPOJO(k, v));
        ObjectNode est = root.putObject("estimate");
        estimate.forEach((k, v) -> est.putPOJO(k, v));
        est.put("basis", "EXTRAPOLATED from the v5 planner baseline — NOT measured for this prompt");
        ArrayNode revocation = root.putArray("revoked_by_any_change_to");
        GoalRunGuard.BOUND.forEach(revocation::add);
        ArrayNode n = root.putArray("notes");
        notes.forEach(n::add);
        return root;
    }

    /** Create or fail. A manifest is a record of a decision point and is never rewritten in place. */
    public void write(Path out) throws Exception {
        Files.writeString(out, toJson().toPrettyString() + "\n", StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE);
    }

    public static ApprovalManifest read(Path in) throws Exception {
        ObjectNode root = (ObjectNode) JSON.readTree(Files.readString(in));
        ObjectNode b = (ObjectNode) root.get("bound");
        List<String> ids = new java.util.ArrayList<>();
        root.get("input_ids").forEach(i -> ids.add(i.asText()));
        List<String> fps = new java.util.ArrayList<>();
        root.get("request_fingerprints").forEach(i -> fps.add(i.asText()));
        Map<String, String> env = new LinkedHashMap<>();
        root.get("environment").fields().forEachRemaining(e -> env.put(e.getKey(), e.getValue().asText()));
        return new ApprovalManifest(root.get("approval_id").asText(), root.get("run_id").asText(),
                root.get("prepared_at").asText(), b.get("commit").asText(),
                Boolean.parseBoolean(b.get("tree_clean").asText()), b.get("runner").asText(),
                b.get("prompt_version").asText(), b.get("system_fp").asText(), b.get("schema_fp").asText(),
                b.get("input_set_fp").asText(), b.get("request_fp_set").asText(), b.get("model").asText(),
                b.get("reasoning_effort").asText(), Integer.parseInt(b.get("calls").asText()),
                Integer.parseInt(b.get("hard_cap").asText()), b.get("retry_policy").asText(),
                b.get("scope").asText(), root.get("real_customer_text").asBoolean(), ids, fps, env,
                root.get("output_location").asText(), Map.of(), List.of());
    }
}
