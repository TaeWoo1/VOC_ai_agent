package com.sellerops.agent.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Arrays;
import java.util.Optional;

/**
 * Turn a vendor response into a draft, or into nothing.
 *
 * <p><b>Fail closed, field by field.</b> Every check below is a way a model has actually been seen to
 * answer: a code fence around the JSON, a category it invented, an empty body, a "sure, here you go"
 * preamble. The alternative to refusing each of them is a partial candidate — and a candidate with an
 * empty body or an unknown category is worse than none, because it reaches a human as a draft that
 * looks reviewed and is not. There is no repair pass and no second call: a malformed answer is a
 * refusal, and the caller falls back to the deterministic rule drafter.
 *
 * <p><b>Nothing here is logged.</b> The parsed values ARE the seller's draft; a parse failure is
 * reported as an enum by the caller, never as the text that failed to parse.
 */
public final class AgentDraftResponseParser {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** The most a starter draft may be. Longer means the model wrote an essay, or ran away. */
    private static final int MAX_TITLE = 200;
    private static final int MAX_COMMENTS = 2000;

    private AgentDraftResponseParser() {
    }

    /**
     * The assistant text out of either vendor's envelope. Anthropic puts it at
     * {@code content[0].text}; OpenAI at {@code choices[0].message.content}. Both spellings are read
     * because the vendor is configuration ({@code sellerops.agent.draft.vendor}), exactly as it is
     * for triage — the adapter that happened to be written first must not become the decision.
     */
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
     * Parse the assistant's text into a validated draft.
     *
     * <p>A leading/trailing code fence is stripped first — it is the single most common deviation and
     * it changes nothing about the content, so refusing it would be refusing a well-formed answer for
     * a wrapper. Anything else that is not exactly the three-field object is refused.
     */
    public static Optional<ParsedDraft> parse(String assistantText) {
        if (assistantText == null) {
            return Optional.empty();
        }
        String text = stripFence(assistantText.trim());
        if (!text.startsWith("{")) {
            return Optional.empty();
        }
        try {
            JsonNode node = MAPPER.readTree(text);
            if (!node.isObject()) {
                return Optional.empty();
            }
            String category = text(node, "category");
            String title = text(node, "title");
            String comments = text(node, "comments");
            if (category == null || title == null || comments == null) {
                return Optional.empty();
            }
            if (Arrays.stream(AgentDraftPrompt.CATEGORIES).noneMatch(category::equals)) {
                return Optional.empty();
            }
            if (title.length() > MAX_TITLE || comments.length() > MAX_COMMENTS) {
                return Optional.empty();
            }
            return Optional.of(new ParsedDraft(category, title, comments));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual()) {
            return null;
        }
        String s = value.asText().trim();
        return s.isEmpty() ? null : s;
    }

    /** Strip a ```json … ``` (or bare ``` … ```) wrapper. Returns the input unchanged when there is none. */
    private static String stripFence(String text) {
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

    /** A validated draft. Every field is non-blank, and {@code category} is one of the closed set. */
    public record ParsedDraft(String category, String title, String comments) {
    }
}
