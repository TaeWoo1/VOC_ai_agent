package com.sellerops.inquiry.decision;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The calibration set sends needs exactly as production numbers them. The first real calibration run (apr-80adf54f)
 * sent the gold ids ({@code n1}) verbatim; the judge answered {@code N1}, the engine found no verdict for {@code n1},
 * and 11–40 of 72 needs were silently scored NONE. This pins the shape and the round trip.
 */
class CalibrationVariantsTest {

    static final ObjectMapper JSON = new ObjectMapper();

    @Test
    @DisplayName("needs go out as N1, N2 … and come back to their gold ids; a judge answering N1 is matched")
    void productionShapedIds() throws Exception {
        UUID product = UUID.randomUUID();
        UUID source = UUID.randomUUID();
        JsonNode captured = JSON.readTree("""
                {"q":"S:x","question":"질문","product":"%s",
                 "needs":[{"id":"n1","ask":"a","type":"PRODUCT_SPEC"},{"id":"n2","ask":"b","type":"POLICY"}],
                 "evidence":[{"id":"E1","kind":"PRODUCT_KNOWLEDGE","label":"t","text":"x","source":"%s","product":null}],
                 "precedents":[]}""".formatted(product, source));
        Map<String, JsonNode> gold = Map.of(
                "S:x.n1", JSON.readTree("{\"sets\":[{\"refs\":[\"PK:%s\"],\"suff\":\"FULL\"}],\"family_sets\":[]}"
                        .formatted(source.toString().substring(0, 8))),
                "S:x.n2", JSON.readTree("{\"sets\":[],\"family_sets\":[]}"));

        CalibrationVariants.Row row = CalibrationVariants.row(captured);
        assertThat(row.needs()).extracting(InquiryNeed::id).containsExactly("N1", "N2");
        assertThat(row.goldId()).containsEntry("N1", "n1").containsEntry("N2", "n2");

        CalibrationVariants.Variant original = CalibrationVariants.build(List.of(row), gold, Set.of()).get(0);
        assertThat(original.gold()).containsEntry("N1", NeedStatus.FULL).containsEntry("N2", NeedStatus.NONE);

        Map<String, NeedVerdict> judged = InquiryDecisionGenerator.parseJudge("""
                {"verdicts":[{"need":"N1","status":"FULL","evidence":["E1"]},{"need":"N2","status":"NONE","evidence":[]}]}""");
        Map<String, EvidenceCandidate> evidence = Map.of("E1", original.evidence().get(0));
        List<NeedResult> results = NeedAggregation.enforce(original.needs(), judged, evidence, Map.of(),
                DetailCapability.READABLE, product);
        assertThat(results).extracting(NeedResult::enforcement).as("no need left unjudged").doesNotContain(
                NeedResult.Enforcement.NOT_JUDGED);
        assertThat(results.get(0).status()).isEqualTo(NeedStatus.FULL);
    }
}
