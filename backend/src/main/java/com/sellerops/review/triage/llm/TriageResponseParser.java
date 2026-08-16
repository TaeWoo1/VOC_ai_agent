package com.sellerops.review.triage.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.itemanalysis.ItemAnalysisCategories;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.TriageReasonCode;
import com.sellerops.review.triage.llm.ReviewTriageClassifier.Result;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;

/**
 * Turns a model's answer into a {@link Result}, or into a visible failure.
 *
 * <p><b>It repairs nothing.</b> RUBRIC v2 §8.5: an unknown tier, an unknown reason code, a third
 * tag, an unknown tag, an unknown action, a missing field or prose wrapped around the JSON all
 * produce {@link ReviewTriageClassifier.Status#UNCLASSIFIED}. The temptation is obvious — most of
 * these are one line to fix — and it is the wrong move for a measured reason: a harness that repairs
 * responses reports the quality of the repair, and the repair is not what would run in production
 * six months later when the model's habits have changed.
 *
 * <p><b>No path returns {@code FYI}.</b> {@code FYI} means "nothing here for the seller". A parse
 * failure that produced it would dismiss a real review silently and look exactly like a judgment.
 *
 * <p>Failure reasons name <b>what was wrong with the shape</b>, never what the review said. A
 * message quoting the offending value would put model-echoed review text into a log line.
 */
public final class TriageResponseParser {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int MAX_TAGS = 2;

    /**
     * @param raw the model's message text, exactly as returned
     */
    public static Result parse(String raw, String version) {
        if (raw == null || raw.isBlank()) {
            return Result.unclassified(version, "empty response");
        }
        JsonNode root;
        try {
            root = MAPPER.readTree(raw.strip());
        } catch (Exception e) {
            // Deliberately NOT "find the first { and the last }". That substring rescue is what makes
            // a model's habit of adding a preamble invisible until the habit changes.
            return Result.unclassified(version, "response is not a JSON document");
        }
        if (!root.isObject()) {
            return Result.unclassified(version, "response is not a JSON object");
        }
        for (String required : List.of("tier", "reasonCode", "tags", "suggestedNextAction")) {
            if (!root.has(required)) {
                return Result.unclassified(version, "missing field: " + required);
            }
        }

        ReviewTriageTier tier;
        try {
            tier = ReviewTriageTier.valueOf(root.path("tier").asText("").strip());
        } catch (IllegalArgumentException e) {
            // Catches UNCERTAIN too, which is not a ReviewTriageTier at all — §2 gives it to a human
            // who cannot decide, and a model using it would be opting out of being scored.
            return Result.unclassified(version, "unknown tier");
        }

        Optional<TriageReasonCode> reason = TriageReasonCode.parse(root.path("reasonCode").asText(null));
        if (reason.isEmpty()) {
            return Result.unclassified(version, "unknown reasonCode");
        }
        Optional<TriageSuggestedAction> action =
                TriageSuggestedAction.parse(root.path("suggestedNextAction").asText(null));
        if (action.isEmpty()) {
            return Result.unclassified(version, "unknown suggestedNextAction");
        }

        JsonNode tagsNode = root.path("tags");
        if (!tagsNode.isArray()) {
            return Result.unclassified(version, "tags is not an array");
        }
        List<String> tags = new ArrayList<>();
        for (JsonNode tag : tagsNode) {
            String value = tag.asText(null);
            if (value == null || !ItemAnalysisCategories.SUPPORTED.contains(value)) {
                return Result.unclassified(version, "unknown tag");
            }
            tags.add(value);
        }
        if (tags.size() > MAX_TAGS) {
            // Truncating to two would be the single most tempting repair here, and it would hide a
            // model that had stopped honouring the limit — which is a fact about the candidate.
            return Result.unclassified(version, "more than " + MAX_TAGS + " tags");
        }
        if (new LinkedHashSet<>(tags).size() != tags.size()) {
            return Result.unclassified(version, "repeated tag");
        }

        return Result.ok(tier, reason.get().name(), tags, action.get(), version);
    }

    private TriageResponseParser() {
    }
}
