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
                          String provenance, String reason) {
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
        CaseInvestigationOutput output = raw.withEvidenceRefs(valid);
        boolean customerWaiting = subject.kind() == OperationsSubjectKind.INQUIRY
                && "UNANSWERED".equals(subject.status());
        CaseDecisionGuard.Applied applied = CaseDecisionGuard.apply(output, customerWaiting);
        Map<String, Object> concluded = base(t, valid, result, "CONCLUDED");
        concluded.put("proposedDisposition", raw.disposition().name());
        concluded.put("disposition", applied.disposition().name());
        concluded.put("recommendedActionType", output.recommendedActionType().name());
        concluded.put("confidence", output.confidence().name());
        concluded.put("guards", applied.guards());
        return new Outcome(Kind.CONCLUDED, output, applied, provenance(concluded), "CONCLUDED");
    }

    record Context(String text, Set<String> refs) {
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

        String question = question(subject);
        if (subject.productId() != null) {
            t.getProductContext(subject.productId(), question).ifPresent(product -> {
                refs.add("product");
                text.append("[product] 상품: ").append(product.name() == null ? "이름 없는 상품" : product.name())
                        .append('\n');
                int i = 1;
                for (CaseInvestigationTools.KnowledgeHit hit : product.knowledge()) {
                    String ref = "p" + i++;
                    refs.add(ref);
                    text.append('[').append(ref).append("] ").append(hit.kindLabel()).append(" 「")
                            .append(hit.title()).append("」: ").append(hit.excerpt()).append('\n');
                }
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
        List<CaseInvestigationTools.KnowledgeHit> policies = t.searchKnowledge(question);
        if (policies.isEmpty()) {
            text.append("(이 건에 맞는 운영 기준은 등록되어 있지 않습니다.)\n");
        }
        int k = 1;
        for (CaseInvestigationTools.KnowledgeHit hit : policies) {
            String ref = "k" + k++;
            refs.add(ref);
            text.append('[').append(ref).append("] ").append(hit.kindLabel()).append(" 「").append(hit.title())
                    .append("」: ").append(hit.excerpt()).append('\n');
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
        return new Context(text.toString(), refs);
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
