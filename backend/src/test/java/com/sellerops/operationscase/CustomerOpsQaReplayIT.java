package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.naver.NaverProductInquiryObservationRequest;
import com.sellerops.inquiry.naver.NaverProductInquiryObservationService;
import com.sellerops.knowledge.teach.CaseKnowledgeService;
import com.sellerops.knowledge.teach.dto.CaseDetailView;
import com.sellerops.knowledge.teach.dto.CaseTeachRequest;
import com.sellerops.responsibility.aside.AsideJobOutcome;
import com.sellerops.responsibility.aside.AsideRecipe;
import com.sellerops.responsibility.aside.ScheduledAsideJobService;
import com.sellerops.review.naver.NaverReviewObservationRequest;
import com.sellerops.review.naver.NaverReviewObservationService;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * <b>Customer Ops QA replay</b> (B/D/E/F) — historical REAL reviews and inquiries of a disposable clone, handed back to the
 * current ingest and Case path as if a scheduled observation had just read them. Results are {@code QA_REPLAY_PROVEN},
 * never LIVE: nothing here reads a marketplace.
 *
 * <p><b>What is replayed and what is not substituted.</b> The harness plays the device and nothing else: it queues,
 * claims, delivers and settles one observation job through the production {@link ScheduledAsideJobService} and the
 * production {@code deliver} of the NAVER review / product-inquiry observation services — the same entry the helper
 * calls with a page it read. From there every step is the product's: identity fence, canonical ingest and follow-up,
 * photo references, then {@link OperationsCaseProcessor#process} (discovery since the settled baseline, rules,
 * investigation, draft) and, for D, {@link CaseKnowledgeService#teach} (seller knowledge, re-investigation, re-draft).
 *
 * <p><b>Replay identity.</b> Each replayed row gets a fresh id in the 9-prefixed range so ingest's dedup does not skip
 * it as the original; its content (rating, words, product, photos, receipt time) is the original's. An inquiry replayed
 * for E was answered on the channel; it is replayed as the unanswered question it was when it arrived.
 *
 * <p>Gated: {@code RUN_QA_REPLAY=true}, against a database this backend may migrate and write. Model calls come from the
 * product capabilities the environment turns on (investigation, draft); vision is left to the environment too — with
 * it off, a photo is recorded as not looked at, which is what the investigation then says.
 */
@EnabledIfEnvironmentVariable(named = "RUN_QA_REPLAY", matches = "true")
@SpringBootTest
class CustomerOpsQaReplayIT {

    static final UUID ORG = UUID.fromString("7146c50f-ff6d-4c83-ae96-18c930e6d8e0");
    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** original id → replay id. */
    static final Map<String, String> PHASE1_REVIEWS = Map.of(
            "205bcf87-ab9c-4d34-a49d-caad89e5571a", "9000000001",   // B: 4★ 「접착력이 아쉽지만 만족합니다」
            "fba04785-6ad0-441c-8076-791c63b6429c", "9000000002");  // F: 5★ + photo 「…불량이면 말씀 드리겠습니다」
    static final String D_INQUIRY = "4f2aff24-a9bf-43a1-8043-379f1925c69c";   // 「종이컵 9oz 크기도 디스펜서…」
    static final String D_REPLAY_ID = "900000000001";
    static final String E_INQUIRY = "ace74426-f686-4469-953a-065a9a645855";   // 「10온스컵 사용 디스펜서는 없나요?」
    static final String E_REPLAY_ID = "900000000002";

    @Autowired JdbcTemplate jdbc;
    @Autowired ScheduledAsideJobService jobs;
    @Autowired NaverReviewObservationService reviewObservation;
    @Autowired NaverProductInquiryObservationService inquiryObservation;
    @Autowired OperationsCaseProcessor processor;
    @Autowired OperationsCaseRepository cases;
    @Autowired CaseKnowledgeService caseKnowledge;

    @Test
    @EnabledIfEnvironmentVariable(named = "QA_REPLAY_STEP", matches = "arrive")
    void replayBdef() {
        UUID device = jdbc.queryForObject("""
                select id from helper_devices where org_id = ? and revoked_at is null order by created_at desc limit 1
                """, UUID.class, ORG);
        UUID runId = jdbc.queryForObject("""
                select r.id from responsibility_run r join responsibility s on s.id = r.responsibility_id
                where s.org_id = ? order by r.window_start desc, r.created_at desc limit 1
                """, UUID.class, ORG);
        UUID owner = jdbc.queryForObject("select id from users where org_id = ? order by created_at limit 1",
                UUID.class, ORG);
        System.out.printf("%n  QA_REPLAY — org %s run %s device %s%n", ORG, runId, device);

        // ── phase 1: B, F (reviews) and D (inquiry) arrive ─────────────────────────────────────────────────────
        List<NaverReviewObservationRequest.Review> reviewRows = new ArrayList<>();
        PHASE1_REVIEWS.forEach((original, replay) -> reviewRows.add(reviewRow(original, replay)));
        reviewRows.sort((a, b) -> b.createdAt().compareTo(a.createdAt()));
        deliverReviews(device, runId, reviewRows);
        deliverInquiry(device, runId, inquiryRow(D_INQUIRY, D_REPLAY_ID));
        OperationsCaseProcessor.Report p1 = processor.process(runId, () -> false);
        System.out.printf("  phase 1 process: opened=%d ruleDecided=%d investigated=%d failed=%d drafts=%d%n",
                p1.opened(), p1.ruleDecided(), p1.investigated(), p1.investigationFailed(), p1.draftsPrepared());

        for (String replay : PHASE1_REVIEWS.values()) {
            print("REVIEW " + replay, caseFor("REVIEW", "reviews", replay));
        }
        UUID dCase = caseFor("INQUIRY", "inquiries", "naver-qna:" + D_REPLAY_ID);
        CaseDetailView d = print("D INQUIRY " + D_REPLAY_ID, dCase);

        // ── D: the seller answers the gap with their own past answer, through the case screen's path ───────────
        if (d != null && d.gap() != null) {
            String precedent = d.knowledgeUsed().stream()
                    .filter(k -> k.pastAnswer() && k.reusableText() != null)
                    .map(CaseDetailView.KnowledgeUsed::reusableText).findFirst().orElse(null);
            System.out.printf("  D gap: %s | precedent offered: %s%n", d.gap().sentence(), precedent != null);
            if (precedent != null) {
                CaseDetailView taught = caseKnowledge.teach(ORG, dCase, new CaseTeachRequest(precedent, "ORG"), owner,
                        "QA replay (seller's own past answer)");
                show("D after teach", taught.caseId(), taught);
            } else {
                System.out.println("  D: no seller text offered — Teach not performed (nothing is invented)");
            }
        }

        // ── phase 2: E — a later similar question arrives ───────────────────────────────────────────────────────
        deliverInquiry(device, runId, inquiryRow(E_INQUIRY, E_REPLAY_ID));
        OperationsCaseProcessor.Report p2 = processor.process(runId, () -> false);
        System.out.printf("  phase 2 process: opened=%d investigated=%d drafts=%d%n", p2.opened(), p2.investigated(),
                p2.draftsPrepared());
        print("E INQUIRY " + E_REPLAY_ID, caseFor("INQUIRY", "inquiries", "naver-qna:" + E_REPLAY_ID));
        System.out.println();
        assertThat(p1).isNotNull();
    }

    /**
     * <b>Step 2 — D taught with the seller's own words, then E.</b> The 10온스 case (replayed in step 1) is answered with
     * the answer the seller actually gave that exact question on the channel (read from answer memory, never written
     * here), company-wide because it is a statement about what the company makes. Then a later customer asks the 9oz
     * question again: does the taught standard reach that case, and is it applied or correctly held back?
     */
    @Test
    @EnabledIfEnvironmentVariable(named = "QA_REPLAY_STEP", matches = "teach")
    void teachThenSimilar() {
        UUID runId = jdbc.queryForObject("""
                select r.id from responsibility_run r join responsibility s on s.id = r.responsibility_id
                where s.org_id = ? order by r.window_start desc, r.created_at desc limit 1
                """, UUID.class, ORG);
        UUID device = jdbc.queryForObject("""
                select id from helper_devices where org_id = ? and revoked_at is null order by created_at desc limit 1
                """, UUID.class, ORG);
        UUID owner = jdbc.queryForObject("select id from users where org_id = ? order by created_at limit 1",
                UUID.class, ORG);
        UUID tenOz = caseFor("INQUIRY", "inquiries", "naver-qna:" + E_REPLAY_ID);
        String sellersAnswer = jdbc.queryForObject("""
                select a.answer_body from answer_memory a
                where a.org_id = ? and a.answer_body like '%10온스에 맞는 제품은 생산하고 있지 않습니다%'
                order by a.created_at limit 1
                """, String.class, ORG);
        System.out.printf("%n  QA_REPLAY step 2 — teach case %s with the seller's channel answer (%d chars)%n", tenOz,
                sellersAnswer.length());
        CaseDetailView taught = caseKnowledge.teach(ORG, tenOz, new CaseTeachRequest(sellersAnswer, "ORG"), owner,
                "QA replay (seller's own channel answer)");
        show("D taught (10온스)", tenOz, taught);

        deliverInquiry(device, runId, inquiryRow(D_INQUIRY, "900000000003"));
        OperationsCaseProcessor.Report p = processor.process(runId, () -> false);
        System.out.printf("  E process: opened=%d investigated=%d drafts=%d%n", p.opened(), p.investigated(),
                p.draftsPrepared());
        print("E later 9oz 900000000003", caseFor("INQUIRY", "inquiries", "naver-qna:900000000003"));
        System.out.println();
    }

    /**
     * <b>Step 3 — E, the same question from a later customer.</b> The 10온스 question arrives again under a fresh id after
     * the seller taught its answer in step 2: the case should be answered from that standard, without asking again.
     */
    @Test
    @EnabledIfEnvironmentVariable(named = "QA_REPLAY_STEP", matches = "again")
    void sameQuestionLater() {
        UUID runId = jdbc.queryForObject("""
                select r.id from responsibility_run r join responsibility s on s.id = r.responsibility_id
                where s.org_id = ? order by r.window_start desc, r.created_at desc limit 1
                """, UUID.class, ORG);
        UUID device = jdbc.queryForObject("""
                select id from helper_devices where org_id = ? and revoked_at is null order by created_at desc limit 1
                """, UUID.class, ORG);
        deliverInquiry(device, runId, inquiryRow(E_INQUIRY, "900000000004"));
        OperationsCaseProcessor.Report p = processor.process(runId, () -> false);
        System.out.printf("%n  E again process: opened=%d investigated=%d drafts=%d%n", p.opened(), p.investigated(),
                p.draftsPrepared());
        print("E again 10온스 900000000004", caseFor("INQUIRY", "inquiries", "naver-qna:900000000004"));
        System.out.println();
    }

    /**
     * <b>Step 4 — F with vision.</b> The photo review arrives again under a fresh id with the vision capability on for
     * this run: one CDN fetch and one vision call for its one photo, then the investigation that reads what was seen.
     */
    @Test
    @EnabledIfEnvironmentVariable(named = "QA_REPLAY_STEP", matches = "vision")
    void photoReviewWithVision() {
        UUID runId = jdbc.queryForObject("""
                select r.id from responsibility_run r join responsibility s on s.id = r.responsibility_id
                where s.org_id = ? order by r.window_start desc, r.created_at desc limit 1
                """, UUID.class, ORG);
        UUID device = jdbc.queryForObject("""
                select id from helper_devices where org_id = ? and revoked_at is null order by created_at desc limit 1
                """, UUID.class, ORG);
        deliverReviews(device, runId, List.of(reviewRow("fba04785-6ad0-441c-8076-791c63b6429c", "9000000003")));
        OperationsCaseProcessor.Report p = processor.process(runId, () -> false);
        System.out.printf("%n  F vision process: opened=%d ruleDecided=%d investigated=%d failed=%d%n", p.opened(),
                p.ruleDecided(), p.investigated(), p.investigationFailed());
        print("F vision 9000000003", caseFor("REVIEW", "reviews", "9000000003"));
        System.out.println();
    }

    /**
     * <b>Past Answer Prefill v1 — one historical question arrives again.</b> 「기존 원터치 디스펜서 제품의 투명한 부분과 아래쪽
     * 보라색 부분은 어떻게 분리하나요?」 was answered on the channel, and that answer is in answer memory. Its product has no
     * product knowledge and no company rule speaks to it, so the case should still ask — starting from that answer.
     *
     * <p>{@code QA_REPLAY_PREFILL_DRY=true} stops after the assessment (no model, no case processing): the same
     * assessor the investigation and the draft read, printed as its basis and precedent. The Teach step itself is done
     * by the seller in the browser, not here.
     */
    @Test
    @EnabledIfEnvironmentVariable(named = "QA_REPLAY_STEP", matches = "prefill")
    void pastAnswerPrefill() {
        UUID runId = jdbc.queryForObject("""
                select r.id from responsibility_run r join responsibility s on s.id = r.responsibility_id
                where s.org_id = ? order by r.window_start desc, r.created_at desc limit 1
                """, UUID.class, ORG);
        UUID device = jdbc.queryForObject("""
                select id from helper_devices where org_id = ? and revoked_at is null order by created_at desc limit 1
                """, UUID.class, ORG);
        // The original row is not in every clone, and it was bound to its product after the fact (no source ref), so
        // the question arrives as a customer would send it today: its words — read from the source database into a
        // local file, never committed — on the product's NAVER listing.
        String body;
        try {
            body = java.nio.file.Files.readString(java.nio.file.Path.of(System.getenv("QA_REPLAY_PREFILL_BODY_FILE"))).strip();
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
        String listing = jdbc.queryForObject("""
                select cp.external_product_id from channel_products cp join channels c on c.id = cp.channel_id
                join answer_memory m on m.product_id = cp.product_id
                where m.org_id = ? and m.id::text like '17dd221a%' and c.code = 'NAVER'
                """, String.class, ORG);
        deliverInquiry(device, runId, new NaverProductInquiryObservationRequest.Inquiry(PREFILL_REPLAY_ID,
                java.time.OffsetDateTime.now(KST).toString(), body, false, false, listing));
        UUID replayed = jdbc.queryForObject("select id from inquiries where org_id = ? and external_id = ?",
                UUID.class, ORG, "naver-qna:" + PREFILL_REPLAY_ID);
        com.sellerops.inquiry.draft.InquiryKnowledgeAssessor.Assessment a = assessor.assess(ORG,
                inquiries.findById(replayed).orElseThrow(), com.sellerops.order.fact.OrderFactLookup.STORED_ONLY);
        System.out.printf("%n  PREFILL assessment: basis=%s productLane=%s policyLane=%s passages=%s precedent=%s subject=%s%n",
                a.basis(), a.retrieved().productOutcome(), a.retrieved().policyOutcome(),
                a.retrieved().passages().stream().map(p -> p.scope().name()).toList(),
                a.gap() == null ? null : a.gap().precedentMemoryId(), a.missingSubject());
        if ("true".equals(System.getenv("QA_REPLAY_PREFILL_DRY"))) {
            String taught = System.getenv("QA_REPLAY_PREFILL_DRY_TEACH");
            if (taught != null && !taught.isBlank()) {
                candidates.teach(ORG, "PRODUCT", a.productId(), a.missingSubject(), null, taught,
                        com.sellerops.knowledge.org.OrgKnowledgeType.GENERAL_CS_FAQ, null, "QA dry teach");
                var after = assessor.assess(ORG, inquiries.findById(replayed).orElseThrow(),
                        com.sellerops.order.fact.OrderFactLookup.STORED_ONLY);
                System.out.printf("  PREFILL after dry teach: basis=%s productLane=%s passages=%s precedent=%s%n",
                        after.basis(), after.retrieved().productOutcome(),
                        after.retrieved().passages().stream().map(x -> x.scope().name()).toList(),
                        after.gap() == null ? null : after.gap().precedentMemoryId());
            }
            return;
        }
        OperationsCaseProcessor.Report p = processor.process(runId, () -> false);
        System.out.printf("  PREFILL process: opened=%d investigated=%d failed=%d drafts=%d%n", p.opened(),
                p.investigated(), p.investigationFailed(), p.draftsPrepared());
        CaseDetailView v = print("PREFILL " + PREFILL_REPLAY_ID,
                caseFor("INQUIRY", "inquiries", "naver-qna:" + PREFILL_REPLAY_ID));
        if (v != null && v.gap() != null) {
            System.out.printf("    prefill: %s%n", v.gap().prefill() == null ? null
                    : v.gap().prefill().strengthKo() + " · " + v.gap().prefill().answeredOn() + " · "
                            + v.gap().prefill().text().length() + " chars");
        }
        System.out.println();
    }

    static final String PREFILL_REPLAY_ID = "900000000005";

    @Autowired com.sellerops.inquiry.draft.InquiryKnowledgeAssessor assessor;
    @Autowired com.sellerops.inquiry.InquiryRepository inquiries;
    @Autowired com.sellerops.knowledge.candidate.KnowledgeCandidateService candidates;

    // ── the device's side of the job, through the production services ───────────────────────────────────────────

    private void deliverReviews(UUID device, UUID runId, List<NaverReviewObservationRequest.Review> rows) {
        UUID job = claim(device, runId, AsideRecipe.NAVER_REVIEW_OBSERVE_V1, "qa-replay-rv-" + rows.get(0).reviewId());
        var view = reviewObservation.deliver(ORG, device, job, new NaverReviewObservationRequest(rows, 30));
        jobs.settle(ORG, device, job, AsideJobOutcome.OBSERVED, rows.size(), null);
        System.out.printf("  delivered reviews: %s%n", view);
    }

    private void deliverInquiry(UUID device, UUID runId, NaverProductInquiryObservationRequest.Inquiry row) {
        UUID job = claim(device, runId, AsideRecipe.NAVER_PRODUCT_INQUIRY_OBSERVE_V1, "qa-replay-iq-" + row.questionId());
        String day = LocalDate.now(KST).toString();
        var view = inquiryObservation.deliver(ORG, device, job,
                new NaverProductInquiryObservationRequest(List.of(row), 20, 1, LocalDate.now(KST).minusDays(90).toString(),
                        day));
        jobs.settle(ORG, device, job, AsideJobOutcome.OBSERVED, 1, null);
        System.out.printf("  delivered inquiry: %s%n", view);
    }

    private UUID claim(UUID device, UUID runId, AsideRecipe recipe, String clientJobId) {
        jobs.enqueue(ORG, device, runId, clientJobId, recipe);
        return jobs.claim(ORG, device).orElseThrow().jobId();
    }

    // ── payloads, from the original rows ────────────────────────────────────────────────────────────────────────

    private NaverReviewObservationRequest.Review reviewRow(String originalId, String replayId) {
        Map<String, Object> r = jdbc.queryForMap("""
                select rating, body, received_at, source_product_ref, source_product_name from reviews where id = ?::uuid
                """, originalId);
        List<NaverReviewObservationRequest.Attachment> attachments = jdbc.query("""
                select source_url, media_kind from review_media where review_id = ?::uuid order by ordinal
                """, (rs, i) -> new NaverReviewObservationRequest.Attachment(rs.getString(1), rs.getString(2)), originalId);
        return new NaverReviewObservationRequest.Review(replayId, iso(r.get("received_at")), (Integer) r.get("rating"),
                (String) r.get("body"), (String) r.get("source_product_ref"), (String) r.get("source_product_name"),
                false, attachments.size(), attachments.isEmpty() ? null : attachments);
    }

    private NaverProductInquiryObservationRequest.Inquiry inquiryRow(String originalId, String replayId) {
        Map<String, Object> q = jdbc.queryForMap("""
                select body, received_at, source_product_ref, coalesce(is_secret, false) as secret
                from inquiries where id = ?::uuid
                """, originalId);
        return new NaverProductInquiryObservationRequest.Inquiry(replayId, iso(q.get("received_at")), (String) q.get("body"),
                false, (Boolean) q.get("secret"), (String) q.get("source_product_ref"));
    }

    private static String iso(Object ts) {
        return ((Timestamp) ts).toInstant().atZone(KST).toOffsetDateTime().toString();
    }

    // ── reading the result the way the case screen reads it ─────────────────────────────────────────────────────

    private UUID caseFor(String kind, String table, String externalId) {
        List<UUID> ids = jdbc.queryForList("""
                select c.id from proactive_case c join %s s on s.id = c.subject_id
                where c.org_id = ? and c.subject_kind = ? and s.external_id = ? order by c.created_at desc
                """.formatted(table), UUID.class, ORG, kind, externalId);
        return ids.isEmpty() ? null : ids.get(0);
    }

    private CaseDetailView print(String label, UUID caseId) {
        if (caseId == null) {
            System.out.printf("  %s: NO CASE%n", label);
            return null;
        }
        return show(label, caseId, caseKnowledge.detail(ORG, caseId));
    }

    private CaseDetailView show(String label, UUID caseId, CaseDetailView v) {
        System.out.printf("  %s → case %s open=%s disposition=%s decidedBy=%s action=%s%n", label, caseId, v.open(),
                v.disposition(), v.decidedBy(), v.recommendedActionType());
        System.out.printf("    reason: %s%n    summary: %s%n    why: %s%n    missing: %s%n", v.reasonNote(), v.summary(),
                v.whyDecisionNeeded(), v.missingInformation());
        System.out.printf("    investigated: %s%n", v.investigated());
        if (v.media() != null) {
            v.media().forEach(m -> System.out.printf("    photo %d inspected=%s status=%s depicts=%s problemVisible=%s%n",
                    m.ordinal(), m.inspected(), m.statusKo(), m.depicts(), m.problemVisible()));
        }
        v.knowledgeUsed().forEach(k -> System.out.printf("    knowledge: [%s] %s · %s · pastAnswer=%s cited=%s%n",
                k.authority(), k.title(), k.provenance(), k.pastAnswer(), k.cited()));
        if (v.gap() != null) {
            System.out.printf("    gap: %s (scope %s)%n", v.gap().sentence(), v.gap().suggestedScope());
        }
        if (v.draft() != null) {
            System.out.printf("    draft v%d basis=%s evidence=%s%n    body: %s%n", v.draft().version(), v.draft().answerBasis(),
                    v.draft().evidence().stream().map(e -> e.scopeLabel() + ":" + e.title()).toList(),
                    v.draft().body().replace('\n', ' '));
        }
        return v;
    }
}
