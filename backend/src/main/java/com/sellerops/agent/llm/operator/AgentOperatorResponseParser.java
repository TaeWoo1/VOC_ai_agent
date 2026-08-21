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
                optionalText(node, "rationale", MAX_REASON)));
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
                             boolean clarificationNeeded, String clarificationReason, String rationale) {
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
