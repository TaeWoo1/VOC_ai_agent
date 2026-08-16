package com.sellerops.review.triage.eval;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.itemanalysis.ItemAnalysisCategories;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The leak guard on the two artifacts a labeling session commits.
 *
 * <p>The rule these files live under is that they carry <b>fingerprints and closed-vocabulary human
 * judgments, and nothing else</b> (RUBRIC v2 §5). That rule is enforced by a Node script the
 * operator runs; this is the copy that runs in CI, on the committed bytes, after the fact — because
 * the failure it guards against is a person hand-editing a label in, or a future field being added
 * with the best of intentions, and neither of those goes through the script.
 *
 * <p>The strongest check here is the last one: <b>every enum value must appear in the rubric</b>.
 * Free text cannot pass it, because free text is not a token the contract names.
 */
class CommittedLabelSchemaTest {

    private static final Path DIR = Path.of("..", "contracts", "review-eval", "naver", "v2");
    private static final Pattern FINGERPRINT = Pattern.compile("^[0-9a-f]{64}$");
    /** Backticked ALL_CAPS tokens — how the rubric writes every vocabulary value it defines. */
    private static final Pattern RUBRIC_TOKEN = Pattern.compile("`([A-Z][A-Z_]{2,})`");

    private static JsonNode read(String name) throws Exception {
        Path path = DIR.resolve(name);
        return Files.exists(path) ? new ObjectMapper().readTree(Files.readString(path)) : null;
    }

    private static Set<String> rubricVocabulary() throws Exception {
        Set<String> tokens = new HashSet<>();
        Matcher matcher = RUBRIC_TOKEN.matcher(Files.readString(DIR.resolve("RUBRIC.md")));
        while (matcher.find()) {
            tokens.add(matcher.group(1));
        }
        return tokens;
    }

    /** Every string in the tree except the ones under `_comment`, which is prose about the file. */
    private static List<String> values(JsonNode node, String field, List<String> into) {
        if (node.isObject()) {
            node.fields().forEachRemaining(e -> {
                if (!"_comment".equals(e.getKey())) {
                    values(e.getValue(), e.getKey(), into);
                }
            });
        } else if (node.isArray()) {
            node.forEach(child -> values(child, field, into));
        } else if (node.isTextual()) {
            into.add(node.asText());
        }
        return into;
    }

    @org.junit.jupiter.params.ParameterizedTest(name = "{0}")
    @org.junit.jupiter.params.provider.ValueSource(strings = {"labels.json", "pilot-labels.json"})
    @DisplayName("a label file carries only the fields the contract admits")
    void labelsCarryOnlyTheCommittedSchema(String file) throws Exception {
        JsonNode root = read(file);
        assertThat(root).as("%s must exist", file).isNotNull();
        Set<String> allowed = Set.of("reviewIdFingerprint", "tier", "reasonCode", "tags", "source");
        Set<String> tiers = Set.of("NEEDS_ATTENTION", "WATCH", "FYI", "UNCERTAIN");
        Set<String> sources = Set.of("OWNER", "ANNOTATOR", "ADJUDICATED");

        for (JsonNode entry : root.path("labels")) {
            List<String> fields = new ArrayList<>();
            entry.fieldNames().forEachRemaining(fields::add);
            assertThat(fields).as("fields of a label entry").isSubsetOf(allowed);
            assertThat(entry.path("reviewIdFingerprint").asText()).matches(FINGERPRINT);
            assertThat(entry.path("tier").asText()).isIn(tiers);
            assertThat(entry.path("source").asText()).isIn(sources);
            for (JsonNode tag : entry.path("tags")) {
                assertThat(tag.asText()).isIn(ItemAnalysisCategories.SUPPORTED);
            }
            assertThat(entry.path("tags").size()).as("at most two tags").isLessThanOrEqualTo(2);
            if ("UNCERTAIN".equals(entry.path("tier").asText())) {
                // Excluded from every metric (v1 §4). A reason or a tag beside it invites a later count.
                assertThat(entry.has("reasonCode")).isFalse();
                assertThat(entry.path("tags")).isEmpty();
            }
        }
    }

    @Test
    @DisplayName("agreement.json carries two judgments per overlap row and nothing about the review")
    void agreementCarriesOnlyJudgments() throws Exception {
        JsonNode root = read("agreement.json");
        if (root == null) {
            return; // Written by the labeling session; absent until one has run.
        }
        Set<String> allowed = Set.of("reviewIdFingerprint", "owner", "annotator", "agree");
        for (JsonNode pair : root.path("pairs")) {
            List<String> fields = new ArrayList<>();
            pair.fieldNames().forEachRemaining(fields::add);
            assertThat(fields).as("fields of an agreement pair").isSubsetOf(allowed);
            assertThat(pair.path("reviewIdFingerprint").asText()).matches(FINGERPRINT);
        }
        assertThat(root.path("minBinaryKappa").asDouble())
                .as("the pre-committed bar must not drift")
                .isEqualTo(0.60);
    }

    /**
     * The check free text cannot survive.
     *
     * <p>A review body is Korean prose. A label file may hold only fingerprints, tokens the rubric
     * itself names, and the nine stored category names — so anything else is either a leak or a
     * vocabulary that was added without the contract being updated, and both should stop a build.
     */
    @Test
    @DisplayName("every string in the committed files is a fingerprint, a rubric token, or a stored tag")
    void nothingUnrecognisableSurvives() throws Exception {
        Set<String> vocabulary = rubricVocabulary();
        assertThat(vocabulary).as("the rubric must define the vocabulary this test checks against")
                .contains("NEEDS_ATTENTION", "PRAISE_WITH_CONCESSION", "ANNOTATOR");

        for (String name : List.of("labels.json", "pilot-labels.json", "agreement.json")) {
            JsonNode root = read(name);
            if (root == null) {
                continue;
            }
            for (String value : values(root.path("labels").isMissingNode() ? root.path("pairs")
                    : root.path("labels"), null, new ArrayList<>())) {
                assertThat(recognised(value, vocabulary))
                        .as("%s holds a value the contract does not define: %s", name,
                                value.length() > 24 ? value.substring(0, 24) + "…" : value)
                        .isTrue();
            }
        }
    }

    /**
     * The same test, on values the committed files do not contain yet.
     *
     * <p>Both files ship empty, so every assertion above passes over zero rows — which is exactly the
     * shape of a guard that will still pass after it has stopped working. This one runs the
     * recognition rule against what a leak would actually look like.
     */
    @Test
    @DisplayName("the recognition rule rejects prose, and would reject it in a label file too")
    void theGuardIsNotVacuous() throws Exception {
        Set<String> vocabulary = rubricVocabulary();
        assertThat(recognised("a".repeat(64), vocabulary)).as("a fingerprint").isTrue();
        assertThat(recognised("NEEDS_ATTENTION", vocabulary)).as("a rubric token").isTrue();
        assertThat(recognised("배송", vocabulary)).as("a stored category").isTrue();

        assertThat(recognised("포장이 찌그러져서 왔어요", vocabulary)).as("a review body").isFalse();
        assertThat(recognised("고객이 화가 난 것 같음", vocabulary)).as("a free-text rationale").isFalse();
        assertThat(recognised("2026-08-16", vocabulary)).as("a date").isFalse();
        assertThat(recognised("1234567890", vocabulary)).as("a raw 리뷰글번호").isFalse();
        assertThat(recognised("무선 이어폰", vocabulary)).as("a product name").isFalse();
    }

    private static boolean recognised(String value, Set<String> vocabulary) {
        return FINGERPRINT.matcher(value).matches()
                || vocabulary.contains(value)
                || ItemAnalysisCategories.SUPPORTED.contains(value);
    }
}
