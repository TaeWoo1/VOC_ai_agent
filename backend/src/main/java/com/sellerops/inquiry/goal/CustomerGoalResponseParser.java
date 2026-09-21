package com.sellerops.inquiry.goal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;

/**
 * <b>Reading one answer from the goal interpreter</b> — the only place a model's JSON becomes a
 * {@link CustomerGoalSet}.
 *
 * <p>Parsing is where a contract is actually enforced, so there is one parser and both the production capability
 * and the evaluation runner call it. Two copies of these rules would be two definitions of what the contract
 * admits, and the one that drifted would be the one nobody ran.
 *
 * <h2>The failure tokens are not interchangeable</h2>
 *
 * <ul>
 *   <li>{@link #UNPARSEABLE} — it is not the JSON object this asked for. A vendor that returned prose, a refusal
 *       or a truncated envelope lands here, and the distinction matters: that is the transport's problem, not the
 *       contract's.</li>
 *   <li>{@link #CONTRACT} — it is JSON, and the records refuse to be built from it. An unknown token, a missing
 *       quote, two goals quoting one clause, a second inference, a fallback cycle.</li>
 *   <li>{@link #EVIDENCE} — every record built, and then a goal's quote turned out not to be in the customer's
 *       message. The model wrote a sentence the customer did not. This is checked last because it is the only one
 *       that needs the original text, and it is the one that catches invention.</li>
 * </ul>
 *
 * <p>All three are refusals. Nothing partially-valid is salvaged: a set is a set, and half a reading of what
 * somebody asked for is not a smaller reading, it is a wrong one.
 */
public final class CustomerGoalResponseParser {

    /** Not the object the schema asked for — transport, refusal or truncation. */
    public static final String UNPARSEABLE = "GOAL_UNPARSEABLE";

    /** JSON the contract will not construct. */
    public static final String CONTRACT = "GOAL_CONTRACT";

    /** Built, but quoting words the customer did not write. */
    public static final String EVIDENCE = "GOAL_EVIDENCE";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private CustomerGoalResponseParser() {
    }

    /**
     * One answer, read.
     *
     * @param set         the goals, or null when this was refused
     * @param goals       the raw {@code goals} node exactly as the vendor sent it, or null
     * @param relations   the raw {@code relations} node, or an empty array when the answer carried none
     * @param failure     one of the three tokens, or null when the set is present
     */
    public record Parsed(CustomerGoalSet set, JsonNode goals, JsonNode relations, String failure) {

        public boolean refused() {
            return failure != null;
        }
    }

    /**
     * @param content         the vendor's message content
     * @param customerMessage the text the goals must quote from; a blank one refuses every quote, which is correct —
     *                        a goal quoting a message we do not have is not evidence of anything
     */
    public static Parsed parse(String content, String customerMessage) {
        JsonNode root;
        try {
            root = MAPPER.readTree(content);
        } catch (Exception notJson) {
            return new Parsed(null, null, null, UNPARSEABLE);
        }
        if (root == null || !root.isObject() || !root.has("goals")) {
            return new Parsed(null, null, null, UNPARSEABLE);
        }
        try {
            List<CustomerGoal> goals = new ArrayList<>();
            for (JsonNode g : root.get("goals")) {
                List<String> constraints = new ArrayList<>();
                g.path("explicit_constraints").forEach(c -> constraints.add(c.asText()));
                goals.add(new CustomerGoal(g.path("id").asText(), g.path("explicit_request").asText(),
                        RequestedOutcome.valueOf(g.path("requested_outcome").asText()),
                        Referent.valueOf(g.path("subject").asText()),
                        RequestBasis.valueOf(g.path("basis").asText()), constraints,
                        g.path("evidence").asText(null)));
            }
            List<GoalRelation> relations = new ArrayList<>();
            if (root.has("relations")) {
                for (JsonNode r : root.get("relations")) {
                    relations.add(new GoalRelation(GoalRelation.Kind.valueOf(r.path("kind").asText()),
                            r.path("primary_goal_id").asText(), r.path("fallback_goal_id").asText(),
                            r.path("stated_condition").asText()));
                }
            }
            // The set's own rules: ids, one fallback each, no cycles, one clause per goal, one inference per message.
            CustomerGoalSet set = new CustomerGoalSet(goals, relations);
            if (!set.unquoted(customerMessage).isEmpty()) {
                return new Parsed(null, null, null, EVIDENCE);
            }
            return new Parsed(set, root.get("goals"),
                    root.has("relations") ? root.get("relations") : MAPPER.createArrayNode(), null);
        } catch (IllegalArgumentException | NullPointerException refused) {
            return new Parsed(null, null, null, CONTRACT);
        }
    }
}
