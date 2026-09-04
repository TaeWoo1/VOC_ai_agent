package com.sellerops.opportunity;

import com.sellerops.common.ApiException;
import com.sellerops.opportunity.dto.OpportunityDraftRequest;
import com.sellerops.opportunity.dto.OpportunityDraftView;
import com.sellerops.opportunity.dto.OpportunityKnowledgeView;
import com.sellerops.opportunity.dto.OpportunityView;
import com.sellerops.product.ProductSignalsService;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Derives improvement opportunities from the issue memory and joins the seller's decisions.
 *
 * <p><b>Derived on every read, never stored.</b> The issue list is the candidate gate — an opportunity
 * exists only for an issue the extractor holds with enough evidence ({@link OpportunityRules#qualifies}),
 * so "evidence 없는 제안" is unreachable by construction: every view carries the issue id its evidence
 * lives under. The knowledge check is a deterministic mention count over the seller's active sources.
 * No model is called anywhere in this package.
 *
 * <p><b>Writes are the seller's decisions, and only those.</b> Accept prepares a draft (a scaffold of
 * facts and the seller's own sentences) and remembers it; dismiss remembers the "not now"; restore
 * forgets. The draft's destination — the knowledge library, or the seller's clipboard — is outside this
 * package, through seams that already exist and already require the seller's hand.
 */
@Service
public class OpportunityService {

    static final int TITLE_MAX = 200;
    static final int BODY_MAX = 4000;

    private final ReviewIssueQueryService issues;
    private final ProductSignalsService productSignals;
    private final KnowledgeMentionCheck knowledge;
    private final ImprovementOpportunityRepository decisions;

    public OpportunityService(ReviewIssueQueryService issues, ProductSignalsService productSignals,
                              KnowledgeMentionCheck knowledge, ImprovementOpportunityRepository decisions) {
        this.issues = issues;
        this.productSignals = productSignals;
        this.knowledge = knowledge;
        this.decisions = decisions;
    }

    /**
     * Every opportunity for the org, or for one product, or for one issue — open and accepted, plus the
     * dismissed ones when asked. Ordered as the issue list is (severity, change, recency), guidance
     * before product review within an issue.
     */
    @Transactional(readOnly = true)
    public List<OpportunityView> list(UUID orgId, LocalDate referenceDate, UUID productId, UUID issueId,
                                      boolean includeDismissed) {
        List<ReviewIssueView> candidates;
        if (issueId != null) {
            candidates = List.of(issues.issueView(orgId, issueId, referenceDate));
        } else if (productId != null) {
            candidates = productSignals.issuesFor(orgId, productId, referenceDate);
        } else {
            candidates = issues.list(orgId, referenceDate);
        }
        List<ReviewIssueView> qualifying = candidates.stream().filter(OpportunityRules::qualifies).toList();
        Map<String, ImprovementOpportunity> decided = new HashMap<>();
        if (!qualifying.isEmpty()) {
            for (ImprovementOpportunity row : decisions.findByOrgIdAndIssueIdIn(orgId,
                    qualifying.stream().map(ReviewIssueView::id).toList())) {
                decided.put(key(row.getIssueId(), row.getKind()), row);
            }
        }
        List<OpportunityView> out = new ArrayList<>();
        for (ReviewIssueView issue : qualifying) {
            for (Derived d : derive(orgId, issue)) {
                ImprovementOpportunity row = decided.get(key(issue.id(), d.candidate().kind()));
                if (row != null && row.getStatus() == OpportunityStatus.DISMISSED && !includeDismissed) {
                    continue;
                }
                out.add(view(issue, d, row));
            }
        }
        return List.copyOf(out);
    }

    /** Accept: prepare the draft and remember it. Idempotent — accepting twice keeps the seller's edits. */
    @Transactional
    public OpportunityView accept(UUID orgId, UUID issueId, OpportunityKind kind, LocalDate referenceDate) {
        ReviewIssueView issue = issues.issueView(orgId, issueId, referenceDate);
        Derived d = requireDerived(orgId, issue, kind);
        ImprovementOpportunity row = decisions.findByOrgIdAndIssueIdAndKind(orgId, issueId, kind)
                .orElseGet(() -> newRow(orgId, issueId, kind));
        if (row.getStatus() != OpportunityStatus.ACCEPTED || row.getDraftBody() == null) {
            OpportunityDraftComposer.Draft draft = OpportunityDraftComposer.draft(issue, d.candidate(), d.mention());
            row.setDraftTitle(draft.title());
            row.setDraftBody(draft.body());
        }
        row.setStatus(OpportunityStatus.ACCEPTED);
        row.setDecidedAt(Instant.now());
        return view(issue, d, decisions.save(row));
    }

    /** Dismiss: "not now". The draft, if any, is dropped — a dismissed opportunity has no prepared action. */
    @Transactional
    public OpportunityView dismiss(UUID orgId, UUID issueId, OpportunityKind kind, LocalDate referenceDate) {
        ReviewIssueView issue = issues.issueView(orgId, issueId, referenceDate);
        Derived d = requireDerived(orgId, issue, kind);
        ImprovementOpportunity row = decisions.findByOrgIdAndIssueIdAndKind(orgId, issueId, kind)
                .orElseGet(() -> newRow(orgId, issueId, kind));
        row.setStatus(OpportunityStatus.DISMISSED);
        row.setDraftTitle(null);
        row.setDraftBody(null);
        row.setDecidedAt(Instant.now());
        return view(issue, d, decisions.save(row));
    }

    /** Restore: back to OPEN by forgetting the decision. Works from either decided state. */
    @Transactional
    public OpportunityView restore(UUID orgId, UUID issueId, OpportunityKind kind, LocalDate referenceDate) {
        ReviewIssueView issue = issues.issueView(orgId, issueId, referenceDate);
        Derived d = requireDerived(orgId, issue, kind);
        decisions.findByOrgIdAndIssueIdAndKind(orgId, issueId, kind).ifPresent(decisions::delete);
        return view(issue, d, null);
    }

    /** The seller's edit of a prepared draft. Only an ACCEPTED opportunity has one to edit. */
    @Transactional
    public OpportunityView updateDraft(UUID orgId, UUID issueId, OpportunityKind kind, LocalDate referenceDate,
                                       OpportunityDraftRequest request) {
        ReviewIssueView issue = issues.issueView(orgId, issueId, referenceDate);
        Derived d = requireDerived(orgId, issue, kind);
        ImprovementOpportunity row = decisions.findByOrgIdAndIssueIdAndKind(orgId, issueId, kind)
                .filter(r -> r.getStatus() == OpportunityStatus.ACCEPTED)
                .orElseThrow(() -> ApiException.conflict("초안이 준비된 기회에서만 수정할 수 있습니다."));
        String title = request == null || request.title() == null ? "" : request.title().strip();
        String body = request == null || request.body() == null ? "" : request.body().strip();
        if (title.isEmpty() || body.isEmpty()) {
            throw ApiException.badRequest("제목과 내용을 모두 적어 주세요.");
        }
        if (title.length() > TITLE_MAX || body.length() > BODY_MAX) {
            throw ApiException.badRequest("초안이 너무 깁니다 (제목 " + TITLE_MAX + "자, 내용 " + BODY_MAX + "자까지).");
        }
        row.setDraftTitle(title);
        row.setDraftBody(body);
        return view(issue, d, decisions.save(row));
    }

    // ---- derivation ---------------------------------------------------------------------------

    /** A candidate with the knowledge check it was derived against. */
    record Derived(OpportunityRules.Candidate candidate, KnowledgeMention mention) {
    }

    private List<Derived> derive(UUID orgId, ReviewIssueView issue) {
        OpportunityRules.GuidanceTarget target = OpportunityRules.guidanceTargetOf(issue);
        KnowledgeMention mention = null;
        if (target != null) {
            if (target.scope() == OpportunityRules.Scope.ORG) {
                mention = knowledge.org(orgId, issue.aspect(), target.orgType());
            } else if (issue.dominantProductId() != null) {
                mention = knowledge.product(orgId, issue.dominantProductId(), issue.aspect());
            }
        }
        boolean mentioned = mention != null && mention.mentioned();
        List<Derived> out = new ArrayList<>(2);
        for (OpportunityRules.Candidate c : OpportunityRules.derive(issue, mentioned)) {
            out.add(new Derived(c, c.lane() == OpportunityRules.Lane.GUIDANCE ? mention : null));
        }
        return out;
    }

    private Derived requireDerived(UUID orgId, ReviewIssueView issue, OpportunityKind kind) {
        return derive(orgId, issue).stream()
                .filter(d -> d.candidate().kind() == kind)
                .findFirst()
                // Same sentence whether the issue is gone, another org's, or no longer yields this kind:
                // a decision about an opportunity the evidence no longer supports is not a decision.
                .orElseThrow(() -> ApiException.notFound("이 개선 기회는 지금 제안되지 않습니다."));
    }

    private static ImprovementOpportunity newRow(UUID orgId, UUID issueId, OpportunityKind kind) {
        ImprovementOpportunity row = new ImprovementOpportunity();
        row.setOrgId(orgId);
        row.setIssueId(issueId);
        row.setKind(kind);
        return row;
    }

    private static String key(UUID issueId, OpportunityKind kind) {
        return issueId + ":" + kind.name();
    }

    private static OpportunityView view(ReviewIssueView issue, Derived d, ImprovementOpportunity row) {
        OpportunityRules.Candidate c = d.candidate();
        OpportunityStatus status = row == null ? OpportunityStatus.OPEN : row.getStatus();
        OpportunityKnowledgeView knowledgeView = null;
        if (c.lane() == OpportunityRules.Lane.GUIDANCE && d.mention() != null) {
            knowledgeView = new OpportunityKnowledgeView(
                    c.target().scope().name(),
                    OpportunityDraftComposer.scopeLabelKo(c.target()),
                    c.target().scope() == OpportunityRules.Scope.ORG
                            ? c.target().orgType().name() : c.target().productType().name(),
                    OpportunityDraftComposer.topicOf(c.target(), issue.aspect()),
                    d.mention().sources(), d.mention().mentions(), d.mention().excerpts());
        }
        OpportunityDraftView draft = row != null && status == OpportunityStatus.ACCEPTED && row.getDraftBody() != null
                ? new OpportunityDraftView(row.getDraftTitle(), row.getDraftBody(), row.getUpdatedAt())
                : null;
        return new OpportunityView(
                issue.id(), c.kind().name(), c.kind().labelKo(),
                status.name(), status.labelKo(),
                issue.title(), issue.aspect(), issue.problem(), issue.severity(),
                issue.evidenceCount(), issue.firstEvidenceOn(), issue.lastEvidenceOn(),
                issue.change() == null ? List.of() : issue.change().labelsKo(),
                issue.dominantProductId(), issue.dominantProductName(),
                OpportunityDraftComposer.why(issue, c, d.mention()),
                OpportunityDraftComposer.recommendation(issue, c, d.mention()),
                "/memory/" + issue.id(),
                knowledgeView,
                c.kind().actionLabelKo(),
                draft,
                row == null ? null : row.getDecidedAt());
    }
}
