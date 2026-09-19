package com.sellerops.knowledge.memory;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.knowledge.memory.dto.AnswerMemorySearchResponse;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * READ over the answers this company actually sent or approved (Retrieval &amp; Grounding
 * Correctness v1, 2026-08-30).
 *
 * <p><b>Why this exists.</b> The Agent lane's 「예전에 비슷한 문의에 뭐라고 답했어?」 was routed to the
 * customer-memory search — a store of inquiry/review SIGNATURES that holds no answer text — and
 * reported 「과거 대응 기록을 찾지 못했습니다」 over a product with eight remembered answers, two of
 * them verified sent. This is the same {@link AnswerMemoryService} the draft composer's memory lane
 * reads, org-scoped by the bearer, exposed as a READ. Nothing is written; an AI draft or a fallback
 * is never in this store to begin with ({@code AnswerMemoryWriteFenceTest}).
 */
@RestController
@RequestMapping("/api/answer-memory")
public class AnswerMemoryController {

    private final AnswerMemoryService memory;

    public AnswerMemoryController(AnswerMemoryService memory) {
        this.memory = memory;
    }

    /**
     * @param query            the question, in words — normalized into bounded candidates here
     * @param productId        the product the question is about, when known; unbound answers match
     *                         any question, a product-bound answer only its own product
     * @param productName      that product's display name — discounted from the question like the
     *                         product library does, and what lets a topic-less 「예전에 뭐라고 답했어」
     *                         be answered by listing that product's record
     * @param excludeInquiryId the inquiry being worked on, whose own approved answer is not precedent
     */
    @GetMapping("/search")
    public AnswerMemorySearchResponse search(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthPrincipal principal,
                                             @RequestParam String query,
                                             @RequestParam(required = false) UUID productId,
                                             @RequestParam(required = false) String productName,
                                             @RequestParam(required = false) UUID excludeInquiryId,
                                             @RequestParam(required = false, defaultValue = "0") int limit) {
        return memory.search(principal.orgId(), RetrievalQuery.ofText(query), productId, productName,
                excludeInquiryId, limit);
    }

    /** The seller's declaration of how far a past answer may travel. */
    public record ReuseScopeRequest(String scope) {
    }

    public record ReuseScopeView(UUID id, String reuseScope, String reuseScopeKo, java.time.Instant declaredAt) {
    }

    /**
     * Declare how far one past answer may travel (Inquiry Decision v2.1). A provenance statement by the seller — it
     * neither writes a new memory nor changes an answer. 400 for a word outside the four; 404 for another org's row.
     */
    @org.springframework.web.bind.annotation.PutMapping("/{memoryId}/reuse-scope")
    public ReuseScopeView declareReuseScope(
            @org.springframework.security.core.annotation.AuthenticationPrincipal AuthPrincipal principal,
            @org.springframework.web.bind.annotation.PathVariable UUID memoryId,
            @org.springframework.web.bind.annotation.RequestBody ReuseScopeRequest request) {
        AnswerMemoryReuseScope scope = request == null ? null : AnswerMemoryReuseScope.parse(request.scope());
        if (scope == null) {
            throw com.sellerops.common.ApiException.badRequest("재사용 범위는 REUSABLE, ORDER_ONLY, CASE_ONLY, UNKNOWN 중 하나입니다.");
        }
        AnswerMemory m = memory.declareReuseScope(principal.orgId(), memoryId, scope, principal.userId())
                .orElseThrow(() -> com.sellerops.common.ApiException.notFound("과거 답변을 찾을 수 없습니다."));
        return new ReuseScopeView(m.getId(), m.getReuseScope().name(), m.getReuseScope().labelKo(),
                m.getReuseScopeDeclaredAt());
    }
}
