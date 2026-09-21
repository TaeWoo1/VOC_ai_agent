package com.sellerops.inquiry.goal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * <b>The smoke's inputs, rebuilt from committed source rather than read out of a document</b> (Inquiry v3.5).
 *
 * <p>A manifest that names inputs a document described is a manifest about a document. So the set is assembled here
 * from {@code contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl}, and a case the fixture does not carry is
 * <b>reported as missing rather than supplied</b>.
 *
 * <h2>What an input is, and where the fixture stops short</h2>
 *
 * <p>The fixture is a fixture of <b>expected output</b>: each row carries the goals (and, for one row, the relation)
 * that the interpreter should produce. For a row with a single goal, {@code explicit_request} is by its own contract
 * "what this customer asked for, in the customer's terms" — so it is also the input, exactly, with nothing derived.
 *
 * <p>For a row with several goals there is <b>no committed customer message</b>. Concatenating the goals would be
 * writing the input, not reading it, and for the fallback row it would produce an input with the conditional clause
 * missing — a test that asks the model to find a condition nobody wrote. Those rows are reported
 * {@link Input#derivable() not derivable}, with the reason, and the preflight refuses to bind to a set containing
 * them rather than inventing text to fill the hole.
 */
public final class GoalSmokeInputs {

    private static final ObjectMapper JSON = new ObjectMapper();

    /** §22.11's chosen subset, by fixture id, in the order the document lists them. */
    public static final List<String> CHOSEN = List.of("G01", "G03", "G05", "G04", "G06", "G07", "G15", "G16",
            "G13", "G11", "G02", "G08", "G23");

    /**
     * The fourteenth input §22.11 names: a NO_GOAL case from the frozen corpus.
     *
     * <p>It is <b>deliberately not a git fixture</b>. Its whole value is that it is a real message — the row where a
     * model is most tempted to invent a goal nobody asked for — and a synthetic stand-in would be one somebody
     * designed to be easy. So it is read from the durable eval store <b>at runtime</b> and never copied into this
     * repository: what is committed is its id, and a manifest built with it declares {@code real_customer_text}.
     */
    public static final String NO_GOAL_CASE = "R:0c582144";

    /** Where the real message lives. Never in git, and never written back out of the store by this harness. */
    public static final String CAPTURE = "inquiry-planner-capture/v1/capture-S0.jsonl";

    /** What the smoke is supposed to exercise. Coverage is asserted against the assembled set, never assumed. */
    public static final Map<String, String> INTENDED = intended();

    /**
     * <b>What a run is a run of</b> — which inputs, which shapes it claims to cover, and which outcome tokens it
     * needs to reach.
     *
     * <p>All three used to be constants read straight out of this class, which is right while there is one smoke and
     * wrong the moment there are two: a six-case run held to the fourteen-case run's coverage list is {@code BLOCKED}
     * on coverage it never intended to have. Making the claim part of the plan is what stops "covered" from quietly
     * meaning "covered by whatever the other smoke wanted".
     *
     * <p><b>{@code requiredOutcomes} is deliberately not always all four.</b> A targeted plan that does not exercise
     * {@link RequestedOutcome#STATE_READ} should say so rather than fail a check it never meant to pass — and should
     * equally not be able to drop a token it <i>is</i> relying on without editing this list.
     */
    public record Plan(String name, String why, List<String> fixtureIds, List<String> storeIds,
                       List<String> requiredOutcomes, Map<String, String> intended) {

        /** Every input this plan names, store rows included: the number of calls an operator is approving. */
        public int planned() {
            return fixtureIds.size() + storeIds.size();
        }
    }

    /** The full contract smoke of §22.11: thirteen committed fixtures and the one real NO_GOAL message. */
    public static final Plan CONTRACT_SMOKE = new Plan("contract-smoke-v1",
            "the fourteen shapes of §22.11 — the broad contract check",
            CHOSEN, List.of(NO_GOAL_CASE),
            List.of("INFORMATION", "STATE_READ", "DECISION", "ACTION"), intended());

    /**
     * <b>The v2 goal-provenance smoke</b> (§25): six cases, chosen to be able to fail in both directions.
     *
     * <p>A fence is only worth measuring on what it catches <i>and</i> on what it must not break, so four of these
     * six exist to catch a regression rather than the defect:
     *
     * <ul>
     *   <li>{@code G15} — the recorded failure. A problem report with no request; an {@code ACTION} here is
     *       invented.</li>
     *   <li>{@code R:4181864b} — <b>the one that matters most.</b> A real message whose gold goal is a legitimate
     *       {@code DIRECTLY_IMPLIED} {@code ACTION}. If the fence is over-tight, this is where it shows, and it is a
     *       real customer's words rather than a synthetic stand-in somebody designed to pass.</li>
     *   <li>{@code G23} — a customer-stated {@code FALLBACK} with a verbatim condition: the relation fence must come
     *       through the goal fence untouched.</li>
     *   <li>{@code R:0c582144} — NO_GOAL, the row where inventing is most tempting.</li>
     *   <li>{@code G07} — two {@code STATED} goals in one message: the one-inference cap must not touch it.</li>
     *   <li>{@code G01} — the plainest {@code STATED} {@code INFORMATION} there is.</li>
     * </ul>
     *
     * <p>No {@code STATE_READ} case, and that is a decision rather than an oversight: none of the six shapes needs
     * one, and padding the set to satisfy a coverage list would be buying a model call to make a report look round.
     */
    public static final Plan PROVENANCE_SMOKE = new Plan("provenance-smoke-v2",
            "does the v2 evidence fence refuse the invented ACTION while keeping the legitimate implied one",
            List.of("G15", "G23", "G07", "G01"), List.of("R:4181864b", NO_GOAL_CASE),
            List.of("INFORMATION", "DECISION", "ACTION"), provenanceIntended());

    /**
     * The frozen gold's own case ids, all 67. <b>Ids only</b>: every message behind them is a real customer's words
     * and is read from the durable eval store at runtime, never copied into this repository.
     */
    public static final List<String> DEV_CASES = List.of(
            "R:0c582144", "R:2673edfb", "R:320d1157", "R:4181864b", "R:515dd536", "R:77a91fab", "R:7a8136b2",
            "R:83e607e0", "R:8989a9d0", "R:9a91964c", "R:9b8cc5a5", "R:ae41a418", "R:ae51c7f8", "R:b30d57be",
            "R:c491451a", "R:c626515c", "R:d28c23f9", "R:dae8554d", "R:e66f3a57", "R:e9030ab6", "R:e9555ebc",
            "R:f2ff4a0b", "R:f403e606", "R:f81ad84a", "R:ffc2cc44", "S:N1", "S:N10", "S:N11", "S:N12", "S:N2",
            "S:N3", "S:N4", "S:N5", "S:N6", "S:N7", "S:N8", "S:N9", "S:T10a", "S:T10b", "S:T11a", "S:T12a", "S:T13a",
            "S:T1a", "S:T1b", "S:T2a", "S:T2b", "S:T2c", "S:T3a", "S:T3b", "S:T4a", "S:T4b", "S:T5a", "S:T5b",
            "S:T6a", "S:T6b", "S:T6c", "S:T7a", "S:T7b", "S:T8a", "S:T8b", "S:T9a", "S:T9b", "S:X2a", "S:X3a",
            "S:X6a", "S:X6b", "S:X9a");

    /**
     * <b>The 67-case DEV diagnostic</b> (§25.11): every case the frozen gold carries, measured once against the
     * frozen v2 contract.
     *
     * <p>It is a <b>baseline, not an improvement loop</b>. The result is not a reason to edit the prompt, and this
     * set does not become a tuning corpus afterwards — a DEV set measured once and then optimised against has
     * been converted into training data, and the number it produced stops meaning what it said.
     *
     * <p>Every input is a real customer message read from the durable store, so the ids are committed here and the
     * messages are not — the same division the NO_GOAL case has always had. The list is the gold's own case set:
     * {@code GoalProvenanceSmokePlanTest} asserts it equals what the store carries, so it cannot drift into being a
     * hand-picked subset.
     *
     * <p><b>No {@code intended} shapes and no {@code requiredOutcomes}, deliberately.</b> Coverage here is a claim
     * about the committed fixture's own labels, and none of these 67 is a fixture row; their labels live in the
     * frozen gold, outside git. Asserting shapes from an uncommitted file would make the manifest depend on a
     * document nobody can diff. What has to hold instead — that all 67 were assembled — is already the
     * difference between {@code planned} and {@code usable}, and a store that is short reports it as {@code missing}.
     */
    public static final Plan DEV_DIAGNOSTIC = new Plan("dev-diagnostic-v2",
            "one measurement of the frozen v2 contract against the whole frozen gold — baseline, not tuning",
            List.of(), DEV_CASES, List.of(), Map.of());

    /** By name, so the operator's command selects a plan rather than edits one. */
    public static final Map<String, Plan> PLANS =
            Map.of(CONTRACT_SMOKE.name(), CONTRACT_SMOKE, PROVENANCE_SMOKE.name(), PROVENANCE_SMOKE);

    private GoalSmokeInputs() {
    }

    /**
     * @param message    the customer's message, exactly as committed, or null when the fixture does not carry one
     * @param derivable  whether an input could be rebuilt from committed bytes without anybody writing text
     */
    public record Input(String id, String message, boolean derivable, String why, boolean realCustomerText) {
        public Input(String id, String message, boolean derivable, String why) {
            this(id, message, derivable, why, false);
        }
    }

    public record Set(List<Input> inputs, List<String> missing, Map<String, String> coverage) {

        public List<Input> usable() {
            return inputs.stream().filter(Input::derivable).toList();
        }

        public boolean complete() {
            return missing.isEmpty() && inputs.stream().allMatch(Input::derivable)
                    && coverage.values().stream().noneMatch(v -> v.startsWith("MISSING"));
        }

        /** Whether any input is a real customer's words. The manifest declares it; it is never inferred later. */
        public boolean realCustomerText() {
            return inputs.stream().anyMatch(Input::realCustomerText);
        }
    }

    /**
     * The whole set: thirteen from committed source and one from the durable store.
     *
     * <p><b>Nothing merged and nothing disappeared</b> between §22.11's fourteen and this. {@link #CHOSEN} is the
     * thirteen that are git fixtures; {@link #NO_GOAL_CASE} is the fourteenth and lives in the store on purpose.
     * An earlier report printed "13" because the field counted only the fixture-derived rows, which was a name doing
     * the wrong job rather than a row going astray.
     */
    public static Set assemble(Path fixture, Path storeRoot) throws Exception {
        return assemble(fixture, storeRoot, CONTRACT_SMOKE);
    }

    /** The same assembly for any {@link Plan}: its committed fixtures, then the real messages it names. */
    public static Set assemble(Path fixture, Path storeRoot, Plan plan) throws Exception {
        Set fromGit = assemble(fixture, plan);
        List<Input> inputs = new ArrayList<>(fromGit.inputs());
        List<String> missing = new ArrayList<>(fromGit.missing().stream()
                .filter(m -> plan.storeIds().stream().noneMatch(m::startsWith)).toList());
        Path capture = storeRoot == null ? null : storeRoot.resolve(CAPTURE);
        if (capture == null || !Files.exists(capture)) {
            plan.storeIds().forEach(id -> missing.add(id + " — the durable eval store is not restored here; run "
                    + "`node tools/eval-store/store.mjs restore inquiry-planner-capture v1`"));
        } else {
            for (String id : plan.storeIds()) {
                String message = null;
                for (String line : Files.readAllLines(capture)) {
                    if (line.isBlank()) {
                        continue;
                    }
                    JsonNode row = JSON.readTree(line);
                    if (id.equals(row.path("q").asText())) {
                        message = row.path("question").asText();
                        break;
                    }
                }
                if (message == null || message.isBlank()) {
                    missing.add(id + " — the store is present and does not carry this case");
                } else {
                    inputs.add(new Input(id, message, true, null, true));
                }
            }
        }
        return new Set(List.copyOf(inputs), List.copyOf(missing), coverage(rows(fixture), inputs, plan));
    }

    public static Set assemble(Path fixture) throws Exception {
        return assemble(fixture, CONTRACT_SMOKE);
    }

    public static Set assemble(Path fixture, Plan plan) throws Exception {
        Map<String, JsonNode> rows = rows(fixture);
        List<Input> inputs = new ArrayList<>();
        List<String> missing = new ArrayList<>();
        for (String id : plan.fixtureIds()) {
            JsonNode row = rows.get(id);
            if (row == null) {
                missing.add(id + " — named by the manifest, absent from the committed fixture");
                continue;
            }
            inputs.add(fromFixture(id, row));
        }
        plan.storeIds().forEach(id -> missing.add(id + " — a real customer message in the eval store, read at "
                + "runtime and not from git; use assemble(fixture, storeRoot, plan)"));
        return new Set(List.copyOf(inputs), List.copyOf(missing), coverage(rows, inputs, plan));
    }

    /** One committed row's input. The single definition both assembly paths read, so they cannot drift. */
    private static Input fromFixture(String id, JsonNode row) {
        JsonNode goals = row.get("goals");
        if (row.hasNonNull("customer_message")) {
            // Written, not assembled. A multi-goal row's input cannot be derived from its own answer key: a join of
            // the goals is a sentence nobody sent, and for the fallback row it drops the very clause it exists to
            // test.
            return new Input(id, row.get("customer_message").asText(), true, null);
        }
        if (goals.size() == 1) {
            // explicit_request is, by its own contract, "what this customer asked for, in the customer's terms".
            return new Input(id, goals.get(0).get("explicit_request").asText(), true, null);
        }
        return new Input(id, null, false, "the fixture carries " + goals.size()
                + " goals and no customer message; assembling one would be writing the input"
                + (row.has("relations")
                ? " — and the stated condition lives in the relation, so a naive join drops it" : ""));
    }

    /**
     * <b>The inputs an approved manifest names</b>, in the order it names them.
     *
     * <p>The launcher used to re-assemble the default plan and hope it matched. It could never send the WRONG set
     * — {@code input_set_fp} and {@code request_fp_set} are bound, so a mismatch is a refusal — but it equally could
     * not send a DIFFERENT one, which made every plan but the default unspendable. Reading the ids off the manifest
     * makes the approved document decide what goes out, and leaves the fingerprints as the check on that rather
     * than as the only expression of it.
     *
     * <p><b>No new manifest field</b>: {@code input_ids} has been in there since the first manifest. A plan name
     * would have been a second, weaker statement of the same fact, and two statements can disagree.
     */
    public static Set forIds(Path fixture, Path storeRoot, List<String> ids) throws Exception {
        Map<String, JsonNode> rows = rows(fixture);
        Map<String, String> fromStore = storeMessages(storeRoot);
        List<Input> inputs = new ArrayList<>();
        List<String> missing = new ArrayList<>();
        for (String id : ids) {
            if (rows.containsKey(id)) {
                inputs.add(fromFixture(id, rows.get(id)));
            } else if (fromStore.containsKey(id)) {
                inputs.add(new Input(id, fromStore.get(id), true, null, true));
            } else {
                missing.add(id + " — named by the manifest, and neither a committed fixture nor in the store");
            }
        }
        // Coverage is a claim a PLAN makes about shapes; a manifest's ids are already a decided set, so there is
        // nothing here to be short of. An empty map is the honest answer, not a missing check.
        return new Set(List.copyOf(inputs), List.copyOf(missing), Map.of());
    }

    /** Every real message the durable store carries, by case id. Empty when the store is not restored here. */
    private static Map<String, String> storeMessages(Path storeRoot) throws Exception {
        Map<String, String> out = new LinkedHashMap<>();
        Path capture = storeRoot == null ? null : storeRoot.resolve(CAPTURE);
        if (capture == null || !Files.exists(capture)) {
            return out;
        }
        for (String line : Files.readAllLines(capture)) {
            if (line.isBlank()) {
                continue;
            }
            JsonNode row = JSON.readTree(line);
            String message = row.path("question").asText();
            if (!message.isBlank()) {
                out.put(row.path("q").asText(), message);
            }
        }
        return out;
    }

    private static Map<String, JsonNode> rows(Path fixture) throws Exception {
        Map<String, JsonNode> rows = new LinkedHashMap<>();
        for (String line : Files.readAllLines(fixture)) {
            if (!line.isBlank()) {
                JsonNode row = JSON.readTree(line);
                rows.put(row.get("id").asText(), row);
            }
        }
        return rows;
    }

    /** Which intended shapes the assembled set actually reaches, read from the fixture rather than asserted. */
    private static Map<String, String> coverage(Map<String, JsonNode> rows, List<Input> inputs, Plan plan) {
        java.util.Set<String> usable = new java.util.HashSet<>();
        inputs.stream().filter(Input::derivable).forEach(i -> usable.add(i.id()));
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<String, String> want : plan.intended().entrySet()) {
            String by = want.getValue();
            boolean reached = java.util.Arrays.stream(by.split("\\+")).allMatch(usable::contains);
            out.put(want.getKey(), reached ? "covered by " + by
                    : "MISSING — would be covered by " + by + ", which is not in the usable set");
        }
        // The outcome tokens are checked against the fixture's OWN labels; which tokens a plan owes is the plan's
        // claim, so a targeted plan cannot be failed for a shape it never said it covered — nor drop one it did.
        for (String outcome : plan.requiredOutcomes()) {
            boolean seen = usable.stream().filter(rows::containsKey).anyMatch(id -> {
                // The NO_GOAL input has no fixture row and asks for no outcome, which is the point of it.
                for (JsonNode g : rows.get(id).get("goals")) {
                    if (g.get("requested_outcome").asText().equals(outcome)) {
                        return true;
                    }
                }
                return false;
            });
            out.put("outcome:" + outcome, seen ? "covered" : "MISSING — no usable input asks for it");
        }
        return out;
    }

    /**
     * What the six-case provenance smoke claims to exercise. Each line is one question the run can answer wrongly;
     * a shape with no input to reach it is a {@code MISSING} the preflight refuses to prepare around.
     */
    private static Map<String, String> provenanceIntended() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("no_invented_remedy", "G15");
        m.put("legitimate_implied_action_survives", "R:4181864b");
        m.put("explicit_fallback", "G23");
        m.put("no_goal", "R:0c582144");
        m.put("multi_goal", "G07");
        m.put("plain_stated_information", "G01");
        // Both directions in one line: the cap must refuse G15 and leave R:4181864b alone, and a run that reaches
        // only one of them has measured only half of the fence.
        m.put("fence_measured_in_both_directions", "G15+R:4181864b");
        return m;
    }

    private static Map<String, String> intended() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("no_goal", "R:0c582144");
        m.put("multi_goal", "G07");
        m.put("explicit_fallback", "G23");
        m.put("can_you_boundary", "G06+G07");
        m.put("no_invented_prerequisite_goal", "G13");
        m.put("unavailable_capability_keeps_semantics", "G16");
        m.put("no_invented_remedy", "G15");
        m.put("unresolved_referent", "G11");
        m.put("catalogue_referent", "G02");
        m.put("no_invented_constraint", "G08");
        return m;
    }
}
