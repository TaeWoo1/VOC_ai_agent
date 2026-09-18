package com.sellerops.knowledge.teach;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.knowledge.teach.dto.CaseCorrectionRequest;
import com.sellerops.knowledge.teach.dto.CaseDetailView;
import com.sellerops.knowledge.teach.dto.CaseDraftEditRequest;
import com.sellerops.knowledge.teach.dto.CaseTeachRequest;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The case screen's reads and the seller's three writes on it. Organisation from the JWT only; a case of another
 * organisation is a 404. No route approves, sends or closes a case — status stays the reconciler's.
 */
@RestController
@RequestMapping("/api/responsibilities/customer-operations/cases/{caseId}")
public class CaseKnowledgeController {

    private final CaseKnowledgeService service;
    private final UserRepository users;

    public CaseKnowledgeController(CaseKnowledgeService service, UserRepository users) {
        this.service = service;
        this.users = users;
    }

    @GetMapping
    public CaseDetailView detail(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID caseId) {
        return service.detail(principal.orgId(), caseId);
    }

    /** [정보 알려주기] — save the missing knowledge, then re-investigate and re-draft this case. */
    /** One review photo of this case, for the seller's own screen. 404 when there is none to show. */
    @GetMapping("/media/{ordinal}")
    public org.springframework.http.ResponseEntity<byte[]> media(@AuthenticationPrincipal AuthPrincipal principal,
                                                                 @PathVariable UUID caseId,
                                                                 @PathVariable int ordinal) {
        return service.mediaImage(principal.orgId(), caseId, ordinal)
                .map(loaded -> org.springframework.http.ResponseEntity.ok()
                        .contentType(org.springframework.http.MediaType.parseMediaType(
                                loaded.meta().contentType() == null ? "image/jpeg" : loaded.meta().contentType()))
                        .header("Cache-Control", "private, max-age=300")
                        .header("X-Content-Type-Options", "nosniff")
                        .body(loaded.bytes()))
                .orElse(org.springframework.http.ResponseEntity.notFound().build());
    }

    @PostMapping("/teach")
    public CaseDetailView teach(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID caseId,
                                @Valid @RequestBody CaseTeachRequest request) {
        return service.teach(principal.orgId(), caseId, request, principal.userId(), name(principal));
    }

    @PostMapping("/draft")
    public CaseDetailView editDraft(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID caseId,
                                    @Valid @RequestBody CaseDraftEditRequest request) {
        return service.editDraft(principal.orgId(), caseId, request, principal.userId(), name(principal));
    }

    @PostMapping("/correction")
    public CaseDetailView correct(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID caseId,
                                  @Valid @RequestBody CaseCorrectionRequest request) {
        return service.correct(principal.orgId(), caseId, request, principal.userId(), name(principal));
    }

    private String name(AuthPrincipal principal) {
        return users.findById(principal.userId()).map(User::getName).orElse(null);
    }
}
