package com.sellerops.knowledge.bootstrap;

import com.sellerops.auth.AuthPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 「Reviewnary가 배운 것」 — what the company's operating history has taught, and the one control that asks for it to be
 * learned now.
 *
 * <p>The organisation comes from the JWT and never from a parameter. The POST reads the seller's own channels
 * (bounded READ, {@link KnowledgeBootstrapService}); nothing here writes to a channel, approves, sends or calls a
 * model.
 */
@RestController
@RequestMapping("/api/knowledge/learned")
public class KnowledgeBootstrapController {

    /** The read, and — after the seller asked to learn — what that run did. */
    public record LearnedResponse(LearnedKnowledgeService.View learned, KnowledgeBootstrapService.Report lastRun) {
    }

    private final LearnedKnowledgeService learned;
    private final KnowledgeBootstrapService bootstrap;

    public KnowledgeBootstrapController(LearnedKnowledgeService learned, KnowledgeBootstrapService bootstrap) {
        this.learned = learned;
        this.bootstrap = bootstrap;
    }

    @GetMapping
    public LearnedResponse learned(@AuthenticationPrincipal AuthPrincipal principal) {
        return new LearnedResponse(learned.of(principal.orgId()), null);
    }

    @PostMapping("/bootstrap")
    public LearnedResponse learnFromHistory(@AuthenticationPrincipal AuthPrincipal principal) {
        KnowledgeBootstrapService.Report report = bootstrap.bootstrap(principal.orgId());
        return new LearnedResponse(learned.of(principal.orgId()), report);
    }
}
