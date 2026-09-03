package com.sellerops.knowledge;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.knowledge.candidate.KnowledgeCandidateService;
import com.sellerops.knowledge.candidate.dto.KnowledgeCandidateAcceptRequest;
import com.sellerops.knowledge.candidate.dto.KnowledgeCandidateView;
import com.sellerops.knowledge.document.KnowledgeDocumentService;
import com.sellerops.knowledge.document.dto.KnowledgeDocumentView;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.product.library.KnowledgeSourceType;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * <b>How knowledge gets IN</b> — the two acquisition paths the seller's own material takes, and the
 * inbox of things reviewnary noticed. (Knowledge Sources &amp; Acquisition v1)
 *
 * <p>Everything here writes into the corpora that already exist and is read back by the retrieval that
 * already exists. There is no route that sends, approves, or reaches a marketplace, and no route calls
 * a model — the candidate proposer is a count over the seller's own past answers.
 */
@RestController
@RequestMapping("/api/knowledge")
public class KnowledgeAcquisitionController {

    private final KnowledgeDocumentService documents;
    private final KnowledgeCandidateService candidates;

    public KnowledgeAcquisitionController(KnowledgeDocumentService documents,
                                          KnowledgeCandidateService candidates) {
        this.documents = documents;
        this.candidates = candidates;
    }

    /* ─────────────────────────────── 자료 ─────────────────────────────── */

    /**
     * Bring in one document the seller already has.
     *
     * <p>Multipart, because the seller has a file. {@code scope} decides which corpus it lands in, and
     * the type parameters say what kind of material it is — three questions about a document, asked
     * once, instead of a review of every passage inside it.
     *
     * <p>400 for a format that cannot be read, a file over the size bound, or a document with no text
     * layer (a scan); 404 when the product is not this org's.
     */
    @PostMapping(path = "/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public KnowledgeDocumentView importDocument(@AuthenticationPrincipal AuthPrincipal principal,
                                                @RequestParam KnowledgeDocumentService.Scope scope,
                                                @RequestParam(required = false) UUID productId,
                                                @RequestParam(required = false) KnowledgeSourceType sourceType,
                                                @RequestParam(required = false) OrgKnowledgeType orgType,
                                                @RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw ApiException.badRequest("파일이 비어 있습니다.");
        }
        if (scope == KnowledgeDocumentService.Scope.PRODUCT && productId == null) {
            throw ApiException.badRequest("어느 상품의 자료인지 선택해 주세요.");
        }
        try {
            return documents.importDocument(principal.orgId(), scope, productId, sourceType, orgType,
                    file.getOriginalFilename(), file.getBytes(), principal.userId(), actorName(principal));
        } catch (IOException e) {
            throw ApiException.badRequest("파일을 읽지 못했습니다.");
        }
    }

    @GetMapping("/documents")
    public List<KnowledgeDocumentView> documents(@AuthenticationPrincipal AuthPrincipal principal) {
        return documents.list(principal.orgId());
    }

    /**
     * Retire or restore one document.
     *
     * <p>Retiring is not deleting: the row stays so every citation that stood on it still resolves, and
     * what changes is that a superseded manual stops grounding new answers.
     */
    @PostMapping("/documents/{sourceId}/active")
    public KnowledgeDocumentView setActive(@AuthenticationPrincipal AuthPrincipal principal,
                                           @PathVariable UUID sourceId,
                                           @RequestParam boolean active) {
        return documents.setActive(principal.orgId(), sourceId, active);
    }

    /**
     * Who to record as the author.
     *
     * <p>The principal carries an email and no display name, and an email is a person's identity
     * rather than an authorship label — the knowledge screens print this beside every document. The
     * local part is what the existing seller-facing views already fall back to.
     */
    private static String actorName(AuthPrincipal principal) {
        String email = principal.email();
        if (email == null || email.isBlank()) {
            return "판매자";
        }
        int at = email.indexOf('@');
        return at > 0 ? email.substring(0, at) : email;
    }

    /* ─────────────────────────────── 확인 필요 ─────────────────────────────── */

    @GetMapping("/candidates")
    public List<KnowledgeCandidateView> candidates(@AuthenticationPrincipal AuthPrincipal principal) {
        return candidates.open(principal.orgId());
    }

    /**
     * Look through this seller's own past answers for sentences they keep writing.
     *
     * <p>Deterministic and idempotent — a count, not a judgement, and running it twice files nothing
     * twice. It promotes nothing: everything it finds waits for a person.
     */
    @PostMapping("/candidates/propose")
    public List<KnowledgeCandidateView> propose(@AuthenticationPrincipal AuthPrincipal principal) {
        candidates.proposeFromAnswers(principal.orgId());
        return candidates.open(principal.orgId());
    }

    /** The seller says yes: an ordinary knowledge source is written and the candidate records which. */
    @PostMapping("/candidates/{candidateId}/accept")
    public KnowledgeCandidateView accept(@AuthenticationPrincipal AuthPrincipal principal,
                                         @PathVariable UUID candidateId,
                                         @RequestBody(required = false) KnowledgeCandidateAcceptRequest request) {
        return candidates.accept(principal.orgId(), candidateId,
                request == null ? null : request.title(),
                request == null ? null : request.content(),
                request == null ? null : request.sourceType(),
                request == null ? null : request.orgType(),
                principal.userId(), actorName(principal));
    }

    /** Not this. Deliberately not "never" — the same sentence may be noticed again later. */
    @PostMapping("/candidates/{candidateId}/dismiss")
    public KnowledgeCandidateView dismiss(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable UUID candidateId) {
        return candidates.dismiss(principal.orgId(), candidateId, actorName(principal));
    }
}
