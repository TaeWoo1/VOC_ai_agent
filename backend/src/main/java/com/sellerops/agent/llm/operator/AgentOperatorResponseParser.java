package com.sellerops.agent.llm.operator;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Validating parsers for the two Operator LLM answers.
 *
 * <p><b>Off-schema is a refusal.</b> There is no repair pass and no second call: a half-parsed plan
 * would run tools nobody chose, and a half-parsed verdict would let a claim through under a judgement
 * that was never made. What a refusal COSTS differs by capability and that difference is deliberate —
 * a refused verdict falls back to the deterministic rule judge (withhold-only, so the Operator gets
 * quieter), while a refused PLAN ends the run, because there is no deterministic planner to fall back
 * to and inventing one is exactly what Operator Graph v2 forbids.
 *
 * <p>Both parsers share {@link #assistantText} because reading a vendor envelope is a transport
 * concern, not a contract one — the same two spellings {@code AgentDraftResponseParser} reads, for the
 * same reason (the vendor is configuration).
 */
public final class AgentOperatorResponseParser {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** Guards on the free-ish text fields, so a runaway answer cannot become a log line or a UI blob. */
    private static final int MAX_REASON = 400;
    private static final int MAX_TOOL_NAME = 120;
    private static final int MAX_LIST = 24;

    private AgentOperatorResponseParser() {
    }

    /** The assistant text out of either vendor's envelope (Anthropic {@code content[0].text} / OpenAI). */
    public static Optional<String> assistantText(String body) {
        if (body == null || body.isBlank()) {
            return Optional.empty();
        }
        try {
            JsonNode root = MAPPER.readTree(body);
            JsonNode anthropic = root.path("content").path(0).path("text");
            if (anthropic.isTextual()) {
                return Optional.of(anthropic.asText());
            }
            JsonNode openai = root.path("choices").path(0).path("message").path("content");
            if (openai.isTextual()) {
                return Optional.of(openai.asText());
            }
            return Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    /**
     * A validated investigation plan (Operator Graph v2 schema).
     *
     * <p>Specialist and tool names are NOT checked against the catalogue here — the runtime refuses an
     * unknown name at execution time, which is the only check that is still true after the catalogue
     * changes. What is checked is shape, non-blankness and length, so a plan can never carry a 40 KB
     * "tool name" into a log line.
     *
     * <p><b>An absent optional section is an EMPTY section, never a filled-in one.</b> A plan that named
     * no information need parses to an empty list and the runtime's validator then refuses it, which is
     * the correct outcome; substituting a plausible need here would make this parser the planner.
     *
     * <p><b>No entity id is accepted from the model, at all.</b> The schema has only {@code mention}
     * strings, so there is no field for an id to arrive in — the parser cannot pass one through even if
     * a model volunteers it.
     */
    public static Optional<ParsedPlan> parsePlan(String assistantText) {
        JsonNode node = object(assistantText);
        if (node == null) {
            return Optional.empty();
        }
        JsonNode supported = node.get("supported");
        if (supported == null || !supported.isBoolean()) {
            return Optional.empty();
        }
        List<String> specialists = strings(node.get("specialists"));
        List<String> tools = strings(node.get("tools"));
        if (specialists == null || tools == null) {
            return Optional.empty();
        }
        List<ParsedNeed> needs = needs(node.get("informationNeeds"));
        List<ParsedMention> mentions = mentions(node.get("unresolvedEntities"));
        List<ParsedEvidenceRequirement> requirements = requirements(node.get("evidenceRequirements"));
        if (needs == null || mentions == null || requirements == null) {
            return Optional.empty();
        }
        List<String> order = strings(node.get("retrievalOrder"));
        List<String> parallel = strings(node.get("retrievalParallel"));
        if (order == null || parallel == null) {
            return Optional.empty();
        }
        return Optional.of(new ParsedPlan(
                supported.asBoolean(),
                optionalText(node, "userGoal", MAX_REASON),
                mentions,
                needs,
                specialists,
                tools,
                order,
                parallel,
                optionalText(node, "retrievalStopWhen", MAX_REASON),
                requirements,
                optionalText(node, "riskClass", MAX_TOOL_NAME),
                intOr(node, "maxIterations"),
                intOr(node, "maxToolCalls"),
                optionalText(node, "stopWhenEnough", MAX_REASON),
                node.path("clarificationNeeded").asBoolean(false),
                optionalText(node, "clarificationReason", MAX_REASON),
                optionalText(node, "rationale", MAX_REASON),
                closedOr(node, "requestedAction", AgentPlanPrompt.REQUESTED_ACTIONS, "NONE"),
                closedOr(node, "tone", AgentPlanPrompt.TONES, null),
                filters(node.get("filters")),
                target(node.get("target"))));
    }

    /**
     * The v3 sections — {@code requestedAction}, {@code tone}, {@code filters}, {@code target}.
     *
     * <p><b>Absent is the default, and an unknown token is the default too — never a refusal.</b> A
     * v2 model answer, or a v3 answer that invents a period, still yields a plan whose reading part is
     * intact; what it loses is only the refinement. Refusing the whole plan over a filter token would
     * make a conversation fail on the one field that matters least to its correctness. The closed sets
     * live on {@link AgentPlanPrompt} so the words the model is offered and the words accepted back are
     * one list.
     */
    private static String closedOr(JsonNode node, String field, String[] allowed, String fallback) {
        if (node == null) {
            return fallback;
        }
        String value = optionalText(node, field, MAX_TOOL_NAME);
        if (value == null) {
            return fallback;
        }
        for (String candidate : allowed) {
            if (candidate.equals(value)) {
                return candidate;
            }
        }
        return fallback;
    }

    private static PlanFilters filters(JsonNode node) {
        if (node == null || !node.isObject()) {
            return PlanFilters.none();
        }
        return new PlanFilters(
                closedOr(node, "period", AgentPlanPrompt.PERIODS, null),
                periodDaysOr(node),
                closedOr(node, "rating", AgentPlanPrompt.RATINGS, null),
                closedOr(node, "channel", AgentPlanPrompt.CHANNELS, null),
                closedOr(node, "scope", AgentPlanPrompt.SCOPES, null),
                closedOr(node, "topic", AgentPlanPrompt.TOPICS, null),
                closedOr(node, "reviewIntent", AgentPlanPrompt.REVIEW_INTENTS, null),
                closedOr(node, "inquiryIntent", AgentPlanPrompt.INQUIRY_INTENTS, null),
                closedOr(node, "capabilityAspect", AgentPlanPrompt.CAPABILITY_ASPECTS, null),
                limitOr(node, "limit"),
                closedOr(node, "order", AgentPlanPrompt.ORDERS, null),
                closedOr(node, "status", AgentPlanPrompt.STATUSES, null));
    }

    /**
     * The trailing day count behind {@code period=LAST_N_DAYS} — the one axis value that is a number
     * rather than a token, because the thing it represents is one (「최근 3일」). Clamped, and dropped
     * entirely unless the period token that needs it is the one the model chose: a count beside 「오늘」
     * would be a second period nobody named.
     */
    private static Integer periodDaysOr(JsonNode node) {
        if (!"LAST_N_DAYS".equals(closedOr(node, "period", AgentPlanPrompt.PERIODS, null))) {
            return null;
        }
        JsonNode value = node.get("periodDays");
        if (value == null || !value.isInt() || value.asInt() < 1) {
            return null;
        }
        return Math.min(value.asInt(), AgentPlanPrompt.MAX_PERIOD_DAYS);
    }

    /** A positive integer row limit, clamped to {@link AgentPlanPrompt#MAX_LIMIT}; anything else is null. */
    private static Integer limitOr(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isInt() || value.asInt() < 1) {
            return null;
        }
        return Math.min(value.asInt(), AgentPlanPrompt.MAX_LIMIT);
    }

    private static PlanTarget target(JsonNode node) {
        if (node == null || !node.isObject()) {
            return PlanTarget.none();
        }
        String selector = closedOr(node, "selector", AgentPlanPrompt.TARGET_SELECTORS, "NONE");
        JsonNode index = node.get("index");
        // An index only means something for NTH, and only as a positive ordinal; anything else is
        // "no index", which the runtime treats as "ask which one".
        Integer ordinal = index != null && index.isInt() && index.asInt() > 0 ? index.asInt() : null;
        return new PlanTarget(selector, "NTH".equals(selector) ? ordinal : null);
    }

    /** Needs; a wrong-typed array is a refusal, a missing one is empty. Blank ids/questions dropped. */
    private static List<ParsedNeed> needs(JsonNode node) {
        if (node == null || node.isNull()) {
            return List.of();
        }
        if (!node.isArray()) {
            return null;
        }
        List<ParsedNeed> out = new ArrayList<>();
        for (JsonNode item : node) {
            if (!item.isObject() || out.size() >= MAX_LIST) {
                continue;
            }
            String id = optionalText(item, "id", MAX_TOOL_NAME);
            String question = optionalText(item, "question", MAX_REASON);
            if (id == null || question == null) {
                continue;
            }
            out.add(new ParsedNeed(id, question, optionalText(item, "kind", MAX_TOOL_NAME),
                    optionalText(item, "why", MAX_REASON), item.path("required").asBoolean(true)));
        }
        return List.copyOf(out);
    }

    private static List<ParsedMention> mentions(JsonNode node) {
        if (node == null || node.isNull()) {
            return List.of();
        }
        if (!node.isArray()) {
            return null;
        }
        List<ParsedMention> out = new ArrayList<>();
        for (JsonNode item : node) {
            if (!item.isObject() || out.size() >= MAX_LIST) {
                continue;
            }
            String mention = optionalText(item, "mention", MAX_REASON);
            if (mention != null) {
                out.add(new ParsedMention(optionalText(item, "kind", MAX_TOOL_NAME), mention));
            }
        }
        return List.copyOf(out);
    }

    private static List<ParsedEvidenceRequirement> requirements(JsonNode node) {
        if (node == null || node.isNull()) {
            return List.of();
        }
        if (!node.isArray()) {
            return null;
        }
        List<ParsedEvidenceRequirement> out = new ArrayList<>();
        for (JsonNode item : node) {
            if (!item.isObject() || out.size() >= MAX_LIST) {
                continue;
            }
            String needId = optionalText(item, "needId", MAX_TOOL_NAME);
            if (needId == null) {
                continue;
            }
            List<String> kinds = strings(item.get("acceptableKinds"));
            out.add(new ParsedEvidenceRequirement(needId, item.path("minEvidence").asInt(1),
                    kinds == null ? List.of() : kinds));
        }
        return List.copyOf(out);
    }

    /** A non-negative int, or 0 when absent/wrong-typed. The runtime clamps it to the system budget. */
    private static int intOr(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isInt() && value.asInt() > 0 ? value.asInt() : 0;
    }

    /** A validated evidence verdict. Every field must be present and typed; a missing one is a refusal. */
    public static Optional<ParsedVerdict> parseVerdict(String assistantText) {
        JsonNode node = object(assistantText);
        if (node == null) {
            return Optional.empty();
        }
        JsonNode hasEvidence = node.get("hasEvidence");
        JsonNode unsafe = node.get("unsafeAssertion");
        JsonNode needsMore = node.get("needsMore");
        if (hasEvidence == null || !hasEvidence.isBoolean()
                || unsafe == null || !unsafe.isBoolean()
                || needsMore == null || !needsMore.isBoolean()) {
            return Optional.empty();
        }
        List<String> supporting = strings(node.get("supportingEvidenceIds"));
        if (supporting == null) {
            return Optional.empty();
        }
        return Optional.of(new ParsedVerdict(
                hasEvidence.asBoolean(),
                supporting,
                unsafe.asBoolean(),
                optionalText(node, "unsafeReason", MAX_REASON),
                needsMore.asBoolean(),
                optionalText(node, "needsMoreTool", MAX_TOOL_NAME),
                optionalText(node, "needsMoreReason", MAX_REASON)));
    }

    private static JsonNode object(String assistantText) {
        if (assistantText == null) {
            return null;
        }
        String text = stripFence(assistantText.trim());
        if (!text.startsWith("{")) {
            return null;
        }
        try {
            JsonNode node = MAPPER.readTree(text);
            return node.isObject() ? node : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** A JSON array of non-blank strings, bounded. A missing array is an empty list; a wrong type is null. */
    private static List<String> strings(JsonNode node) {
        if (node == null || node.isNull()) {
            return List.of();
        }
        if (!node.isArray()) {
            return null;
        }
        List<String> out = new ArrayList<>();
        for (JsonNode item : node) {
            if (!item.isTextual()) {
                return null;
            }
            String value = item.asText().trim();
            if (!value.isEmpty() && value.length() <= MAX_TOOL_NAME && out.size() < MAX_LIST) {
                out.add(value);
            }
        }
        return List.copyOf(out);
    }

    /** A non-blank string field, truncated to {@code max}; null when absent, blank, or not textual. */
    private static String optionalText(JsonNode node, String field, int max) {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual()) {
            return null;
        }
        String s = value.asText().trim();
        if (s.isEmpty()) {
            return null;
        }
        return s.length() <= max ? s : s.substring(0, max);
    }

    /** Strip a ```json … ``` wrapper, the one deviation that changes nothing about the content. */
    /**
     * Strip a ```json fence a model added despite being told not to.
     *
     * <p>Public because the inquiry-signature capability parses its own two-label schema and would
     * otherwise copy this — and a second copy of "which fences do models actually emit" is a second
     * place to be wrong about it.
     */
    public static String stripFence(String text) {
        if (!text.startsWith("```")) {
            return text;
        }
        int firstNewline = text.indexOf('\n');
        int lastFence = text.lastIndexOf("```");
        if (firstNewline < 0 || lastFence <= firstNewline) {
            return text;
        }
        return text.substring(firstNewline + 1, lastFence).trim();
    }

    /** A validated plan: which specialists, which tools, and an optional product the goal named. */
    public record ParsedPlan(boolean supported, String userGoal, List<ParsedMention> unresolvedEntities,
                             List<ParsedNeed> informationNeeds, List<String> specialists,
                             List<String> tools, List<String> retrievalOrder,
                             List<String> retrievalParallel, String retrievalStopWhen,
                             List<ParsedEvidenceRequirement> evidenceRequirements, String riskClass,
                             int maxIterations, int maxToolCalls, String stopWhenEnough,
                             boolean clarificationNeeded, String clarificationReason, String rationale,
                             String requestedAction, String tone, PlanFilters filters, PlanTarget target) {
    }

    /**
     * How the sentence narrows what is read — closed tokens only. {@code scope=WORKING_SET} means
     * "over what the previous turn produced"; the runtime, not this parser, knows what that was.
     */
    public record PlanFilters(String period, Integer periodDays, String rating, String channel, String scope,
                              String topic, String reviewIntent, String inquiryIntent, String capabilityAspect,
                              Integer limit,
                              String order, String status) {
        public static PlanFilters none() {
            return new PlanFilters(null, null, null, null, null, null, null, null, null, null, null, null);
        }
    }

    /** Which member of the working set the seller meant. {@code index} is set only for {@code NTH}. */
    public record PlanTarget(String selector, Integer index) {
        public static PlanTarget none() {
            return new PlanTarget("NONE", null);
        }
    }

    /** One thing the seller named, in their own words. There is deliberately no id field. */
    public record ParsedMention(String kind, String mention) {
    }

    /** One thing the plan needs to find out. */
    public record ParsedNeed(String id, String question, String kind, String why, boolean required) {
    }

    /** How much evidence one need requires before its answer may be stated. */
    public record ParsedEvidenceRequirement(String needId, int minEvidence, List<String> acceptableKinds) {
    }

    /** A validated verdict over one finding. */
    public record ParsedVerdict(boolean hasEvidence, List<String> supportingEvidenceIds,
                                boolean unsafeAssertion, String unsafeReason,
                                boolean needsMore, String needsMoreTool, String needsMoreReason) {
    }
}
