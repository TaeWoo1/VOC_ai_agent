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
import com.sellerops.proactive.ProactiveCaseRepository;
import com.sellerops.proactive.ProactiveCaseStatus;
import com.sellerops.proactive.ProactiveCloseReason;
import com.sellerops.proactive.ProactiveSubjectKind;
import com.sellerops.responsibility.Responsibility;
import com.sellerops.responsibility.ResponsibilityRepository;
import com.sellerops.responsibility.ResponsibilityRollout;
import com.sellerops.responsibility.ResponsibilityRun;
import com.sellerops.responsibility.ResponsibilityRunCoordinator;
import com.sellerops.responsibility.ResponsibilityRunRepository;
import com.sellerops.responsibility.ResponsibilityRunSource;
import com.sellerops.responsibility.ResponsibilityRunSourceRepository;
import com.sellerops.responsibility.ResponsibilitySources;
import com.sellerops.responsibility.ResponsibilityTemplate;
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
     * How far back a row can still change. The routine read of every source this responsibility observes reaches
     * 14 days — Cafe24's board window and NAVER's {@code ROUTINE_MAX_LAG} are both that — so a row older than that
     * is not re-read, cannot change under this responsibility, and re-checking it every run is a scan for nothing.
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

    private CaseResolutionReader resolutions;

    private com.sellerops.proactive.ProactiveReviewInvestigator reviewInvestigator;

    private ProactiveCaseRepository legacyCases;

    /**
     * The legacy proactive lane's own cases — <b>and only those.</b>
     *
     * <p>Same table as {@link OperationsCaseRepository}; what separates them is the entity's
     * {@code @SQLRestriction("responsibility_id is null")}, so this repository is structurally unable to see, let
     * alone touch, an operations case. That is what makes it safe to hold here: the takeover can close a legacy
     * card and cannot reach anything else.
     *
     * <p>Optional like the collaborators below, and for the same reason — wiring that predates it behaves exactly
     * as it did, which for a starving subject means it keeps starving until this bean is present.
     */
    @Autowired(required = false)
    public void setLegacyCases(ProactiveCaseRepository legacyCases) {
        this.legacyCases = legacyCases;
    }

    /**
     * What is already known about a 확인 필요 review, <b>before any model runs</b>.
     *
     * <p>This is not a second review brain. It is the one the proactive lane has used since it shipped: it reads the
     * issue memory ({@code review_issue} / {@code review_issue_evidence}) that the extraction after every ingest
     * already wrote, and says whether this product has heard this complaint before and what the seller can do next.
     * Nothing is inferred from this one review's text — 「이건 반복 문제 같다」 would be an invention; counting the
     * evidence rows another pipeline recorded is an observation.
     *
     * <p><b>Reused rather than reimplemented on purpose.</b> A review case that reached its own conclusion about
     * repetition would give the seller two answers to 「같은 문제가 몇 번 있었나」, and the two would drift.
     *
     * <p>Optional like the reader below: absent, a review case is prepared exactly as it was before.
     */
    @Autowired(required = false)
    public void setReviewInvestigator(com.sellerops.proactive.ProactiveReviewInvestigator reviewInvestigator) {
        this.reviewInvestigator = reviewInvestigator;
    }

    /**
     * The Customer Goal resolution, when something can read this message into goals.
     *
     * <p>Optional by construction, not by configuration: {@code CustomerGoalInterpretation} has no production
     * implementation, so the reader answers null and every case is decided exactly as it was before. When one
     * arrives, what the customer asked for — and what this seller's own objects say about it — decides the case
     * instead of a blank 「판매자 확인 필요」.
     */
    @Autowired(required = false)
    public void setResolutions(CaseResolutionReader resolutions) {
        this.resolutions = resolutions;
    }

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
        /** Legacy proactive cards closed because this responsibility took their subject over. */
        int handedOff;
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
                        + "조사실패={} 조사생략={} 다음run으로={} 초안={} 장애열림={} 장애반복={} 장애복구={} 인계받음={}",
                runId, report.reconciledActed(), report.reconciledClosed(), report.unchanged(), report.opened(),
                report.updated(), report.ruleDecided(), report.investigated(), report.investigationFailed(),
                report.investigationSkipped(), report.deferred(), report.draftsPrepared(), report.gapsOpened(),
                report.gapsRepeated(), report.gapsRecovered(), k.handedOff);
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
                inquiry.getChannelId(), inquiry.getProductId(), workItemId, null, k);
    }

    private void handleReview(ResponsibilityRun run, Responsibility responsibility, Review review, Counters k) {
        handle(run, responsibility, OperationsSubjectKind.REVIEW, review.getId(), OperationsSignal.reviewState(review),
                OperationsCaseRules.forReview(review.getRating(), review.getBody(), review.getReplyState()),
                review.getChannelId(), review.getProductId(), null, review, k);
    }

    private void handle(ResponsibilityRun run, Responsibility responsibility, OperationsSubjectKind kind,
                        UUID subjectId, String rawState, OperationsCaseRules.Conclusion conclusion, UUID channelId,
                        UUID productId, UUID workItemId, Review review, Counters k) {
        UUID orgId = run.getOrgId();
        String state = OperationsSignal.truncate(rawState);
        String signature = OperationsSignal.signature(orgId, kind, subjectId, state, null);
        if (cases.findByOrgIdAndSubjectKindAndSubjectIdAndSignature(orgId, kind, subjectId, signature).isPresent()) {
            k.unchanged++;
            // Nothing to write — but this responsibility has already decided this subject, so a legacy card still
            // pointing at it is a second answer about work that is not the legacy lane's any more. Yielded here too
            // because a subject whose source state never changes again would otherwise never reach the line below.
            takeOverLegacyCase(orgId, responsibility, kind, subjectId, k);
            return;
        }
        boolean investigate = conclusion.needsInvestigation() && investigation.isEnabledFor(orgId);
        if (investigate && k.investigationsStarted >= investigation.maxPerRun()) {
            // Deliberately NOT a handover point. This subject is coming back next run; closing the legacy card now
            // would take the seller's only annotation away and put nothing in its place.
            k.deferred++;
            return;
        }
        takeOverLegacyCase(orgId, responsibility, kind, subjectId, k);
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
        prepareReviewRecommendation(c, kind, conclusion, review, orgId);
        // What the customer actually asked for, resolved against THIS inquiry's order and listing. Null unless
        // something read the message into goals, which nothing does today — see CaseResolutionReader.
        CaseResolutionReader.Reading reading =
                kind != OperationsSubjectKind.INQUIRY || resolutions == null
                        ? null : resolutions.read(orgId, subjectId);
        com.sellerops.inquiry.resolve.InquiryResolutionView walk = reading == null ? null : reading.view();
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
        CaseFromResolution resolved = recordResolution(c, reading);
        OperationsCase saved;
        try {
            saved = cases.saveAndFlush(c);
        } catch (DataIntegrityViolationException race) {
            // Another writer holds this subject's open card. That used to include a legacy proactive card opened
            // before this organisation was delegated — which no loop could ever close, so the subject starved here
            // permanently; takeOverLegacyCase now stands those down before this insert. What is left is a genuine
            // race, which is what this catch was written for. A fence that stopped being reachable is not one to
            // remove: the constraint it guards is still there, and so is concurrency.
            k.blocked++;
            return;
        }
        Map<String, Object> opened = new LinkedHashMap<>();
        opened.put("decidedBy", "RULE");
        opened.put("reason", conclusion.reason().name());
        opened.put("disposition", String.valueOf(saved.getDisposition()));
        if (resolved != null) {
            // The whole walk, on the case's own history: which goals the message carried, what each one settled as,
            // and which capability answered it. The passages stay where the gather wrote them.
            opened.put("resolution", walk);
        }
        event(saved, run.getId(), CaseEventActor.SYSTEM, changed ? CaseEventKind.CONTEXT_UPDATED : CaseEventKind.OPENED,
                opened);
        if (changed) {
            k.updated++;
        } else {
            k.opened++;
        }
        if (!conclusion.needsInvestigation()) {
            k.ruleDecided++;
            prepareResolvedReply(run, saved, resolved, k);
            return;
        }
        if (resolved != null && !resolved.createsCustomerWork()) {
            // The message asked for nothing a resolver can act on. Keeping the observation is the answer, and
            // spending a model call to re-read a question that is not there is not. No draft either, for the
            // same reason: this reading is MONITORING, and only NEEDS_DECISION can recommend a reply.
            event(saved, run.getId(), CaseEventActor.SYSTEM, CaseEventKind.INVESTIGATION_SKIPPED,
                    Map.of("outcome", "NO_CUSTOMER_GOAL"));
            k.ruleDecided++;
            return;
        }
        if (!investigate) {
            event(saved, run.getId(), CaseEventActor.SYSTEM, CaseEventKind.INVESTIGATION_SKIPPED,
                    Map.of("outcome", "CAPABILITY_OFF"));
            k.skipped++;
            prepareResolvedReply(run, saved, resolved, k);
            return;
        }
        k.investigationsStarted++;
        CaseInvestigator.Outcome outcome = investigator.investigate(saved, run.getId());
        OperationsCase concluded = recordInvestigation(saved, run.getId(), outcome);
        switch (outcome.kind()) {
            case SKIPPED -> k.skipped++;
            case FAILED -> k.failed++;
            case CONCLUDED -> {
                k.investigated++;
                prepareDraftIfAsked(run, concluded, outcome.output(), k);
            }
        }
    }

    /**
     * <b>Write one resolution onto its case.</b> Shared with the Teach loop, which re-resolves after the seller
     * supplies the missing knowledge — so a re-resolution means exactly what a first one does.
     *
     * <p>The resolution is deterministic and it read this seller's own objects, so it speaks after the rule and
     * before any model. It never closes a case: {@link CaseFromResolution} cannot produce {@code AUTO_RESOLVED}.
     *
     * <p>The knowledge gap is written <b>only while the resolution is still asking for knowledge</b>. A question the
     * seller has since answered no longer has a gap, and a stale one left standing would go on asking for something
     * already supplied — which is the one thing a seller reads as «my work did not happen».
     *
     * @param reading the walk and the gap behind it, or null when nothing read the message
     * @return what the walk concluded, or null when there was none — the case is then left where the rules put it
     */
    public CaseFromResolution recordResolution(OperationsCase c, CaseResolutionReader.Reading reading) {
        CaseFromResolution resolved = CaseFromResolution.of(reading == null ? null : reading.view());
        if (resolved == null) {
            return null;
        }
        c.setDisposition(resolved.disposition());
        c.setRequiredAuthority(resolved.authority());
        c.setRecommendedActionType(resolved.recommendedAction());
        c.setSummary(resolved.summaryKo());
        c.setMissingInformation(resolved.missingInformation().isEmpty() ? null
                : json(resolved.missingInformation()));
        if (resolved.recommendedAction() == RecommendedActionType.ADD_KNOWLEDGE) {
            c.setKnowledgeGap(reading.gap() == null ? null : json(reading.gap()));
        } else {
            c.setKnowledgeGap(null);
        }
        return resolved;
    }

    /**
     * Write one investigation outcome onto its case and history. Shared with the Teach loop, which re-investigates a
     * case after the seller supplies missing knowledge — so a re-investigation means exactly what a first one does.
     */
    public OperationsCase recordInvestigation(OperationsCase c, UUID runId, CaseInvestigator.Outcome outcome) {
        switch (outcome.kind()) {
            case SKIPPED -> {
                events.save(OperationsCaseEvent.of(c, runId, CaseEventActor.SYSTEM,
                        CaseEventKind.INVESTIGATION_SKIPPED, outcome.provenance()));
                return c;
            }
            case FAILED -> {
                events.save(OperationsCaseEvent.of(c, runId, CaseEventActor.AGENT,
                        CaseEventKind.INVESTIGATION_FAILED, outcome.provenance()));
                return c;
            }
            default -> {
                OperationsCase concluded = applyInvestigation(c, outcome);
                events.save(OperationsCaseEvent.of(concluded, runId, CaseEventActor.AGENT,
                        CaseEventKind.INVESTIGATED, outcome.provenance()));
                return concluded;
            }
        }
    }

    private OperationsCase applyInvestigation(OperationsCase c, CaseInvestigator.Outcome outcome) {
        CaseInvestigationOutput output = outcome.output();
        c.setDecidedBy(CaseDecider.AGENT);
        // The rule's sentence said what the rule concluded; the agent's conclusion replaces it, the fact stays.
        c.setReasonNote(c.getReason() == null ? c.getReasonNote() : c.getReason().factKo());
        c.setDisposition(outcome.applied().disposition());
        c.setRequiredAuthority(outcome.applied().authority());
        c.setSummary(outcome.applied().summary());
        c.setRecommendedActionType(output.recommendedActionType());
        c.setRecommendedAction(outcome.applied().recommendedAction());
        c.setMissingInformation(json(output.missingInformation()));
        c.setConfidence(output.confidence());
        c.setEvidenceCount(output.evidenceRefs().size());
        c.setPreparedAction(CasePreparedAction.RECOMMENDATION_ONLY);
        c.setKnowledgeUsed(json(outcome.usedKnowledge()));
        c.setKnowledgeGap(outcome.knowledge() == null || !outcome.knowledge().missing() ? null
                : json(CaseKnowledgeGap.fromInvestigation(outcome.knowledge())));
        if (outcome.applied().disposition() == CaseDisposition.AUTO_RESOLVED) {
            markClosed(c, CaseResolution.AGENT_NO_ACTION);
        }
        return cases.saveAndFlush(c);
    }

    /**
     * <b>What a 확인 필요 review already knows, before any model runs.</b>
     *
     * <p>Until this, a review reached 「내 결정 필요」 with {@code recommendedAction} null and stood in the queue
     * beside an inquiry that said 「제안: 답변 확인 후 발송 · 초안 있음」, carrying nothing but the line that says it is
     * a low-rated review. That was not a missing capability — the investigation is default-OFF and INQUIRY-shaped,
     * but the <em>deterministic</em> review preparation has existed and shipped in the proactive lane all along.
     * So the case reuses it rather than reaching its own conclusion: see {@link #setReviewInvestigator}.
     *
     * <p><b>Costs no model call and no marketplace call</b> — it counts rows in the issue memory. That is the whole
     * reason it may run for every review that needs a decision: there is no per-review spend to ration, so no review
     * has to be chosen over another, and nothing is bought for a review the rules already closed or put under watch.
     *
     * <p>Three fields, each earned by a fact this lane holds:
     * <ul>
     *   <li>{@code recommendedAction} — the investigator's own sentence, carried whole. It already leads with the
     *       repetition it found ({@code 「…」 문제가 N건 확인됐습니다}), so the evidence and the suggestion are one
     *       statement rather than two that could disagree.</li>
     *   <li>{@code evidenceCount} — 1 when the issue memory answered, 0 when it had nothing. A product with no issue
     *       memory yields no repeat claim rather than a hedged one.</li>
     *   <li>{@code preparedAction} — {@code RECOMMENDATION_ONLY}, which is the ceiling for a review and the honest
     *       name for what now exists: something to read, and nothing to send.</li>
     * </ul>
     *
     * <p><b>{@code recommendedActionType} is deliberately left null.</b> The investigator names a next step in the
     * seller's language; it does not choose from this repository's eight-value action vocabulary, and picking one
     * here would be this method inventing the judgement the brief said to reuse. A later investigation may fill it —
     * {@code applyInvestigation} overwrites all of this, as it should: a model that actually read the review outranks
     * a row count.
     *
     * <p>{@code summary} is left alone for the same reason. It is where the investigation puts what it concluded,
     * and duplicating the recommendation's first clause into it would show the seller one fact twice.
     */
    private void prepareReviewRecommendation(OperationsCase c, OperationsSubjectKind kind,
                                             OperationsCaseRules.Conclusion conclusion, Review review, UUID orgId) {
        if (kind != OperationsSubjectKind.REVIEW || review == null || reviewInvestigator == null
                || !conclusion.needsInvestigation()) {
            return;
        }
        com.sellerops.proactive.ProactiveReviewInvestigator.Investigation found =
                reviewInvestigator.investigate(orgId, review);
        c.setRecommendedAction(found.recommendation());
        c.setEvidenceCount(found.repeatIssue() == null ? 0 : 1);
        c.setPreparedAction(CasePreparedAction.RECOMMENDATION_ONLY);
    }

    /**
     * <b>Take a subject over from the legacy proactive lane — one open card per subject, and this one is ours.</b>
     *
     * <p>Both producers write {@code proactive_case} and {@code uq_proactive_case_open_subject} spans both of them:
     * one {@code PREPARED} row per {@code (org, subject_kind, subject_id)}, whichever lane wrote it. The two are
     * blind to each other by construction — {@code @SQLRestriction} shows each only its own rows, and the signature
     * namespaces are disjoint (the operations lane prefixes {@code rr:}) — so each looks for a stale open card,
     * finds nothing, and they meet at the database instead.
     *
     * <p>That collision used to be swallowed as {@code blocked} and the operations case was simply never written.
     * It could not resolve itself: {@code ProactiveScheduler} drops a delegated organisation from its tick
     * entirely, so no loop could ever close the squatter. <b>A single stale legacy card starved its subject
     * forever</b>, and the subject that lost was always the one a responsibility had been made responsible for.
     *
     * <p>So ownership is stated rather than raced for. Where a {@code CUSTOMER_OPERATIONS_V1} responsibility is
     * the one deciding this subject, its case is canonical and the legacy annotation stands down.
     *
     * <ul>
     *   <li><b>Closed, never deleted.</b> The row keeps its reason, its investigation and its dates and gains
     *       {@link ProactiveCloseReason#DELEGATED_TO_RESPONSIBILITY} — the enum's own rule is that a card which
     *       vanished has to be able to say why. Nothing is rewritten and no history is dropped.</li>
     *   <li><b>Per subject, not per organisation.</b> Only a subject this lane is deciding right now changes
     *       hands. Legacy cards for subjects outside this responsibility's reach keep standing, because closing
     *       them would take a card away and put nothing in its place — the brief is that the operations case is
     *       canonical for the subjects it manages, not that the legacy lane is over.</li>
     *   <li><b>That is also what keeps one subject in one list.</b> After the handover the subject has exactly one
     *       live annotation; before it, exactly one. There is no moment where both lanes describe it.</li>
     *   <li><b>{@code saveAndFlush}</b>, because the insert below needs the index slot actually free, not merely
     *       free in the persistence context.</li>
     * </ul>
     *
     * <p>The catch around that insert stays where it is. It was written for a genuine race and that is now all it
     * can be — but a fence that has stopped being reachable is not one to remove.
     */
    private void takeOverLegacyCase(UUID orgId, Responsibility responsibility, OperationsSubjectKind kind,
                                    UUID subjectId, Counters k) {
        if (legacyCases == null || responsibility.getTemplateCode() != ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1) {
            return;
        }
        ProactiveSubjectKind legacyKind = switch (kind) {
            case INQUIRY -> ProactiveSubjectKind.INQUIRY;
            case REVIEW -> ProactiveSubjectKind.REVIEW;
            // The legacy lane has no SOURCE subject, so an observation gap can collide with nothing.
            case SOURCE -> null;
        };
        if (legacyKind == null) {
            return;
        }
        legacyCases.findByOrgIdAndSubjectKindAndSubjectIdAndStatus(orgId, legacyKind, subjectId,
                ProactiveCaseStatus.PREPARED).ifPresent(stale -> {
                    stale.setStatus(ProactiveCaseStatus.CLOSED);
                    stale.setClosedAt(clock.instant());
                    stale.setCloseReason(ProactiveCloseReason.DELEGATED_TO_RESPONSIBILITY);
                    legacyCases.saveAndFlush(stale);
                    k.handedOff++;
                });
    }

    private void prepareDraftIfAsked(ResponsibilityRun run, OperationsCase c, CaseInvestigationOutput output,
                                     Counters k) {
        if (c.getSubjectKind() != OperationsSubjectKind.INQUIRY || c.getWorkItemId() == null
                || c.getDisposition() != CaseDisposition.NEEDS_DECISION
                || output.recommendedActionType() != RecommendedActionType.REPLY_TO_CUSTOMER) {
            return;
        }
        if (recordPrepared(c, run.getId(), drafts.prepare(c.getOrgId(), c.getWorkItemId()))) {
            k.drafts++;
        }
    }

    /**
     * <b>The deterministic resolution settled this as 「답변」, so the reply is drafted — investigation or not.</b>
     *
     * <p>Until this existed the only road to a prepared draft ran through a <b>concluded investigation</b>
     * ({@link #prepareDraftIfAsked}), and that capability is off by default. So a case the rules and the resolvers
     * had fully settled — the company's own knowledge answers this question — reached the seller with the summary
     * 「등록된 지식으로 답변할 수 있는 문의입니다」 and an empty draft area. The one path that did prepare it was the
     * Teach loop, which meant a seller got a draft only for the questions their library could <b>not</b> answer.
     *
     * <p>It is the same seam, called with the same argument: {@link CaseDraftPreparer}, the production proposal
     * transition, {@link com.sellerops.inquiry.draft.InquiryDraftComposer}, and {@link #recordPrepared} deciding
     * what the outcome means for the case. No second draft path, and nothing new to keep in step.
     *
     * <h2>Why the capability is asked BEFORE the preparer</h2>
     *
     * <p>Because a deployment with drafting off must pay exactly what it paid before, and
     * {@link CaseDraftPreparer#prepare} is not free on the way to being declined: it proposes — a row, an audit and
     * an OPEN → PROPOSED transition — and then runs a full retrieval, only for the composer to report the switch is
     * off. Asking first keeps a switched-off deployment byte-identical to the one before this method existed.
     *
     * <p>{@code REPLY_TO_CUSTOMER} is the whole resolution test. It is reachable from exactly the two terminals
     * that mean the question is answerable — {@code RESOLVED} and {@code RESOLVED_CONDITIONAL}
     * ({@link CaseFromResolution}) — and only ever alongside {@code NEEDS_DECISION}, so no separate state check
     * says anything the action does not already say.
     */
    private void prepareResolvedReply(ResponsibilityRun run, OperationsCase c, CaseFromResolution resolved,
                                      Counters k) {
        if (resolved == null || c.getSubjectKind() != OperationsSubjectKind.INQUIRY || c.getWorkItemId() == null
                || c.getDisposition() != CaseDisposition.NEEDS_DECISION
                || c.getRecommendedActionType() != RecommendedActionType.REPLY_TO_CUSTOMER
                || !drafts.enabledFor(c.getOrgId())) {
            return;
        }
        if (recordPrepared(c, run.getId(), drafts.prepare(c.getOrgId(), c.getWorkItemId()))) {
            k.drafts++;
        }
    }

    /**
     * Write what the production draft path produced onto the case: the draft version or the knowledge gap, and the
     * event. Shared with the Teach loop ({@code CaseTeachService}), which re-runs the same path after the seller
     * supplies the missing knowledge — one place decides what a prepared or refused draft means for a case.
     *
     * @return whether a draft was written
     */
    public boolean recordPrepared(OperationsCase c, UUID runId, CaseDraftPreparer.Prepared prepared) {
        Map<String, Object> provenance = new LinkedHashMap<>();
        provenance.put("path", "InquiryDraftComposer");
        provenance.put("knowledgeState", prepared.knowledgeState());
        provenance.put("answerBasis", prepared.answerBasis());
        provenance.put("evidenceCount", prepared.evidenceCount());
        if (prepared.written()) {
            c.setKnowledgeGap(null);
            c.setPreparedAction(CasePreparedAction.DRAFT_PREPARED);
            c.setDraftVersion(prepared.version());
            c.setEvidenceState(prepared.knowledgeState());
            OperationsCase saved = cases.saveAndFlush(c);
            provenance.put("draftVersion", prepared.version());
            event(saved, runId, CaseEventActor.SYSTEM, CaseEventKind.DRAFT_PREPARED, provenance);
            return true;
        }
        c.setEvidenceState(prepared.knowledgeState());
        CaseKnowledgeGap gap = CaseKnowledgeGap.fromDraft(prepared);
        if (gap != null) {
            c.setKnowledgeGap(json(gap));
        }
        OperationsCase saved = cases.saveAndFlush(c);
        provenance.put("reason", prepared.reason());
        event(saved, runId, CaseEventActor.SYSTEM, CaseEventKind.DRAFT_NOT_PREPARED, provenance);
        return false;
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
