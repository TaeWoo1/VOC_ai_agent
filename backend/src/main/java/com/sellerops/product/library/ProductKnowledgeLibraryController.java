package com.sellerops.product.library;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.product.library.dto.KnowledgeSearchResponse;
import com.sellerops.product.library.dto.KnowledgeSourceRequest;
import com.sellerops.product.library.dto.KnowledgeSourceView;
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
 * The seller's product-knowledge library: list, write, revise, remove, and search within one product.
 *
 * <p>Every route is org-scoped from the JWT and re-checks the product's ownership in the service, so a
 * product id from another tenant is a 404 rather than a leak.
 *
 * <p><b>Search is a READ and nothing else.</b> It reaches no channel, spends no model call, and is the
 * same method the Agent's retrieval tool calls — one implementation, so what the seller can see in the
 * library is exactly what an answer is allowed to quote.
 */
@RestController
@RequestMapping("/api/products")
public class ProductKnowledgeLibraryController {

    private final ProductKnowledgeLibraryService library;
    private final UserRepository users;

    public ProductKnowledgeLibraryController(ProductKnowledgeLibraryService library, UserRepository users) {
        this.library = library;
        this.users = users;
    }

    @GetMapping("/{productId}/knowledge/sources")
    public List<KnowledgeSourceView> list(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable UUID productId) {
        return library.list(principal.orgId(), productId);
    }

    @PostMapping("/{productId}/knowledge/sources")
    @ResponseStatus(HttpStatus.CREATED)
    public KnowledgeSourceView create(@AuthenticationPrincipal AuthPrincipal principal,
                                      @PathVariable UUID productId,
                                      @Valid @RequestBody KnowledgeSourceRequest request) {
        return library.create(principal.orgId(), productId, request, principal.userId(),
                authorName(principal));
    }

    @PutMapping("/knowledge/sources/{sourceId}")
    public KnowledgeSourceView update(@AuthenticationPrincipal AuthPrincipal principal,
                                      @PathVariable UUID sourceId,
                                      @Valid @RequestBody KnowledgeSourceRequest request) {
        return library.update(principal.orgId(), sourceId, request);
    }

    @DeleteMapping("/knowledge/sources/{sourceId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID sourceId) {
        library.delete(principal.orgId(), sourceId);
    }

    /** Retrieval over one product's library. {@code limit} is capped by the service. */
    @GetMapping("/{productId}/knowledge/search")
    public KnowledgeSearchResponse search(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable UUID productId,
                                          @RequestParam String query,
                                          @RequestParam(required = false, defaultValue = "0") int limit) {
        return library.search(principal.orgId(), productId, query, limit);
    }

    /**
     * The display name stored beside a document.
     *
     * <p>Denormalized deliberately: a knowledge note's author is part of its provenance, and a
     * provenance that disappears when a teammate leaves the org is not provenance. The id is kept too,
     * so the two can be reconciled.
     */
    private String authorName(AuthPrincipal principal) {
        return users.findById(principal.userId()).map(User::getName).orElse(null);
    }
}
