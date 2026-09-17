package com.sellerops.knowledge.quality;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ReviewIdFingerprint;
import com.sellerops.operationscase.CaseDisposition;
import com.sellerops.operationscase.OperationsCase;
import com.sellerops.operationscase.OperationsCaseKind;
import com.sellerops.operationscase.OperationsCaseRules;
import com.sellerops.operationscase.OperationsCaseStatus;
import com.sellerops.operationscase.OperationsSubjectKind;
import com.sellerops.operationscase.investigation.CaseInvestigator;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.triage.ReviewTriageTier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * <b>Review Disposition Quality v1 — the agent leg.</b> The reviews the rules hand to the investigator, run through
 * the real investigator (the real tools, the real Knowledge Spine assessment, the real guard, the real model) and
 * scored against the same human labels.
 *
 * <p><b>Gated, and deliberately expensive to start.</b> {@code RUN_REVIEW_DISPOSITION_AGENT=true} plus a database this
 * backend may migrate (a disposable clone — never the development database) and the investigation capability's own
 * environment. Every run spends one model call per review, so the sample is bounded by
 * {@code REVIEW_DISPOSITION_AGENT_MAX} (default 20).
 *
 * <p>It writes nothing but the model-usage rows the capability charges: the case it investigates is a transient
 * object, no case row is saved, and no channel is called.
 */
@EnabledIfEnvironmentVariable(named = "RUN_REVIEW_DISPOSITION_AGENT", matches = "true")
@SpringBootTest
class ReviewDispositionAgentIT {

    private static final Path LABELS = Path.of("..", "contracts", "review-eval", "naver", "v2", "labels.json");

    @Autowired ReviewRepository reviews;
    @Autowired CaseInvestigator investigator;

    @Test
    @DisplayName("what the agent decides about the reviews the rules could not settle")
    void measureAgentDispositions() throws Exception {
        Map<String, ReviewTriageTier> labels = readLabels();
        int max = Integer.parseInt(System.getenv().getOrDefault("REVIEW_DISPOSITION_AGENT_MAX", "20"));

        List<Review> candidates = new ArrayList<>();
        for (Review review : reviews.findAll()) {
            String fingerprint = ReviewIdFingerprint.of(review.getExternalId());
            if (fingerprint == null || !labels.containsKey(fingerprint)) {
                continue;
            }
            if (OperationsCaseRules.forReview(review.getRating(), review.getBody(), review.getReplyState())
                    .needsInvestigation()) {
                candidates.add(review);
            }
        }

        Map<String, Integer> byDisposition = new LinkedHashMap<>();
        Map<String, Integer> guards = new LinkedHashMap<>();
        Map<String, Integer> outcomes = new LinkedHashMap<>();
        int falseAutoResolved = 0;
        int investigated = 0;
        for (Review review : candidates.stream().limit(max).toList()) {
            CaseInvestigator.Outcome outcome = investigator.investigate(caseFor(review), UUID.randomUUID());
            outcomes.merge(outcome.kind().name(), 1, Integer::sum);
            if (outcome.applied() == null) {
                continue;
            }
            investigated++;
            CaseDisposition disposition = outcome.applied().disposition();
            byDisposition.merge(disposition.name(), 1, Integer::sum);
            outcome.applied().guards().forEach(guard -> guards.merge(guard, 1, Integer::sum));
            ReviewTriageTier gold = labels.get(ReviewIdFingerprint.of(review.getExternalId()));
            if (disposition == CaseDisposition.AUTO_RESOLVED && gold != ReviewTriageTier.FYI) {
                falseAutoResolved++;
            }
        }

        System.out.printf("%n  review-disposition/v1 — agent leg%n"
                        + "    reviews the rules handed over  %d (scored: %d)%n"
                        + "    investigation outcomes         %s%n"
                        + "    agent disposition              %s%n"
                        + "    guards applied                 %s%n"
                        + "    FALSE AUTO_RESOLVED            %d%n%n",
                candidates.size(), investigated, outcomes, byDisposition, guards, falseAutoResolved);

        assertThat(candidates).as("the labelled corpus must be readable from this database").isNotEmpty();
    }

    /** A transient case, exactly as the processor would hand one over. Nothing is saved. */
    private static OperationsCase caseFor(Review review) {
        OperationsCase c = new OperationsCase();
        c.setId(UUID.randomUUID());
        c.setOrgId(review.getOrgId());
        c.setCaseKind(OperationsCaseKind.CUSTOMER_WORK);
        c.setSubjectKind(OperationsSubjectKind.REVIEW);
        c.setSubjectId(review.getId());
        c.setChannelId(review.getChannelId());
        c.setProductId(review.getProductId());
        c.setStatus(OperationsCaseStatus.PREPARED);
        return c;
    }

    private static Map<String, ReviewTriageTier> readLabels() throws Exception {
        JsonNode doc = new ObjectMapper().readTree(Files.readString(LABELS));
        Map<String, ReviewTriageTier> labels = new LinkedHashMap<>();
        for (JsonNode label : doc.path("labels")) {
            String tier = label.path("tier").asText();
            if (!"UNCERTAIN".equals(tier)) {
                labels.put(label.path("reviewIdFingerprint").asText(), ReviewTriageTier.valueOf(tier));
            }
        }
        return labels;
    }
}
