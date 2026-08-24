package com.sellerops.knowledge.org;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.knowledge.org.dto.OrgKnowledgeSearchResponse;
import com.sellerops.knowledge.org.dto.OrgKnowledgeView;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 운영 정책 / 답변 기준 — list, write, revise, remove, and search the company's own operating rules.
 *
 * <p>Every route is org-scoped from the JWT and nothing takes an org id from the caller, so a policy
 * is reachable only by the company that wrote it.
 *
 * <p><b>Search is a READ and nothing else.</b> It reaches no channel, spends no model call, and is
 * the same method the draft retrieval calls — one implementation, so what the seller can see on the
 * settings screen is exactly what an answer is allowed to quote.
 */
@RestController
@RequestMapping("/api/org-knowledge")
public class OrgKnowledgeController {

    private final SellerOperationsKnowledgeService knowledge;
    private final UserRepository users;

    public OrgKnowledgeController(SellerOperationsKnowledgeService knowledge, UserRepository users) {
        this.knowledge = knowledge;
        this.users = users;
    }

    @GetMapping("/sources")
    public List<OrgKnowledgeView> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return knowledge.list(principal.orgId());
    }

    @PostMapping("/sources")
    @ResponseStatus(HttpStatus.CREATED)
    public OrgKnowledgeView create(@AuthenticationPrincipal AuthPrincipal principal,
                                   @Valid @RequestBody OrgKnowledgeRequest request) {
        return knowledge.create(principal.orgId(), request, principal.userId(), authorName(principal));
    }

    @PutMapping("/sources/{sourceId}")
    public OrgKnowledgeView update(@AuthenticationPrincipal AuthPrincipal principal,
                                   @PathVariable UUID sourceId,
                                   @Valid @RequestBody OrgKnowledgeRequest request) {
        return knowledge.update(principal.orgId(), sourceId, request);
    }

    @DeleteMapping("/sources/{sourceId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID sourceId) {
        knowledge.delete(principal.orgId(), sourceId);
    }

    /** Retrieval over the org's operating rules. {@code limit} is capped by the service. */
    @GetMapping("/search")
    public OrgKnowledgeSearchResponse search(@AuthenticationPrincipal AuthPrincipal principal,
                                             @RequestParam String query,
                                             @RequestParam(required = false, defaultValue = "0") int limit) {
        return knowledge.search(principal.orgId(), query, limit);
    }

    /**
     * The display name stored beside a policy.
     *
     * <p>Denormalized deliberately: who set a policy is part of it, and a provenance that disappears
     * when a teammate leaves the org is not provenance. The id is kept too, so the two reconcile.
     */
    private String authorName(AuthPrincipal principal) {
        return users.findById(principal.userId()).map(User::getName).orElse(null);
    }
}
