package com.sellerops.knowledge.guidance;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.TopicSignature;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The one writer of {@link SellerGuidance}. Called only from an explicit seller press — never from a draft, an
 * approval, an execution or an investigation — so a guidance row is always a person's decision to be remembered.
 */
@Service
public class SellerGuidanceService {

    static final int MAX_GUIDANCE_CHARS = 2000;

    private final SellerGuidanceRepository guidance;

    public SellerGuidanceService(SellerGuidanceRepository guidance) {
        this.guidance = guidance;
    }

    public record Record(UUID orgId, UUID productId, SellerGuidance.Kind kind, String subjectKind, UUID originCaseId,
                         String correctedAction, String question, String text, UUID authorUserId,
                         String authorName) {
    }

    /**
     * @param question the case's question, read to build the topic signature and then dropped — never stored
     */
    @Transactional
    public SellerGuidance record(Record r) {
        if (r.text() == null || r.text().isBlank()) {
            throw ApiException.badRequest("다음에도 참고할 내용을 적어 주세요.");
        }
        String text = r.text().strip();
        if (text.length() > MAX_GUIDANCE_CHARS) {
            throw ApiException.badRequest("참고할 내용이 너무 깁니다 (최대 " + MAX_GUIDANCE_CHARS + "자).");
        }
        SellerGuidance row = new SellerGuidance();
        row.setOrgId(r.orgId());
        row.setProductId(r.productId());
        row.setScope(r.productId() == null ? "ORG" : "PRODUCT");
        row.setKind(r.kind());
        row.setSubjectKind(r.subjectKind());
        row.setOriginCaseId(r.originCaseId());
        row.setCorrectedAction(r.correctedAction());
        String signature = TopicSignature.of(r.question() == null ? "" : r.question(), text);
        row.setTopicSignature(signature.length() > 400 ? signature.substring(0, 400) : signature);
        row.setGuidance(text);
        row.setNormalized(KnowledgeText.normalize(signature) + KnowledgeText.normalize(text));
        row.setAuthorUserId(r.authorUserId());
        row.setAuthorName(r.authorName());
        return guidance.save(row);
    }
}
