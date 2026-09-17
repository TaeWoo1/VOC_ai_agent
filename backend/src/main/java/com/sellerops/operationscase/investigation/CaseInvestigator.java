package com.sellerops.operationscase.investigation;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmCallMetrics;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.operationscase.OperationsCase;
import com.sellerops.operationscase.OperationsSubjectKind;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * <b>The backend investigator.</b> Gathers what Reviewnary already holds about one case through the org-bound tools,
 * asks the model once for a strict conclusion, and lets {@link CaseDecisionGuard} decide what stands.
 *
 * <p><b>Authority boundary.</b> The organisation comes from the case, which came from the responsibility run, which
 * the runtime resolved to one organisation. No user bearer exists on this path (a scheduled run has no user), no
 * helper device token is used, and this backend does not call its own HTTP API as if it were someone: every read is
 * an in-process repository or service call bound to that organisation by {@link CaseInvestigationTools#forOrg}.
 *
 * <p><b>The model is asked, not obeyed.</b> Its output writes nothing outside the case row and its history; no tool
 * it could name exists, no draft it could write is sent, and a conclusion that would take work away from the seller
 * without the seller's authority is turned back toward them.
 */
@Component
public class CaseInvestigator {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final CaseInvestigationTools tools;
    private final CaseInvestigationService service;
    private final AgentQuotaService quota;

    public CaseInvestigator(CaseInvestigationTools tools, CaseInvestigationService service, AgentQuotaService quota) {
        this.tools = tools;
        this.service = service;
        this.quota = quota;
    }

    public enum Kind { CONCLUDED, FAILED, SKIPPED }

    /**
     * @param provenance metadata-only JSON for the case event — never customer or seller text
     */
    public record Outcome(Kind kind, CaseInvestigationOutput output, CaseDecisionGuard.Applied applied,
                          String provenance, String reason, CaseInvestigationTools.KnowledgeAssessment knowledge,
                          List<UsedKnowledge> usedKnowledge) {

        public Outcome(Kind kind, CaseInvestigationOutput output, CaseDecisionGuard.Applied applied,
                       String provenance, String reason) {
            this(kind, output, applied, provenance, reason, null, List.of());
        }
    }

    /**
     * One knowledge entry the investigation was shown, and whether its conclusion cited it. Stored on the case (ids
     * and labels, no text) so the seller can see which company knowledge Reviewnary used.
     */
    public record UsedKnowledge(String entryId, String sourceType, String authority, String scope, String title,
                                String provenance, String ref, boolean cited) {
    }

    public Outcome investigate(OperationsCase subjectCase, UUID runId) {
        UUID orgId = subjectCase.getOrgId();
        if (!service.isEnabledFor(orgId)) {
            return new Outcome(Kind.SKIPPED, null, null, provenance(Map.of("outcome", "CAPABILITY_OFF")),
                    "CAPABILITY_OFF");
        }
        CaseInvestigationTools.OrgTools t = tools.forOrg(orgId);
        Optional<CaseInvestigationTools.SubjectFacts> found =
                t.getSubject(subjectCase.getSubjectKind(), subjectCase.getSubjectId());
        if (found.isEmpty()) {
            return new Outcome(Kind.FAILED, null, null, provenance(base(t, List.of(), null, "SUBJECT_UNREADABLE")),
                    "SUBJECT_UNREADABLE");
        }
        CaseInvestigationTools.SubjectFacts subject = found.get();
        Context context = gather(t, subjectCase, subject);

        QuotaDecision charged = quota.consume(orgId, AgentUsageKind.INVESTIGATE, "rr-run:" + runId);
        if (!charged.allowed()) {
            return new Outcome(Kind.SKIPPED, null, null,
                    provenance(base(t, List.of(), null, "QUOTA_EXHAUSTED")), "QUOTA_EXHAUSTED");
        }

        CaseInvestigationGenerator.Result result = service.investigate(orgId, context.text());
        if (result.output().isEmpty()) {
            Map<String, Object> failed = base(t, List.of(), result, result.reason());
            return new Outcome(Kind.FAILED, null, null, provenance(failed), result.reason());
        }
        CaseInvestigationOutput raw = result.output().get();
        List<String> valid = raw.evidenceRefs().stream().filter(context.refs()::contains).distinct().toList();
        if (valid.isEmpty()) {
            return new Outcome(Kind.FAILED, null, null,
                    provenance(base(t, raw.evidenceRefs(), result, "UNKNOWN_EVIDENCE_REFS")), "UNKNOWN_EVIDENCE_REFS");
        }
        CaseInvestigationOutput output = withKnowledgeGap(raw.withEvidenceRefs(valid), context.knowledge());
        boolean customerWaiting = subject.kind() == OperationsSubjectKind.INQUIRY
                && "UNANSWERED".equals(subject.status());
        CaseDecisionGuard.Applied applied = CaseDecisionGuard.apply(output, customerWaiting,
                !context.knowledge().conflicts().isEmpty());
        Map<String, Object> concluded = base(t, valid, result, "CONCLUDED");
        concluded.put("proposedDisposition", raw.disposition().name());
        concluded.put("disposition", applied.disposition().name());
        concluded.put("recommendedActionType", output.recommendedActionType().name());
        concluded.put("confidence", output.confidence().name());
        concluded.put("guards", applied.guards());
        concluded.put("knowledgeBasis", context.knowledge().basis());
        concluded.put("knowledgeConflicts", context.knowledge().conflicts().size());
        List<UsedKnowledge> used = new ArrayList<>();
        context.knowledgeRefs().forEach((ref, use) -> used.add(new UsedKnowledge(use.entryId(),
                use.sourceType().name(), use.authority(), use.scope(), use.title(), use.provenance(), ref,
                valid.contains(ref))));
        return new Outcome(Kind.CONCLUDED, output, applied, provenance(concluded), "CONCLUDED", context.knowledge(),
                List.copyOf(used));
    }

    /**
     * The knowledge gap is a fact the assessment established, not a judgement the model may omit: when the company
     * has no basis to answer, the missing subject is on the case's missing information whatever the model listed.
     */
    static CaseInvestigationOutput withKnowledgeGap(CaseInvestigationOutput output,
                                                    CaseInvestigationTools.KnowledgeAssessment knowledge) {
        if (knowledge == null || !knowledge.missing()) {
            return output;
        }
        String line = knowledge.missingSubject() == null
                ? "이 문의에 답할 판매자 안내 기준"
                : "「" + knowledge.missingSubject() + "」에 대한 판매자 안내 기준";
        String subject = knowledge.missingSubject();
        if (subject != null && output.missingInformation().stream().anyMatch(m -> m.contains(subject))) {
            return output;
        }
        List<String> missing = new ArrayList<>();
        missing.add(line);
        missing.addAll(output.missingInformation());
        return new CaseInvestigationOutput(output.caseKind(), output.disposition(), output.summary(),
                output.recommendedActionType(), output.recommendedAction(), missing, output.evidenceRefs(),
                output.confidence());
    }

    record Context(String text, Set<String> refs, CaseInvestigationTools.KnowledgeAssessment knowledge,
                   Map<String, CaseInvestigationTools.KnowledgeUse> knowledgeRefs) {

        Context(String text, Set<String> refs) {
            this(text, refs, CaseInvestigationTools.KnowledgeAssessment.none(), Map.of());
        }
    }

    /** Package-private so the payload-floor test can see exactly what would leave. */
    Context gather(CaseInvestigationTools.OrgTools t, OperationsCase subjectCase,
                   CaseInvestigationTools.SubjectFacts subject) {
        StringBuilder text = new StringBuilder();
        Set<String> refs = new LinkedHashSet<>();
        refs.add("subject");
        text.append("[subject] ")
                .append(subject.kind() == OperationsSubjectKind.INQUIRY ? "고객 문의" : "리뷰")
                .append(" · 채널: ").append(subject.channelName() == null ? "알 수 없음" : subject.channelName())
                .append(" · 받은 날: ").append(subject.receivedOn() == null ? "알 수 없음" : subject.receivedOn());
        if (subject.rating() != null) {
            text.append(" · 별점: ").append(subject.rating()).append("점");
        }
        text.append(" · 상태: ").append(statusKo(subject));
        if (subject.redacted()) {
            text.append(" · 개인정보로 보이는 부분은 가려져 있음");
        }
        text.append('\n');
        if (subject.title() != null && !subject.title().isBlank()) {
            text.append("제목: ").append(subject.title()).append('\n');
        }
        text.append("내용: ").append(subject.body() == null || subject.body().isBlank() ? "(내용 없음)" : subject.body())
                .append("\n\n");

        if (subject.productId() != null) {
            t.getProductContext(subject.productId()).ifPresent(product -> {
                refs.add("product");
                text.append("[product] 상품: ").append(product.name() == null ? "이름 없는 상품" : product.name())
                        .append('\n');
            });
        } else {
            text.append("[product] 이 건은 상품과 연결되어 있지 않습니다.\n");
            refs.add("product");
        }
        if (subject.kind() == OperationsSubjectKind.INQUIRY && subject.inquiryId() != null) {
            CaseInvestigationTools.OrderContext order = t.getOrderContext(subject.inquiryId());
            refs.add("order");
            text.append("[order] ").append(order.sentence()).append('\n');
        }
        // The company's knowledge — the Knowledge Spine's one retrieval, the same the draft writer reads — with the
        // authority and provenance of every line, the basis verdict, and any conflicting figures.
        CaseInvestigationTools.KnowledgeAssessment knowledge =
                t.assessKnowledge(subject.kind(), subjectCase.getSubjectId());
        Map<String, CaseInvestigationTools.KnowledgeUse> knowledgeRefs = new LinkedHashMap<>();
        if (subject.kind() == OperationsSubjectKind.INQUIRY) {
            refs.add("basis");
            text.append("[basis] 답변 근거: ").append(basisKo(knowledge)).append('\n');
        }
        if (knowledge.evidence().isEmpty() && knowledge.context().isEmpty()) {
            text.append("(이 건에 맞는 판매자·회사 지식은 등록되어 있지 않습니다.)\n");
        }
        int e = 1;
        for (CaseInvestigationTools.KnowledgeUse use : knowledge.evidence()) {
            String ref = "e" + e++;
            refs.add(ref);
            knowledgeRefs.put(ref, use);
            appendKnowledge(text, ref, use);
        }
        int g = 1;
        for (CaseInvestigationTools.KnowledgeUse use : knowledge.context()) {
            String ref = "g" + g++;
            refs.add(ref);
            knowledgeRefs.put(ref, use);
            appendKnowledge(text, ref, use);
        }
        int x = 1;
        for (com.sellerops.knowledge.spine.KnowledgeConflict conflict : knowledge.conflicts()) {
            String ref = "x" + x++;
            refs.add(ref);
            text.append('[').append(ref).append("] 지식 충돌: 「").append(conflict.winnerTitle()).append("」(")
                    .append(conflict.winnerAuthority().labelKo()).append(")와 「").append(conflict.loserTitle())
                    .append("」(").append(conflict.loserAuthority().labelKo()).append(")의 수치(")
                    .append(conflict.unit()).append(")가 다릅니다. 권한이 높은 「").append(conflict.winnerTitle())
                    .append("」를 따르고, 판매자 확인이 필요합니다.\n");
        }
        int n = 1;
        UUID reviewId = subject.kind() == OperationsSubjectKind.REVIEW ? subjectCase.getSubjectId() : null;
        for (CaseInvestigationTools.RelatedIssue issue : t.getRelatedIssues(reviewId, subject.productId())) {
            String ref = "i" + n++;
            refs.add(ref);
            text.append('[').append(ref).append("] 반복 문제 「").append(issue.title()).append("」: 근거 ")
                    .append(issue.evidenceCount()).append("건").append(issue.citesThisReview() ? " (이 리뷰도 근거)" : "")
                    .append('\n');
        }
        int c = 1;
        for (CaseInvestigationTools.SimilarCase similar
                : t.getRecentSimilarCases(subject.kind(), subject.productId(), subjectCase.getId())) {
            String ref = "c" + c++;
            refs.add(ref);
            text.append('[').append(ref).append("] 같은 상품의 최근 비슷한 건: 판단 ")
                    .append(nullDash(similar.disposition())).append(" · 권장 ")
                    .append(nullDash(similar.recommendedActionType())).append(" · 결과 ")
                    .append(nullDash(similar.resolution())).append('\n');
        }
        CaseInvestigationTools.PastDecisions decisions = t.getPastSellerDecisions(subject.productId());
        if (!decisions.isEmpty()) {
            refs.add("d1");
            text.append("[d1] 판매자의 과거 결정 — 이 상품 리뷰 판단: ").append(counts(decisions.reviewDispositions()))
                    .append(" / 이 상품 문의 초안 작성자: ").append(counts(decisions.inquiryDraftAuthors())).append('\n');
        }
        // Each decision the seller actually made, as its own citable line. It is context for this investigation
        // and nothing more: no rule is derived from it, and a case that cites one still needs the seller.
        int d = 2;
        for (CaseInvestigationTools.SellerDecision decision : decisions.decisions()) {
            String ref = "d" + d++;
            refs.add(ref);
            text.append('[').append(ref).append("] 지난 비슷한 건에서 판매자는 ")
                    .append(decisionKo(decision.kind())).append(": ").append(decision.what())
                    .append(decision.on() == null ? "" : " (" + decision.on() + ")").append('\n');
        }
        return new Context(text.toString(), refs, knowledge, knowledgeRefs);
    }

    private static void appendKnowledge(StringBuilder text, String ref, CaseInvestigationTools.KnowledgeUse use) {
        text.append('[').append(ref).append("] ").append(use.authority()).append(" · ").append(use.provenance())
                .append(" 「").append(use.title()).append("」");
        if (use.capturedOn() != null) {
            text.append(" (").append(use.capturedOn()).append(" 기준)");
        }
        text.append(": ").append(use.excerpt()).append('\n');
    }

    private static String basisKo(CaseInvestigationTools.KnowledgeAssessment knowledge) {
        return switch (knowledge.basis()) {
            case "GROUNDED" -> "판매자가 등록한 근거로 답할 수 있습니다.";
            case "NEEDS_CLARIFICATION" -> "근거는 있지만 고객이 어떤 규격·옵션인지 확인해야 합니다.";
            case "NO_ANSWER_BASIS" -> knowledge.missingSubject() == null
                    ? "부족합니다 — 이 문의에 답할 판매자 안내 기준이 등록되어 있지 않습니다."
                    : "부족합니다 — 「" + knowledge.missingSubject() + "」에 대한 판매자 안내 기준이 등록되어 있지 않습니다.";
            default -> "판단하지 않았습니다.";
        };
    }

    /** The seller's own words for what they did. An unknown kind is not narrated into something it might be. */
    private static String decisionKo(String kind) {
        return switch (kind) {
            case "REPLY_APPROVED" -> "답변을 직접 승인했습니다";
            case "REVIEW_TRIAGED" -> "리뷰를 이렇게 판단했습니다";
            case "TRIAGE_CORRECTED" -> "시스템 판단을 이렇게 고쳤습니다";
            default -> "이렇게 결정했습니다";
        };
    }

    private static String question(CaseInvestigationTools.SubjectFacts subject) {
        String material = ((subject.title() == null ? "" : subject.title()) + " "
                + (subject.body() == null ? "" : subject.body())).strip();
        return material.length() > 200 ? material.substring(0, 200) : material;
    }

    private static String statusKo(CaseInvestigationTools.SubjectFacts subject) {
        if (subject.kind() == OperationsSubjectKind.INQUIRY) {
            return "UNANSWERED".equals(subject.status()) ? "답변 필요" : "답변됨";
        }
        return "ANSWERED".equals(subject.status()) ? "답글 있음" : "답글 없음 또는 확인 안 됨";
    }

    private static String counts(Map<String, Long> counts) {
        if (counts.isEmpty()) {
            return "기록 없음";
        }
        List<String> parts = new ArrayList<>();
        counts.forEach((key, value) -> parts.add(labelKo(key) + " " + value));
        return String.join(" · ", parts);
    }

    private static String labelKo(String token) {
        return switch (token) {
            case "RESPONSE_NEEDED" -> "대응 필요";
            case "MONITOR" -> "지켜보기";
            case "NO_ACTION" -> "조치 없음";
            case "MODEL" -> "AI 초안";
            case "SELLER" -> "판매자 작성";
            case "SELLER_APPROVED_FALLBACK" -> "판매자 기본 문구";
            case "RULE" -> "규칙 문구";
            default -> "기타";
        };
    }

    private static String nullDash(String value) {
        return value == null ? "-" : value;
    }

    private static Map<String, Object> base(CaseInvestigationTools.OrgTools t, List<String> refs,
                                            CaseInvestigationGenerator.Result result, String outcome) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("outcome", outcome);
        p.put("promptVersion", CaseInvestigationPrompt.PROMPT_VERSION);
        p.put("schemaVersion", CaseInvestigationPrompt.SCHEMA_VERSION);
        p.put("toolVersion", CaseInvestigationPrompt.TOOL_VERSION);
        p.put("evidenceVersion", CaseInvestigationPrompt.EVIDENCE_VERSION);
        List<Map<String, Object>> calls = new ArrayList<>();
        for (CaseInvestigationTools.ToolCall call : t.calls()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("tool", call.name());
            entry.put("argsDigest", call.argsDigest());
            entry.put("results", call.results());
            calls.add(entry);
        }
        p.put("tools", calls);
        p.put("evidenceRefs", refs);
        if (result != null) {
            p.put("model", result.model());
            p.put("generatorVersion", result.version());
            AgentLlmCallMetrics m = result.metrics();
            Map<String, Object> usage = new LinkedHashMap<>();
            usage.put("elapsedMs", m.elapsedMs());
            usage.put("promptTokens", m.promptTokens());
            usage.put("completionTokens", m.completionTokens());
            usage.put("reasoningTokens", m.reasoningTokens());
            p.put("usage", usage);
        }
        return p;
    }

    static String provenance(Map<String, Object> values) {
        try {
            return MAPPER.writeValueAsString(values);
        } catch (Exception e) {
            return "{\"outcome\":\"PROVENANCE_UNSERIALIZABLE\"}";
        }
    }
}
