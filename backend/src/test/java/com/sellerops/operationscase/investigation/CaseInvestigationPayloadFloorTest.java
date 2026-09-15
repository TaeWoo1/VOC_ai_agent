package com.sellerops.operationscase.investigation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.InquiryOrderFactReader;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeSearchResponse;
import com.sellerops.operationscase.CaseDisposition;
import com.sellerops.operationscase.OperationsCase;
import com.sellerops.operationscase.OperationsCaseKind;
import com.sellerops.operationscase.OperationsCaseRepository;
import com.sellerops.operationscase.OperationsSubjectKind;
import com.sellerops.operationscase.RecommendedActionType;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * <b>What leaves for the vendor, asserted on the serialized bytes</b> — the same discipline every capability's floor
 * test follows. One customer inquiry carrying a phone number, an email, an order number and an order reference goes
 * through the real tools, the real context assembly and the real request builder; none of those, and no identifier
 * of any kind, may be in the request.
 */
class CaseInvestigationPayloadFloorTest {

    private static final Pattern UUID_SHAPE =
            Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    private final UUID org = UUID.randomUUID();
    private final UUID inquiryId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();
    private final InquiryRepository inquiries = mock(InquiryRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final SellerOperationsKnowledgeService orgKnowledge = mock(SellerOperationsKnowledgeService.class);
    private final ReviewIssueRepository issues = mock(ReviewIssueRepository.class);
    private final OperationsCaseRepository cases = mock(OperationsCaseRepository.class);
    private final AgentQuotaService quota = mock(AgentQuotaService.class);
    private final List<String> sentBodies = new ArrayList<>();
    private CaseInvestigationTools tools;
    private OperationsCase subjectCase;
    private String modelOutput;

    @BeforeEach
    void setUp() {
        Inquiry inquiry = new Inquiry();
        inquiry.setId(inquiryId);
        inquiry.setOrgId(org);
        inquiry.setChannelId(channelId);
        inquiry.setTitle("배송 문의");
        inquiry.setBody("010-1234-5678 로 연락 주세요. 주문번호 20260916123456 인데 kim@example.com 으로도 받았어요. "
                + "배송은 언제 되나요?");
        inquiry.setStatus("UNANSWERED");
        inquiry.setReceivedAt(Instant.parse("2026-09-16T01:00:00Z"));
        inquiry.setSourceOrderRef("ORD-99");
        when(inquiries.findById(inquiryId)).thenReturn(Optional.of(inquiry));
        Channel channel = new Channel();
        channel.setNameKo("카페24");
        when(channels.findById(channelId)).thenReturn(Optional.of(channel));
        when(orgKnowledge.search(eq(org), anyString(), anyInt()))
                .thenReturn(new OrgKnowledgeSearchResponse("q", 0, 0, List.of()));
        when(issues.findByOrgIdAndDismissedFalse(org)).thenReturn(List.of());
        tools = new CaseInvestigationTools(inquiries, mock(ReviewRepository.class), channels,
                mock(ProductRepository.class), mock(ProductKnowledgeLibraryService.class), orgKnowledge,
                mock(InquiryOrderFactReader.class), issues, mock(ReviewIssueEvidenceRepository.class), cases);
        subjectCase = new OperationsCase();
        subjectCase.setId(UUID.randomUUID());
        subjectCase.setOrgId(org);
        subjectCase.setSubjectKind(OperationsSubjectKind.INQUIRY);
        subjectCase.setSubjectId(inquiryId);
        when(quota.consume(eq(org), eq(AgentUsageKind.INVESTIGATE), anyString()))
                .thenReturn(new QuotaDecision(true, null, 0, 0));
        modelOutput = "{\"caseKind\":\"CUSTOMER_WORK\",\"disposition\":\"AUTO_RESOLVED\","
                + "\"summary\":\"고객에게 답변을 보냈습니다.\",\"recommendedActionType\":\"REPLY_TO_CUSTOMER\","
                + "\"recommendedAction\":\"배송 예정일을 안내해 주세요.\",\"missingInformation\":[\"출고 예정일\"],"
                + "\"evidenceRefs\":[\"subject\",\"k9\"],\"confidence\":\"HIGH\"}";
    }

    private AgentLlmTransport transport() {
        return (uri, headers, body) -> {
            sentBodies.add(body);
            try {
                String envelope = new ObjectMapper().createObjectNode()
                        .set("choices", new ObjectMapper().createArrayNode().add(new ObjectMapper().createObjectNode()
                                .set("message", new ObjectMapper().createObjectNode().put("content", modelOutput))))
                        .toString();
                envelope = envelope.substring(0, envelope.length() - 1)
                        + ",\"usage\":{\"prompt_tokens\":900,\"completion_tokens\":150,"
                        + "\"completion_tokens_details\":{\"reasoning_tokens\":0}}}";
                return new AgentLlmTransport.Response(200, envelope, 1234);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        };
    }

    private CaseInvestigationService service(boolean enabled) {
        CaseInvestigationProperties properties = new CaseInvestigationProperties(enabled, org.toString(), "OPENAI",
                "gpt-test", "sk-secret-test", 2500, "low", 5);
        return new CaseInvestigationService(properties, transport(),
                new AgentCapabilityAccess("ALLOW_LIST", mock(SellerAccountRepository.class)));
    }

    @Test
    void theRequestCarriesTheRedactedQuestion_andNoIdentifierContactOrOrderReference() {
        CaseInvestigator investigator = new CaseInvestigator(tools, service(true), quota);
        CaseInvestigationTools.OrgTools bound = tools.forOrg(org);
        CaseInvestigationTools.SubjectFacts subject =
                bound.getSubject(OperationsSubjectKind.INQUIRY, inquiryId).orElseThrow();
        CaseInvestigator.Context context = investigator.gather(bound, subjectCase, subject);
        String body = new CaseInvestigationGenerator(transport(), AgentLlmWireFormat.Vendor.OPENAI, "gpt-test",
                "sk-secret-test", 2500, "low").requestBody(context.text());

        assertThat(body).contains("[subject]").contains("배송은 언제 되나요").contains("개인정보로 보이는 부분은 가려져 있음");
        assertThat(body).doesNotContain("010-1234-5678").doesNotContain("kim@example.com")
                .doesNotContain("20260916123456").doesNotContain("ORD-99").doesNotContain("sk-secret-test");
        assertThat(UUID_SHAPE.matcher(body).find()).as("no identifier of any kind leaves").isFalse();
        assertThat(context.refs()).contains("subject", "product", "order");
    }

    @Test
    void aConclusionIsGuarded_unknownEvidenceIsDropped_andProvenanceIsMetadataOnly() {
        CaseInvestigator investigator = new CaseInvestigator(tools, service(true), quota);
        CaseInvestigator.Outcome outcome = investigator.investigate(subjectCase, UUID.randomUUID());

        assertThat(outcome.kind()).isEqualTo(CaseInvestigator.Kind.CONCLUDED);
        assertThat(outcome.output().evidenceRefs()).containsExactly("subject");
        assertThat(outcome.applied().disposition()).as("a reply needs the seller").isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(outcome.applied().summary()).as("a completion claim never reaches a screen").isNull();
        assertThat(outcome.provenance())
                .contains("\"promptTokens\":900").contains("\"elapsedMs\":1234").contains("\"model\":\"gpt-test\"")
                .contains(CaseInvestigationPrompt.PROMPT_VERSION).contains("\"tool\":\"getSubject\"")
                .contains("HUMAN_AUTHORITY")
                .doesNotContain("배송").doesNotContain("010").doesNotContain("보냈습니다")
                .doesNotContain(inquiryId.toString());
        assertThat(sentBodies).hasSize(1);
    }

    @Test
    void offMeansNoRequest_andEvidenceNobodyGaveIsNotAConclusion() {
        CaseInvestigator.Outcome off = new CaseInvestigator(tools, service(false), quota)
                .investigate(subjectCase, UUID.randomUUID());
        assertThat(off.kind()).isEqualTo(CaseInvestigator.Kind.SKIPPED);
        assertThat(sentBodies).isEmpty();

        modelOutput = modelOutput.replace("[\"subject\",\"k9\"]", "[\"x1\"]");
        CaseInvestigator.Outcome invented = new CaseInvestigator(tools, service(true), quota)
                .investigate(subjectCase, UUID.randomUUID());
        assertThat(invented.kind()).isEqualTo(CaseInvestigator.Kind.FAILED);
        assertThat(invented.reason()).isEqualTo("UNKNOWN_EVIDENCE_REFS");
    }

    @Test
    void theSchemaIsReadStrictly() {
        assertThat(CaseInvestigationGenerator.parse(modelOutput)).isPresent();
        assertThat(CaseInvestigationGenerator.parse("```json\n" + modelOutput + "\n```")).isPresent();
        assertThat(CaseInvestigationGenerator.parse(modelOutput.replace("\"confidence\":\"HIGH\"", "\"confidence\":\"SURE\"")))
                .as("an unknown token").isEmpty();
        assertThat(CaseInvestigationGenerator.parse(modelOutput.replace("CUSTOMER_WORK", "OBSERVATION_GAP")))
                .as("the investigator only concludes customer work").isEmpty();
        assertThat(CaseInvestigationGenerator.parse(modelOutput.replace(",\"missingInformation\":[\"출고 예정일\"]", "")))
                .as("a missing field").isEmpty();
        assertThat(CaseInvestigationGenerator.parse(modelOutput.replace("[\"subject\",\"k9\"]", "[]")))
                .as("a conclusion that cites nothing").isEmpty();
        assertThat(CaseInvestigationGenerator.parse("not json")).isEmpty();

        String twoSentences = "리뷰에 사과를 남겨 주세요. " + "부착면과 사용 환경을 고객에게 물어봐 주세요. ".repeat(12);
        String fitted = CaseInvestigationGenerator.fitSentences(twoSentences, CaseInvestigationGenerator.MAX_ACTION);
        assertThat(fitted).as("an overlong recommendation ends on a whole sentence").endsWith("주세요.")
                .hasSizeLessThanOrEqualTo(CaseInvestigationGenerator.MAX_ACTION);
        assertThat(CaseInvestigationGenerator.fitSentences("가".repeat(300), 240)).endsWith("…").hasSize(241);
        assertThat(CaseInvestigationPrompt.system()).contains("지어내지 않습니다").contains("약속하라고 권하지 않습니다");
        assertThat(RecommendedActionType.valueOf("REPLY_TO_CUSTOMER").authority().name()).isEqualTo("HUMAN");
        assertThat(OperationsCaseKind.values()).hasSize(2);
    }
}
