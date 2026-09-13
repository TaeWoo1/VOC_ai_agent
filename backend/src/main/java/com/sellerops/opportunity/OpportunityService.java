package com.sellerops.opportunity;

import com.sellerops.common.ApiException;
import com.sellerops.opportunity.dto.OpportunityDraftRequest;
import com.sellerops.opportunity.dto.OpportunityDraftView;
import com.sellerops.opportunity.dto.OpportunityEventView;
import com.sellerops.opportunity.dto.OpportunityKnowledgeView;
import com.sellerops.opportunity.dto.OpportunityView;
import com.sellerops.product.ProductSignalsService;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
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
 * puts the opportunity back to open. The draft's destination — the knowledge library, or the seller's
 * clipboard — is outside this package, through seams that already exist and already require the
 * seller's hand.
 *
 * <p><b>And every one of those writes is also appended to a trail.</b> Until V103 the decision was a
 * single mutable row: dismiss erased the seller's edited text, restore deleted the row, and the whole
 * sequence 채택 → 수정 → 보류 → 되돌림 left nothing behind. Two rules hold now and both are asserted:
 * the seller's prepared text is never destroyed by a decision (a dismissal hides it, the view does
 * that), and every decision appends one {@link OpportunityDecisionEvent} naming the status it left.
 * The trail is append-only — nothing in this class updates or deletes one.
 */
@Service
public class OpportunityService {

    static final int TITLE_MAX = 200;
    static final int BODY_MAX = 4000;

    private final ReviewIssueQueryService issues;
    private final ProductSignalsService productSignals;
    private final KnowledgeMentionCheck knowledge;
    private final ImprovementOpportunityRepository decisions;
    private final OpportunityDecisionEventRepository trail;

    public OpportunityService(ReviewIssueQueryService issues, ProductSignalsService productSignals,
                              KnowledgeMentionCheck knowledge, ImprovementOpportunityRepository decisions,
                              OpportunityDecisionEventRepository trail) {
        this.issues = issues;
        this.productSignals = productSignals;
        this.knowledge = knowledge;
        this.decisions = decisions;
        this.trail = trail;
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
        // One query for every trail on the page. Loading it per card would be a read per opportunity
        // on a screen that already costs one per issue; loading it lazily would let a card render a
        // decision badge above an empty history for as long as the second request took.
        Map<UUID, List<OpportunityEventView>> history = historyOf(orgId, decided.values());
        List<OpportunityView> out = new ArrayList<>();
        for (ReviewIssueView issue : qualifying) {
            for (Derived d : derive(orgId, issue)) {
                ImprovementOpportunity row = decided.get(key(issue.id(), d.candidate().kind()));
                if (row != null && row.getStatus() == OpportunityStatus.DISMISSED && !includeDismissed) {
                    continue;
                }
                out.add(view(issue, d, row, row == null ? List.of()
                        : history.getOrDefault(row.getId(), List.of())));
            }
        }
        return List.copyOf(out);
    }

    /**
     * The opportunities whose draft is prepared and still derivable — what the Operations Home may
     * call 준비된 작업.
     *
     * <p><b>The decided rows are the gate, not the issue list.</b> Only a row the seller accepted can
     * be prepared work, and those are few; deriving over every issue first would make the Home pay for
     * the whole issue memory to find them. An org that has accepted nothing pays one indexed query.
     *
     * <p><b>Re-derived before it is counted.</b> An opportunity whose issue was since resolved,
     * dismissed, or fell under the repeat threshold is not prepared work — its row is inert, and a
     * Home that counted it would be asking for work the workspace no longer offers.
     */
    @Transactional(readOnly = true)
    public List<PreparedDraft> preparedDrafts(UUID orgId, LocalDate referenceDate) {
        List<ImprovementOpportunity> accepted = decisions.findByOrgIdAndStatus(orgId, OpportunityStatus.ACCEPTED)
                .stream().filter(r -> r.getDraftBody() != null && !r.getDraftBody().isBlank()).toList();
        if (accepted.isEmpty()) {
            return List.of();
        }
        Map<UUID, List<OpportunityEventView>> history = historyOf(orgId, accepted);
        List<PreparedDraft> out = new ArrayList<>();
        for (ImprovementOpportunity row : accepted) {
            ReviewIssueView issue;
            try {
                issue = issues.issueView(orgId, row.getIssueId(), referenceDate);
            } catch (ApiException e) {
                continue;
            }
            derive(orgId, issue).stream()
                    .filter(d -> d.candidate().kind() == row.getKind())
                    .findFirst()
                    .ifPresent(d -> out.add(new PreparedDraft(row.getId(), view(issue, d, row,
                            history.getOrDefault(row.getId(), List.of())))));
        }
        return List.copyOf(out);
    }

    /**
     * A prepared draft and the id of the DECISION behind it.
     *
     * <p>The opportunity itself still has no id — it is derived, and {@code (issueId, kind)} names it
     * everywhere a client does. The decision row does have one, and a caller that must tell two
     * prepared drafts on the same repeated problem apart needs exactly that and nothing more. It is
     * not an address: no route takes it.
     */
    public record PreparedDraft(UUID decisionId, OpportunityView opportunity) {
    }

    private Map<UUID, List<OpportunityEventView>> historyOf(UUID orgId,
                                                            Collection<ImprovementOpportunity> rows) {
        if (rows.isEmpty()) {
            return Map.of();
        }
        Map<UUID, List<OpportunityEventView>> out = new HashMap<>();
        for (OpportunityDecisionEvent e : trail.findByOrgIdAndOpportunityIdInOrderByDecidedAtAsc(
                orgId, rows.stream().map(ImprovementOpportunity::getId).toList())) {
            out.computeIfAbsent(e.getOpportunityId(), k -> new ArrayList<>()).add(eventView(e));
        }
        return out;
    }

    private static OpportunityEventView eventView(OpportunityDecisionEvent e) {
        return new OpportunityEventView(e.getEvent().name(), e.getEvent().labelKo(),
                e.getStatusFrom() == null ? null : e.getStatusFrom().name(),
                e.getStatusTo().name(), e.getEvidenceCount(), e.getDecidedAt());
    }

    /**
     * Accept: prepare the draft and remember it. Idempotent — accepting an already-accepted
     * opportunity keeps the seller's edits and appends nothing, because nothing was decided.
     */
    @Transactional
    public OpportunityView accept(UUID orgId, UUID actorId, UUID issueId, OpportunityKind kind,
                                  LocalDate referenceDate) {
        ReviewIssueView issue = issues.issueView(orgId, issueId, referenceDate);
        Derived d = requireDerived(orgId, issue, kind);
        ImprovementOpportunity row = locked(orgId, issueId, kind);
        OpportunityStatus from = statusOf(row);
        if (row == null) {
            row = newRow(orgId, issueId, kind);
        }
        // The composer only writes where the seller has not. A draft already on the row is either the
        // scaffold or the seller's rewrite of it, and this path cannot tell them apart — so it keeps
        // whichever it finds rather than replacing sentences somebody may have written by hand.
        if (row.getDraftBody() == null || row.getDraftBody().isBlank()) {
            OpportunityDraftComposer.Draft draft = OpportunityDraftComposer.draft(issue, d.candidate(), d.mention());
            row.setDraftTitle(draft.title());
            row.setDraftBody(draft.body());
        }
        return settle(orgId, actorId, issue, d, row, from, OpportunityStatus.ACCEPTED,
                OpportunityEvent.ACCEPTED);
    }

    /**
     * Dismiss: "not now".
     *
     * <p><b>The prepared text is not erased.</b> A dismissed opportunity has no prepared action and
     * the view says so by not carrying one — but 「지금은 보류」 is a decision about the suggestion, not
     * a request to delete sentences the seller wrote. Until V103 this nulled both draft columns, so a
     * seller who edited a draft and then deferred it lost the edit with no record that it had existed.
     */
    @Transactional
    public OpportunityView dismiss(UUID orgId, UUID actorId, UUID issueId, OpportunityKind kind,
                                   LocalDate referenceDate) {
        ReviewIssueView issue = issues.issueView(orgId, issueId, referenceDate);
        Derived d = requireDerived(orgId, issue, kind);
        ImprovementOpportunity row = locked(orgId, issueId, kind);
        OpportunityStatus from = statusOf(row);
        if (row == null) {
            row = newRow(orgId, issueId, kind);
        }
        return settle(orgId, actorId, issue, d, row, from, OpportunityStatus.DISMISSED,
                OpportunityEvent.DISMISSED);
    }

    /**
     * Restore: back to open.
     *
     * <p><b>The row is not deleted.</b> Deleting it would take the trail beneath it with it (the
     * events cascade off this row), which is the one thing this package must not be able to do: a
     * seller could then erase their own decision history by pressing 되돌리기. The row stays at
     * {@code OPEN}, which is what an absent row has always meant to every reader.
     */
    @Transactional
    public OpportunityView restore(UUID orgId, UUID actorId, UUID issueId, OpportunityKind kind,
                                   LocalDate referenceDate) {
        ReviewIssueView issue = issues.issueView(orgId, issueId, referenceDate);
        Derived d = requireDerived(orgId, issue, kind);
        ImprovementOpportunity row = locked(orgId, issueId, kind);
        if (row == null) {
            // Nothing was decided, so nothing is taken back and nothing is appended.
            return view(issue, d, null, List.of());
        }
        return settle(orgId, actorId, issue, d, row, row.getStatus(), OpportunityStatus.OPEN,
                OpportunityEvent.REOPENED);
    }

    /** The seller's edit of a prepared draft. Only an ACCEPTED opportunity has one to edit. */
    @Transactional
    public OpportunityView updateDraft(UUID orgId, UUID actorId, UUID issueId, OpportunityKind kind,
                                       LocalDate referenceDate, OpportunityDraftRequest request) {
        ReviewIssueView issue = issues.issueView(orgId, issueId, referenceDate);
        Derived d = requireDerived(orgId, issue, kind);
        ImprovementOpportunity row = decisions.findWithLockByOrgIdAndIssueIdAndKind(orgId, issueId, kind)
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
        boolean changed = !title.equals(row.getDraftTitle()) || !body.equals(row.getDraftBody());
        row.setDraftTitle(title);
        row.setDraftBody(body);
        if (!changed) {
            // Saving the same text is not an edit. A trail that recorded it would grow a row every
            // time a seller pressed 저장 to close the editor.
            return view(issue, d, decisions.save(row), historyFor(orgId, row));
        }
        return settle(orgId, actorId, issue, d, row, OpportunityStatus.ACCEPTED, OpportunityStatus.ACCEPTED,
                OpportunityEvent.EDITED);
    }

    // ---- decision writing ---------------------------------------------------------------------

    /**
     * Save the decision and append exactly one event for it.
     *
     * <p>{@code from} is read under the lock before anything changes, so the event names the status
     * actually left. A decision that changes nothing ({@code from == to} outside an edit) appends
     * nothing — pressing a button twice is one decision.
     */
    private OpportunityView settle(UUID orgId, UUID actorId, ReviewIssueView issue, Derived d,
                                   ImprovementOpportunity row, OpportunityStatus from,
                                   OpportunityStatus to, OpportunityEvent event) {
        boolean isDecision = event == OpportunityEvent.EDITED || from != to;
        row.setStatus(to);
        if (isDecision) {
            row.setDecidedAt(Instant.now());
        } else if (row.getDecidedAt() == null) {
            row.setDecidedAt(Instant.now());
        }
        ImprovementOpportunity saved = decisions.save(row);
        if (isDecision) {
            OpportunityDecisionEvent e = new OpportunityDecisionEvent();
            e.setOrgId(orgId);
            e.setOpportunityId(saved.getId());
            e.setIssueId(saved.getIssueId());
            e.setKind(saved.getKind());
            e.setEvent(event);
            // Null on the first event about this opportunity: there was no standing decision to leave.
            e.setStatusFrom(from == OpportunityStatus.OPEN && event != OpportunityEvent.REOPENED ? null : from);
            e.setStatusTo(to);
            e.setEvidenceCount(issue.evidenceCount());
            e.setActorId(actorId);
            e.setDecidedAt(saved.getDecidedAt());
            trail.save(e);
        }
        return view(issue, d, saved, historyFor(orgId, saved));
    }

    private List<OpportunityEventView> historyFor(UUID orgId, ImprovementOpportunity row) {
        return historyOf(orgId, List.of(row)).getOrDefault(row.getId(), List.of());
    }

    /** The standing status, or {@code OPEN} when nothing has been decided. */
    private static OpportunityStatus statusOf(ImprovementOpportunity row) {
        return row == null ? OpportunityStatus.OPEN : row.getStatus();
    }

    private ImprovementOpportunity locked(UUID orgId, UUID issueId, OpportunityKind kind) {
        return decisions.findWithLockByOrgIdAndIssueIdAndKind(orgId, issueId, kind).orElse(null);
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

    private static OpportunityView view(ReviewIssueView issue, Derived d, ImprovementOpportunity row,
                                        List<OpportunityEventView> history) {
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
                history,
                // An opportunity that is open has no decision date, whether that is because nothing
                // was ever decided or because the seller took a decision back. Reporting the restore
                // instant beside 「검토 전」 would put a date on a decision that no longer stands.
                row == null || status == OpportunityStatus.OPEN ? null : row.getDecidedAt());
    }
}
