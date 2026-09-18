package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.operationscase.investigation.CaseInvestigator;
import com.sellerops.responsibility.Responsibility;
import com.sellerops.responsibility.ResponsibilityRepository;
import com.sellerops.responsibility.ResponsibilityRun;
import com.sellerops.responsibility.ResponsibilityRunRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.media.ReviewMedia;
import com.sellerops.review.media.ReviewMediaRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * <b>M3 live proof harness</b> (Customer Ops Demo Closure v1) — one real NAVER review with photos, already read by the
 * scheduled Aside observation into a disposable proof database, investigated by the production investigator.
 *
 * <p><b>The one substituted step:</b> the case is opened here, for the named review, the way
 * {@code OperationsCaseProcessor#newCase} opens one. The processor would not open it on its own, correctly: every review
 * present at a source's first settled read is treated as already handed over. Everything after the opening is the
 * production path — the investigator's tools (photo inspection through {@code ReviewMediaInspector}, knowledge, issues,
 * decisions), the guard, and {@code OperationsCaseProcessor#recordInvestigation}.
 *
 * <p>Gated: {@code RUN_REVIEW_MEDIA_LIVE_PROOF=true} and {@code M3_REVIEW_ID}, against a database this backend may
 * migrate. It calls the vision model (≤3) and the investigation model (1). It writes only to that database.
 */
@EnabledIfEnvironmentVariable(named = "RUN_REVIEW_MEDIA_LIVE_PROOF", matches = "true")
@SpringBootTest
class ReviewMediaLiveProofIT {

    @Autowired ReviewRepository reviews;
    @Autowired ReviewMediaRepository media;
    @Autowired ResponsibilityRepository responsibilities;
    @Autowired ResponsibilityRunRepository runs;
    @Autowired OperationsCaseRepository cases;
    @Autowired OperationsCaseEventRepository events;
    @Autowired CaseInvestigator investigator;
    @Autowired OperationsCaseProcessor processor;

    @Test
    void oneRealImageReviewEndToEnd() {
        UUID reviewId = UUID.fromString(System.getenv("M3_REVIEW_ID"));
        Review review = reviews.findById(reviewId).orElseThrow();
        UUID orgId = review.getOrgId();
        Responsibility responsibility = responsibilities.findAll().stream()
                .filter(r -> orgId.equals(r.getOrgId())).findFirst().orElseThrow();
        ResponsibilityRun run = runs.findTop20ByResponsibilityIdOrderByWindowStartDesc(responsibility.getId()).get(0);

        OperationsCaseRules.Conclusion rule =
                OperationsCaseRules.forReview(review.getRating(), review.getBody(), review.getReplyState());
        String state = OperationsSignal.truncate(OperationsSignal.reviewState(review));
        OperationsCase c = new OperationsCase();
        c.setOrgId(orgId);
        c.setResponsibilityId(responsibility.getId());
        c.setOriginRunId(run.getId());
        c.setLastRunId(run.getId());
        c.setCaseKind(OperationsCaseKind.CUSTOMER_WORK);
        c.setSubjectKind(OperationsSubjectKind.REVIEW);
        c.setSubjectId(reviewId);
        c.setSignature(OperationsSignal.signature(orgId, OperationsSubjectKind.REVIEW, reviewId, state, null));
        c.setSourceState(state);
        c.setStatus(OperationsCaseStatus.PREPARED);
        c.setPreparedAction(CasePreparedAction.NONE);
        c.setChannelId(review.getChannelId());
        c.setProductId(review.getProductId());
        c.setReason(rule.reason());
        c.setReasonNote(rule.reason().noteKo());
        c.setPriority(rule.priority());
        c.setDecidedBy(CaseDecider.RULE);
        c.setDisposition(CaseDisposition.NEEDS_DECISION);
        c.setRequiredAuthority(RequiredAuthority.HUMAN);
        OperationsCase saved = cases.saveAndFlush(c);
        events.save(OperationsCaseEvent.of(saved, run.getId(), CaseEventActor.SYSTEM, CaseEventKind.OPENED,
                "decidedBy=RULE reason=" + rule.reason().name() + " opener=M3_PROOF_HARNESS"));

        CaseInvestigator.Outcome outcome = investigator.investigate(saved, run.getId());
        OperationsCase concluded = processor.recordInvestigation(saved, run.getId(), outcome);

        System.out.println("\n  M3 — one real NAVER image review");
        System.out.printf("    case %s  rule %s (needsInvestigation=%s)%n", concluded.getId(), rule.reason(),
                rule.needsInvestigation());
        for (ReviewMedia m : media.findByOrgIdAndReviewIdOrderByOrdinalAsc(orgId, reviewId)) {
            System.out.printf("    photo %d  kind=%s host=%s status=%s failure=%s model=%s problemVisible=%s%n"
                            + "      depicts: %s%n      problem: %s%n",
                    m.getOrdinal(), m.getMediaKind(), m.getSourceHost(), m.getInspectionStatus(),
                    m.getInspectionFailure(), m.getInspectionModel(), m.getProblemVisible(), m.getDepicts(),
                    m.getProblemDescription());
        }
        System.out.printf("    investigation %s (%s)%n", outcome.kind(), outcome.reason());
        if (outcome.output() != null) {
            System.out.printf("    disposition %s  action %s  confidence %s  guards %s%n    evidenceRefs %s%n"
                            + "    summary: %s%n    recommended: %s%n    missing: %s%n",
                    concluded.getDisposition(), outcome.output().recommendedActionType(),
                    outcome.output().confidence(), outcome.applied().guards(), outcome.output().evidenceRefs(),
                    outcome.output().summary(), outcome.output().recommendedAction(),
                    outcome.output().missingInformation());
        }
        System.out.printf("    provenance %s%n%n", outcome.provenance());
        assertThat(outcome).isNotNull();
    }
}
