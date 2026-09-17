package com.sellerops.knowledge.spine;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.knowledge.spine.dto.CompiledKnowledgeView;
import com.sellerops.knowledge.spine.dto.KnowledgeSpineSearchResponse;
import com.sellerops.knowledge.spine.dto.KnowledgeTraceView;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The read path onto the Knowledge Spine — what an operator surface or the agent runtime calls with the seller's
 * bearer to ask what this company knows.
 *
 * <p>Three GETs and nothing else. The organisation comes from the JWT and never from a parameter; a product of
 * another organisation is a 404. No route writes, calls a model or reaches a marketplace.
 */
@RestController
@RequestMapping("/api/knowledge/spine")
public class KnowledgeSpineController {

    private final KnowledgeSpineService spine;

    public KnowledgeSpineController(KnowledgeSpineService spine) {
        this.spine = spine;
    }

    /** One scoped search across every raw source. Without {@code productId}, company-level knowledge only. */
    @GetMapping("/search")
    public KnowledgeSpineSearchResponse search(@AuthenticationPrincipal AuthPrincipal principal,
                                               @RequestParam String q,
                                               @RequestParam(required = false) UUID productId,
                                               @RequestParam(required = false, defaultValue = "0") int limit) {
        return spine.search(principal.orgId(), productId, q, limit);
    }

    /** The compiled read for one product, or for the company when no product is named. */
    @GetMapping("/compiled")
    public CompiledKnowledgeView compiled(@AuthenticationPrincipal AuthPrincipal principal,
                                          @RequestParam(required = false) UUID productId) {
        return spine.compiled(principal.orgId(), productId);
    }

    /** One entry followed back to the raw rows it stands on. */
    @GetMapping("/trace")
    public KnowledgeTraceView trace(@AuthenticationPrincipal AuthPrincipal principal,
                                    @RequestParam String entryId,
                                    @RequestParam(required = false) UUID productId) {
        return spine.trace(principal.orgId(), productId, entryId);
    }
}
