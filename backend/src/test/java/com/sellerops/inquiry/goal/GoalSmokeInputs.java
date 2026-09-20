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
        Set fromGit = assemble(fixture);
        List<Input> inputs = new ArrayList<>(fromGit.inputs());
        List<String> missing = new ArrayList<>(fromGit.missing().stream()
                .filter(m -> !m.startsWith(NO_GOAL_CASE)).toList());
        Path capture = storeRoot == null ? null : storeRoot.resolve(CAPTURE);
        if (capture == null || !Files.exists(capture)) {
            missing.add(NO_GOAL_CASE + " — the durable eval store is not restored here; run "
                    + "`node tools/eval-store/store.mjs restore inquiry-planner-capture v1`");
        } else {
            String message = null;
            for (String line : Files.readAllLines(capture)) {
                if (line.isBlank()) {
                    continue;
                }
                JsonNode row = JSON.readTree(line);
                if (NO_GOAL_CASE.equals(row.path("q").asText())) {
                    message = row.path("question").asText();
                    break;
                }
            }
            if (message == null || message.isBlank()) {
                missing.add(NO_GOAL_CASE + " — the store is present and does not carry this case");
            } else {
                inputs.add(new Input(NO_GOAL_CASE, message, true, null, true));
            }
        }
        return new Set(List.copyOf(inputs), List.copyOf(missing), coverage(rows(fixture), inputs));
    }

    public static Set assemble(Path fixture) throws Exception {
        Map<String, JsonNode> rows = rows(fixture);
        List<Input> inputs = new ArrayList<>();
        List<String> missing = new ArrayList<>();
        for (String id : CHOSEN) {
            JsonNode row = rows.get(id);
            if (row == null) {
                missing.add(id + " — named by the manifest, absent from the committed fixture");
                continue;
            }
            JsonNode goals = row.get("goals");
            if (row.hasNonNull("customer_message")) {
                // Written, not assembled. A multi-goal row's input cannot be derived from its own answer key: a
                // join of the goals is a sentence nobody sent, and for the fallback row it drops the very clause
                // the row exists to test.
                inputs.add(new Input(id, row.get("customer_message").asText(), true, null));
            } else if (goals.size() == 1) {
                // explicit_request is, by its own contract, "what this customer asked for, in the customer's terms".
                inputs.add(new Input(id, goals.get(0).get("explicit_request").asText(), true, null));
            } else {
                inputs.add(new Input(id, null, false, "the fixture carries " + goals.size()
                        + " goals and no customer message; assembling one would be writing the input"
                        + (row.has("relations")
                        ? " — and the stated condition lives in the relation, so a naive join drops it" : "")));
            }
        }
        missing.add(NO_GOAL_CASE + " — the NO_GOAL case is a real customer message in the eval store and is read at "
                + "runtime, not from git; use assemble(fixture, storeRoot)");
        return new Set(List.copyOf(inputs), List.copyOf(missing), coverage(rows, inputs));
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
    private static Map<String, String> coverage(Map<String, JsonNode> rows, List<Input> inputs) {
        java.util.Set<String> usable = new java.util.HashSet<>();
        inputs.stream().filter(Input::derivable).forEach(i -> usable.add(i.id()));
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<String, String> want : INTENDED.entrySet()) {
            String by = want.getValue();
            boolean reached = java.util.Arrays.stream(by.split("\\+")).allMatch(usable::contains);
            out.put(want.getKey(), reached ? "covered by " + by
                    : "MISSING — would be covered by " + by + ", which is not in the usable set");
        }
        // The four outcome tokens are checked against the fixture's own labels, not against a list written here.
        for (String outcome : List.of("INFORMATION", "STATE_READ", "DECISION", "ACTION")) {
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
