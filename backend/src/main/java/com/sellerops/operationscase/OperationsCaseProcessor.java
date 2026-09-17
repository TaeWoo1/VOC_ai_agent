package com.sellerops.operationscase;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.connector.DataType;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.operationscase.investigation.CaseDraftPreparer;
import com.sellerops.operationscase.investigation.CaseInvestigationOutput;
import com.sellerops.operationscase.investigation.CaseInvestigationService;
import com.sellerops.operationscase.investigation.CaseInvestigator;
import com.sellerops.responsibility.Responsibility;
import com.sellerops.responsibility.ResponsibilityRepository;
import com.sellerops.responsibility.ResponsibilityRollout;
import com.sellerops.responsibility.ResponsibilityRun;
import com.sellerops.responsibility.ResponsibilityRunCoordinator;
import com.sellerops.responsibility.ResponsibilityRunRepository;
import com.sellerops.responsibility.ResponsibilityRunSource;
import com.sellerops.responsibility.ResponsibilityRunSourceRepository;
import com.sellerops.responsibility.ResponsibilitySources;
import com.sellerops.responsibility.SourceFailureReason;
import com.sellerops.review.Review;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * <b>What a run's observation means.</b> Called once per run attempt, after every required source has a fact and
 * while the run's lease is still held. Four steps, in this order:
 *
 * <ol>
 *   <li><b>Reconcile</b> every open case against canonical truth first — an inquiry answered overnight is closed
 *   before this run considers anything new, so the run cannot re-raise work it would have retired.</li>
 *   <li><b>Gaps.</b> A source the seller must reconnect before Reviewnary can read it becomes ONE open case per
 *   account; the same failure in a later run updates that case; a complete read closes it.</li>
 *   <li><b>Discover.</b> Rows this responsibility is responsible for — those that arrived after it first read the
 *   source completely — whose customer-side state has not been processed yet. An unchanged row matches an existing
 *   signature and writes nothing. A changed row with an open case updates that case; it never opens a second.</li>
 *   <li><b>Decide.</b> The rules settle what is obvious. Only what they cannot settle is investigated, and only up to
 *   {@code max-per-run}; the rest stay candidates for the next run (nothing is written for them).</li>
 * </ol>
 *
 * <p><b>Restart-safe without a ledger of its own.</b> Every step re-reads the database, every write is idempotent
 * (signature unique, one open case per subject), and a reclaimed attempt simply calls this again.
 */
@Component
public class OperationsCaseProcessor {

    private static final Logger log = LoggerFactory.getLogger(OperationsCaseProcessor.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    static final int CANDIDATE_SCAN = 200;
    /**
     * How far back a row can still change. The Cafe24 routine read reaches 14 days; a row older than that is not
     * re-read, so it cannot change under this responsibility, and re-checking it every run is a scan for nothing.
     */
    static final Duration ACQUISITION_REACH = Duration.ofDays(15);
    static final Set<SourceFailureReason> SELLER_ACTIONABLE =
            EnumSet.of(SourceFailureReason.AUTH_REQUIRED, SourceFailureReason.NOT_CONNECTED);

    private final ResponsibilityRunRepository runs;
    private final ResponsibilityRepository responsibilities;
    private final ResponsibilityRunSourceRepository sourceRows;
    private final ResponsibilitySources sources;
    private final ResponsibilityRollout rollout;
    private final OperationsCaseRepository cases;
    private final OperationsCaseEventRepository events;
    private final OperationsCaseReconciler reconciler;
    private final CaseInvestigator investigator;
    private final CaseInvestigationService investigation;
    private final CaseDraftPreparer drafts;
    private final InquiryWorkItemRepository workItems;
    private final ChannelRepository channels;
    private final Clock clock;
    /**
     * Which store a device-carried marketplace review read covers, when this deployment has that lane. Set by the
     * container, absent in wiring that predates it — and absent means discovery looks at the template's official
     * sources only, exactly as before.
     */
    private com.sellerops.responsibility.aside.AsideMarketplaceTarget marketplaceTargets;

    @Autowired(required = false)
    void setMarketplaceTargets(List<com.sellerops.responsibility.aside.AsideMarketplaceTarget> resolvers) {
        this.marketplaceTargets = com.sellerops.responsibility.aside.AsideMarketplaceTarget.firstOf(resolvers);
    }

    @Autowired
    public OperationsCaseProcessor(ResponsibilityRunRepository runs, ResponsibilityRepository responsibilities,
                                   ResponsibilityRunSourceRepository sourceRows, ResponsibilitySources sources,
                                   ResponsibilityRollout rollout, OperationsCaseRepository cases,
                                   OperationsCaseEventRepository events, OperationsCaseReconciler reconciler,
                                   CaseInvestigator investigator, CaseInvestigationService investigation,
                                   CaseDraftPreparer drafts, InquiryWorkItemRepository workItems,
                                   ChannelRepository channels) {
        this(runs, responsibilities, sourceRows, sources, rollout, cases, events, reconciler, investigator,
                investigation, drafts, workItems, channels, Clock.systemUTC());
    }

    public OperationsCaseProcessor(ResponsibilityRunRepository runs, ResponsibilityRepository responsibilities,
                                   ResponsibilityRunSourceRepository sourceRows, ResponsibilitySources sources,
                                   ResponsibilityRollout rollout, OperationsCaseRepository cases,
                                   OperationsCaseEventRepository events, OperationsCaseReconciler reconciler,
                                   CaseInvestigator investigator, CaseInvestigationService investigation,
                                   CaseDraftPreparer drafts, InquiryWorkItemRepository workItems,
                                   ChannelRepository channels, Clock clock) {
        this.runs = runs;
        this.responsibilities = responsibilities;
        this.sourceRows = sourceRows;
        this.sources = sources;
        this.rollout = rollout;
        this.cases = cases;
        this.events = events;
        this.reconciler = reconciler;
        this.investigator = investigator;
        this.investigation = investigation;
        this.drafts = drafts;
        this.workItems = workItems;
        this.channels = channels;
        this.clock = clock;
    }

    /** What one pass did. Counts only. */
    public record Report(int reconciledActed, int reconciledClosed, int unchanged, int opened, int updated,
                         int ruleDecided, int investigated, int investigationFailed, int investigationSkipped,
                         int deferred, int draftsPrepared, int gapsOpened, int gapsRepeated, int gapsRecovered,
                         int blocked) {
    }

    private static final class Counters {
        int acted;
        int closed;
        int unchanged;
        int opened;
        int updated;
        int ruleDecided;
        int investigated;
        int failed;
        int skipped;
        int deferred;
        int drafts;
        int gapsOpened;
        int gapsRepeated;
        int gapsRecovered;
        int blocked;
        int investigationsStarted;

        Report report() {
            return new Report(acted, closed, unchanged, opened, updated, ruleDecided, investigated, failed, skipped,
                    deferred, drafts, gapsOpened, gapsRepeated, gapsRecovered, blocked);
        }
    }

    public Report process(UUID runId, BooleanSupplier stop) {
        Counters k = new Counters();
        ResponsibilityRun run = runs.findById(runId).orElse(null);
        if (run == null || !rollout.allows(run.getOrgId())) {
            return k.report();
        }
        Responsibility responsibility = responsibilities.findById(run.getResponsibilityId()).orElse(null);
        if (responsibility == null) {
            return k.report();
        }
        OperationsCaseReconciler.Report reconciled =
                reconciler.reconcile(run.getOrgId(), responsibility.getId(), runId);
        k.acted = reconciled.acted();
        k.closed = reconciled.closed();
        observeGaps(run, k);
        discover(run, responsibility, stop, k);
        Report report = k.report();
        log.info("responsibility cases run={} 재확인(판매자조치/종료)={}/{} 변화없음={} 새Case={} 갱신={} 규칙={} 조사={} "
                        + "조사실패={} 조사생략={} 다음run으로={} 초안={} 장애열림={} 장애반복={} 장애복구={}",
                runId, report.reconciledActed(), report.reconciledClosed(), report.unchanged(), report.opened(),
                report.updated(), report.ruleDecided(), report.investigated(), report.investigationFailed(),
                report.investigationSkipped(), report.deferred(), report.draftsPrepared(), report.gapsOpened(),
                report.gapsRepeated(), report.gapsRecovered());
        return report;
    }

    // ── gaps ────────────────────────────────────────────────────────────────────────────────────────────────────

    private void observeGaps(ResponsibilityRun run, Counters k) {
        Map<UUID, List<ResponsibilityRunSource>> byAccount = ResponsibilityRunCoordinator
                .latestPerSource(sourceRows.findByRunIdOrderByAttemptAscCreatedAtAsc(run.getId()))
                .values().stream()
                .collect(Collectors.groupingBy(ResponsibilityRunSource::getSellerAccountId, LinkedHashMap::new,
                        Collectors.toList()));
        Map<String, Channel> channelByCode = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getCode, c -> c, (a, b) -> a));
        for (Map.Entry<UUID, List<ResponsibilityRunSource>> entry : byAccount.entrySet()) {
            UUID accountId = entry.getKey();
            List<ResponsibilityRunSource> latest = entry.getValue();
            if (latest.stream().anyMatch(r -> r.getCompleteness() == null)) {
                continue;
            }
            Optional<OperationsCase> open = cases.findByOrgIdAndSubjectKindAndSubjectIdAndStatus(
                    run.getOrgId(), OperationsSubjectKind.SOURCE, accountId, OperationsCaseStatus.PREPARED);
            List<ResponsibilityRunSource> blocked = latest.stream()
                    .filter(r -> !r.getCompleteness().settled() && r.getFailureReason() != null
                            && SELLER_ACTIONABLE.contains(r.getFailureReason()))
                    .toList();
            if (!blocked.isEmpty()) {
                String family = blocked.stream().anyMatch(r -> r.getFailureReason() == SourceFailureReason.AUTH_REQUIRED)
                        ? "AUTH" : "CONNECTION";
                String types = blocked.stream().map(ResponsibilityRunSource::getDataType).distinct().sorted()
                        .collect(Collectors.joining(","));
                String state = OperationsSignal.truncate(OperationsSignal.gapState(family, types));
                if (open.isPresent() && open.get().getSourceState().startsWith("rr:gap;family=" + family + ";")) {
                    OperationsCase gap = open.get();
                    if (!run.getId().equals(gap.getLastRunId())) {
                        gap.setLastRunId(run.getId());
                        gap.setSourceState(state);
                        OperationsCase saved = cases.save(gap);
                        event(saved, run.getId(), CaseEventActor.SYSTEM, CaseEventKind.OBSERVED_AGAIN,
                                Map.of("family", family, "dataTypes", types));
                        k.gapsRepeated++;
                    }
                    continue;
                }
                open.ifPresent(stale -> close(stale, run.getId(), CaseResolution.SUPERSEDED,
                        CaseEventKind.RECONCILED_CLOSED, Map.of("observed", "GAP_FAMILY_CHANGED")));
                Channel channel = channelByCode.get(blocked.get(0).getChannelCode());
                CaseReason reason = "AUTH".equals(family) ? CaseReason.SOURCE_AUTH_REQUIRED
                        : CaseReason.SOURCE_NOT_CONNECTED;
                OperationsCase gap = newCase(run, OperationsCaseKind.OBSERVATION_GAP, OperationsSubjectKind.SOURCE,
                        accountId, state, OperationsSignal.signature(run.getOrgId(), OperationsSubjectKind.SOURCE,
                                accountId, state, run.getId()));
                gap.setChannelId(channel == null ? null : channel.getId());
                gap.setReason(reason);
                gap.setReasonNote(reason.noteKo());
                gap.setPriority(CasePriority.HIGH);
                gap.setRequiredAuthority(RequiredAuthority.HUMAN);
                gap.setDecidedBy(CaseDecider.RULE);
                gap.setRecommendedAction((channel == null ? "채널" : channel.getNameKo()) + " 다시 연결하기");
                try {
                    OperationsCase saved = cases.saveAndFlush(gap);
                    event(saved, run.getId(), CaseEventActor.SYSTEM, CaseEventKind.OPENED,
                            Map.of("family", family, "dataTypes", types, "decidedBy", "RULE"));
                    k.gapsOpened++;
                } catch (DataIntegrityViolationException race) {
                    k.blocked++;
                }
            } else if (open.isPresent() && latest.stream().allMatch(r -> r.getCompleteness().settled())) {
                close(open.get(), run.getId(), CaseResolution.OBSERVED_AGAIN, CaseEventKind.RECOVERED,
                        Map.of("observed", "ALL_SOURCES_SETTLED"));
                k.gapsRecovered++;
            }
        }
    }

    // ── discover ────────────────────────────────────────────────────────────────────────────────────────────────

    private void discover(ResponsibilityRun run, Responsibility responsibility, BooleanSupplier stop, Counters k) {
        UUID orgId = run.getOrgId();
        Instant reach = clock.instant().minus(ACQUISITION_REACH);
        Set<UUID> reviewChannels = new HashSet<>();
        for (ResponsibilitySources.ResolvedSource source : sources.resolve(orgId, responsibility.getTemplateCode())) {
            if (stop.getAsBoolean()) {
                return;
            }
            Instant baseline = cases.firstSettledObservation(orgId, responsibility.getId(), source.account().getId(),
                    source.dataType().name());
            if (baseline == null) {
                continue;   // Never read completely yet: nothing can be «new since» a read that has not happened.
            }
            Instant since = baseline.isAfter(reach) ? baseline : reach;
            if (source.dataType() == DataType.INQUIRY) {
                for (Inquiry inquiry : cases.inquiryCandidates(orgId, source.account().getId(), since,
                        PageRequest.of(0, CANDIDATE_SCAN))) {
                    if (stop.getAsBoolean()) {
                        return;
                    }
                    handleInquiry(run, responsibility, inquiry, k);
                }
            } else if (source.dataType() == DataType.REVIEW && reviewChannels.add(source.account().getChannelId())) {
                for (Review review : cases.reviewCandidates(orgId, source.account().getChannelId(), since,
                        PageRequest.of(0, CANDIDATE_SCAN))) {
                    if (stop.getAsBoolean()) {
                        return;
                    }
                    handleReview(run, responsibility, review, k);
                }
            }
        }
        discoverDeviceReviews(run, responsibility, stop, k, reach, reviewChannels);
    }

    /**
     * <b>Reviews and inquiries a scheduled browser read brought in — by the same rule, and only from the same boundary.</b>
     *
     * <p>A marketplace device read (NAVER Seller Center 리뷰) is deliberately NOT one of the template's sources: it
     * must not fail a run or report 「확인하지 못함」 about the seller's owed data. What it stores, though, is ordinary
     * canonical reviews, and a new one deserves the same case as a new review from any other source. So discovery
     * asks the same two questions of it: has this responsibility settled a read of that store yet (its first
     * {@code BOUNDED} observation is the hand-over boundary — reviews stored by that first read were already there
     * and belong to the existing screens), and what arrived after. Same candidate query, same rules, same dedup.
     */
    private void discoverDeviceReviews(ResponsibilityRun run, Responsibility responsibility, BooleanSupplier stop,
                                       Counters k, Instant reach, Set<UUID> reviewChannels) {
        if (marketplaceTargets == null) {
            return;
        }
        UUID orgId = run.getOrgId();
        for (String declared : responsibility.getTemplateCode().deviceRecipes()) {
            com.sellerops.responsibility.aside.AsideRecipe recipe;
            try {
                recipe = com.sellerops.responsibility.aside.AsideRecipe.valueOf(declared);
            } catch (IllegalArgumentException unknown) {
                continue;
            }
            DataType recipeType = recipe.dataType().orElse(null);
            if (!recipe.readsMarketplace() || (recipeType != DataType.REVIEW && recipeType != DataType.INQUIRY)) {
                continue;
            }
            Optional<com.sellerops.responsibility.aside.AsideMarketplaceTarget.Target> target =
                    marketplaceTargets.resolve(orgId, recipe);
            if (target.isEmpty()) {
                continue;
            }
            if (recipeType == DataType.INQUIRY) {
                // Inquiries are scoped by the ACCOUNT they were read for (the same candidate query the template's
                // inquiry sources use), and the boundary is this account's first settled inquiry read.
                UUID accountId = target.get().sellerAccountId();
                Instant inquiryBaseline = cases.firstSettledObservation(orgId, responsibility.getId(), accountId,
                        DataType.INQUIRY.name());
                if (inquiryBaseline == null) {
                    continue;
                }
                Instant inquirySince = inquiryBaseline.isAfter(reach) ? inquiryBaseline : reach;
                for (Inquiry inquiry : cases.inquiryCandidates(orgId, accountId, inquirySince,
                        PageRequest.of(0, CANDIDATE_SCAN))) {
                    if (stop.getAsBoolean()) {
                        return;
                    }
                    handleInquiry(run, responsibility, inquiry, k);
                }
                continue;
            }
            UUID channelId = channels.findByCode(recipe.channelCode().orElseThrow()).map(Channel::getId).orElse(null);
            if (channelId == null || !reviewChannels.add(channelId)) {
                continue;
            }
            Instant baseline = cases.firstSettledObservation(orgId, responsibility.getId(),
                    target.get().sellerAccountId(), DataType.REVIEW.name());
            if (baseline == null) {
                continue;
            }
            Instant since = baseline.isAfter(reach) ? baseline : reach;
            for (Review review : cases.reviewCandidates(orgId, channelId, since, PageRequest.of(0, CANDIDATE_SCAN))) {
                if (stop.getAsBoolean()) {
                    return;
                }
                handleReview(run, responsibility, review, k);
            }
        }
    }

    private void handleInquiry(ResponsibilityRun run, Responsibility responsibility, Inquiry inquiry, Counters k) {
        UUID workItemId = workItems.findByInquiryId(inquiry.getId())
                .filter(w -> run.getOrgId().equals(w.getOrgId()))
                .map(InquiryWorkItem::getId).orElse(null);
        handle(run, responsibility, OperationsSubjectKind.INQUIRY, inquiry.getId(),
                OperationsSignal.inquiryState(inquiry),
                OperationsCaseRules.forInquiry(inquiry.getStatus(), inquiry.getOperationalState(),
                        inquiry.getThreadRole()),
                inquiry.getChannelId(), inquiry.getProductId(), workItemId, k);
    }

    private void handleReview(ResponsibilityRun run, Responsibility responsibility, Review review, Counters k) {
        handle(run, responsibility, OperationsSubjectKind.REVIEW, review.getId(), OperationsSignal.reviewState(review),
                OperationsCaseRules.forReview(review.getRating(), review.getBody(), review.getReplyState()),
                review.getChannelId(), review.getProductId(), null, k);
    }

    private void handle(ResponsibilityRun run, Responsibility responsibility, OperationsSubjectKind kind,
                        UUID subjectId, String rawState, OperationsCaseRules.Conclusion conclusion, UUID channelId,
                        UUID productId, UUID workItemId, Counters k) {
        UUID orgId = run.getOrgId();
        String state = OperationsSignal.truncate(rawState);
        String signature = OperationsSignal.signature(orgId, kind, subjectId, state, null);
        if (cases.findByOrgIdAndSubjectKindAndSubjectIdAndSignature(orgId, kind, subjectId, signature).isPresent()) {
            k.unchanged++;
            return;
        }
        boolean investigate = conclusion.needsInvestigation() && investigation.isEnabledFor(orgId);
        if (investigate && k.investigationsStarted >= investigation.maxPerRun()) {
            k.deferred++;
            return;
        }
        Optional<OperationsCase> open = cases.findByOrgIdAndSubjectKindAndSubjectIdAndStatus(orgId, kind, subjectId,
                OperationsCaseStatus.PREPARED);
        boolean changed = open.isPresent();
        OperationsCase c = changed ? open.get()
                : newCase(run, OperationsCaseKind.CUSTOMER_WORK, kind, subjectId, state, signature);
        c.setSignature(signature);
        c.setSourceState(state);
        c.setLastRunId(run.getId());
        c.setChannelId(channelId);
        c.setProductId(productId);
        c.setWorkItemId(workItemId);
        c.setReason(conclusion.reason());
        c.setReasonNote(conclusion.reason().noteKo());
        c.setPriority(conclusion.priority());
        c.setSummary(null);
        c.setRecommendedActionType(null);
        c.setRecommendedAction(null);
        c.setMissingInformation(null);
        c.setConfidence(null);
        c.setDecidedBy(CaseDecider.RULE);
        if (conclusion.needsInvestigation()) {
            // Written first as the seller's decision, so a crash or a failed investigation leaves the case where a
            // person will see it, never silently resolved.
            c.setDisposition(CaseDisposition.NEEDS_DECISION);
            c.setRequiredAuthority(RequiredAuthority.HUMAN);
        } else {
            c.setDisposition(conclusion.disposition());
            c.setRequiredAuthority(conclusion.authority());
            if (conclusion.disposition() == CaseDisposition.AUTO_RESOLVED) {
                markClosed(c, conclusion.resolution());
            }
        }
        OperationsCase saved;
        try {
            saved = cases.saveAndFlush(c);
        } catch (DataIntegrityViolationException race) {
            // Another writer holds this subject's open card (a race, or a proactive card opened before delegation).
            k.blocked++;
            return;
        }
        event(saved, run.getId(), CaseEventActor.SYSTEM, changed ? CaseEventKind.CONTEXT_UPDATED : CaseEventKind.OPENED,
                Map.of("decidedBy", "RULE", "reason", conclusion.reason().name(),
                        "disposition", String.valueOf(saved.getDisposition())));
        if (changed) {
            k.updated++;
        } else {
            k.opened++;
        }
        if (!conclusion.needsInvestigation()) {
            k.ruleDecided++;
            return;
        }
        if (!investigate) {
            event(saved, run.getId(), CaseEventActor.SYSTEM, CaseEventKind.INVESTIGATION_SKIPPED,
                    Map.of("outcome", "CAPABILITY_OFF"));
            k.skipped++;
            return;
        }
        k.investigationsStarted++;
        CaseInvestigator.Outcome outcome = investigator.investigate(saved, run.getId());
        switch (outcome.kind()) {
            case SKIPPED -> {
                events.save(OperationsCaseEvent.of(saved, run.getId(), CaseEventActor.SYSTEM,
                        CaseEventKind.INVESTIGATION_SKIPPED, outcome.provenance()));
                k.skipped++;
            }
            case FAILED -> {
                events.save(OperationsCaseEvent.of(saved, run.getId(), CaseEventActor.AGENT,
                        CaseEventKind.INVESTIGATION_FAILED, outcome.provenance()));
                k.failed++;
            }
            case CONCLUDED -> {
                OperationsCase concluded = applyInvestigation(saved, outcome);
                events.save(OperationsCaseEvent.of(concluded, run.getId(), CaseEventActor.AGENT,
                        CaseEventKind.INVESTIGATED, outcome.provenance()));
                k.investigated++;
                prepareDraftIfAsked(run, concluded, outcome.output(), k);
            }
        }
    }

    private OperationsCase applyInvestigation(OperationsCase c, CaseInvestigator.Outcome outcome) {
        CaseInvestigationOutput output = outcome.output();
        c.setDecidedBy(CaseDecider.AGENT);
        c.setDisposition(outcome.applied().disposition());
        c.setRequiredAuthority(outcome.applied().authority());
        c.setSummary(outcome.applied().summary());
        c.setRecommendedActionType(output.recommendedActionType());
        c.setRecommendedAction(outcome.applied().recommendedAction());
        c.setMissingInformation(json(output.missingInformation()));
        c.setConfidence(output.confidence());
        c.setEvidenceCount(output.evidenceRefs().size());
        c.setPreparedAction(CasePreparedAction.RECOMMENDATION_ONLY);
        if (outcome.applied().disposition() == CaseDisposition.AUTO_RESOLVED) {
            markClosed(c, CaseResolution.AGENT_NO_ACTION);
        }
        return cases.saveAndFlush(c);
    }

    private void prepareDraftIfAsked(ResponsibilityRun run, OperationsCase c, CaseInvestigationOutput output,
                                     Counters k) {
        if (c.getSubjectKind() != OperationsSubjectKind.INQUIRY || c.getWorkItemId() == null
                || c.getDisposition() != CaseDisposition.NEEDS_DECISION
                || output.recommendedActionType() != RecommendedActionType.REPLY_TO_CUSTOMER) {
            return;
        }
        CaseDraftPreparer.Prepared prepared = drafts.prepare(c.getOrgId(), c.getWorkItemId());
        Map<String, Object> provenance = new LinkedHashMap<>();
        provenance.put("path", "InquiryDraftComposer");
        provenance.put("knowledgeState", prepared.knowledgeState());
        provenance.put("evidenceCount", prepared.evidenceCount());
        if (prepared.written()) {
            c.setPreparedAction(CasePreparedAction.DRAFT_PREPARED);
            c.setDraftVersion(prepared.version());
            c.setEvidenceState(prepared.knowledgeState());
            OperationsCase saved = cases.saveAndFlush(c);
            provenance.put("draftVersion", prepared.version());
            event(saved, run.getId(), CaseEventActor.SYSTEM, CaseEventKind.DRAFT_PREPARED, provenance);
            k.drafts++;
        } else {
            c.setEvidenceState(prepared.knowledgeState());
            OperationsCase saved = cases.saveAndFlush(c);
            provenance.put("reason", prepared.reason());
            event(saved, run.getId(), CaseEventActor.SYSTEM, CaseEventKind.DRAFT_NOT_PREPARED, provenance);
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

    private OperationsCase newCase(ResponsibilityRun run, OperationsCaseKind caseKind, OperationsSubjectKind kind,
                                   UUID subjectId, String state, String signature) {
        OperationsCase c = new OperationsCase();
        c.setOrgId(run.getOrgId());
        c.setResponsibilityId(run.getResponsibilityId());
        c.setOriginRunId(run.getId());
        c.setLastRunId(run.getId());
        c.setCaseKind(caseKind);
        c.setSubjectKind(kind);
        c.setSubjectId(subjectId);
        c.setSignature(signature);
        c.setSourceState(state);
        c.setStatus(OperationsCaseStatus.PREPARED);
        c.setPriority(CasePriority.NORMAL);
        c.setPreparedAction(CasePreparedAction.NONE);
        c.setRequiredAuthority(RequiredAuthority.HUMAN);
        return c;
    }

    private void markClosed(OperationsCase c, CaseResolution resolution) {
        c.setStatus(OperationsCaseStatus.CLOSED);
        c.setResolutionReason(resolution);
        c.setClosedAt(clock.instant());
    }

    private void close(OperationsCase c, UUID runId, CaseResolution resolution, CaseEventKind kind,
                       Map<String, Object> provenance) {
        markClosed(c, resolution);
        OperationsCase saved = cases.saveAndFlush(c);
        event(saved, runId, CaseEventActor.SYSTEM, kind, provenance);
    }

    private void event(OperationsCase c, UUID runId, CaseEventActor actor, CaseEventKind kind,
                       Map<String, Object> provenance) {
        events.save(OperationsCaseEvent.of(c, runId, actor, kind, json(provenance)));
    }

    private static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            return null;
        }
    }
}
