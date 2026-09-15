package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.InquiryOrderFactReader;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.mail.Mailer;
import com.sellerops.mail.OutboundMail;
import com.sellerops.operationscase.dto.CustomerOperationsHomeView;
import com.sellerops.operationscase.investigation.CaseDecisionGuard;
import com.sellerops.operationscase.investigation.CaseDraftPreparer;
import com.sellerops.operationscase.investigation.CaseInvestigationOutput;
import com.sellerops.operationscase.investigation.CaseInvestigationService;
import com.sellerops.operationscase.investigation.CaseInvestigationTools;
import com.sellerops.operationscase.investigation.CaseInvestigator;
import com.sellerops.proactive.ProactiveCase;
import com.sellerops.proactive.ProactiveCaseRepository;
import com.sellerops.proactive.ProactiveCaseStatus;
import com.sellerops.proactive.ProactivePreparedAction;
import com.sellerops.proactive.ProactivePriority;
import com.sellerops.proactive.ProactiveReason;
import com.sellerops.proactive.ProactiveSubjectKind;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.responsibility.IdentityVerdict;
import com.sellerops.responsibility.Responsibility;
import com.sellerops.responsibility.ResponsibilityRepository;
import com.sellerops.responsibility.ResponsibilityRollout;
import com.sellerops.responsibility.ResponsibilityRun;
import com.sellerops.responsibility.ResponsibilityRunRepository;
import com.sellerops.responsibility.ResponsibilityRunSource;
import com.sellerops.responsibility.ResponsibilityRunSourceRepository;
import com.sellerops.responsibility.ResponsibilitySources;
import com.sellerops.responsibility.ResponsibilityStatus;
import com.sellerops.responsibility.ResponsibilityTemplate;
import com.sellerops.responsibility.RunStatus;
import com.sellerops.responsibility.RunTrigger;
import com.sellerops.responsibility.SourceCompleteness;
import com.sellerops.responsibility.SourceFailureReason;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Package B case semantics over real repositories (H2): signals, rules, dedup, reconciliation, gaps, the exception
 * summary and the Home read. The investigator and the draft path are mocks — their own tests cover them — so what is
 * asserted here is WHEN the model is asked and what a conclusion does to a case, never what a model wrote.
 *
 * <p>Every organisation in this class is random, so its assertions are scoped to one organisation and share nothing.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@TestPropertySource(properties =
        "spring.datasource.url=jdbc:h2:mem:operations_case;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1")
class OperationsCaseProcessorTest {

    @Autowired ChannelRepository channels;
    @Autowired SellerAccountRepository accounts;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired ReviewRepository reviews;
    @Autowired ReviewTriageRepository triages;
    @Autowired ResponsibilityRepository responsibilities;
    @Autowired ResponsibilityRunRepository runs;
    @Autowired ResponsibilityRunSourceRepository sourceRows;
    @Autowired OperationsCaseRepository cases;
    @Autowired OperationsCaseEventRepository events;
    @Autowired ProactiveCaseRepository proactive;
    @Autowired UserRepository users;
    @Autowired ProductRepository products;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository issueEvidence;

    private final CaseInvestigator investigator = mock(CaseInvestigator.class);
    private final CaseInvestigationService investigation = mock(CaseInvestigationService.class);
    private final CaseDraftPreparer drafts = mock(CaseDraftPreparer.class);
    private final RecordingMailer mailer = new RecordingMailer();

    private UUID org;
    private SellerAccount account;
    private Responsibility responsibility;
    private Instant baseline;
    private int windows;
    private OperationsCaseProcessor processor;
    private OperationsCaseNotifier notifier;
    private OperationsCaseReconciler reconciler;

    @BeforeEach
    void setUp() {
        org = UUID.randomUUID();
        account = cafe24Account(org);
        User owner = new User();
        owner.setOrgId(org);
        owner.setEmail("owner-" + org + "@example.invalid");
        owner.setName("QA");
        owner.setRole("OWNER");
        owner = users.save(owner);
        responsibility = new Responsibility();
        responsibility.setOrgId(org);
        responsibility.setTemplateCode(ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1);
        responsibility.setTemplateVersion(1);
        responsibility.setStatus(ResponsibilityStatus.ACTIVE);
        responsibility.setNextRunAt(Instant.now().plus(Duration.ofHours(2)));
        responsibility.setActivatedBy(owner.getId());
        responsibility.setActivatedAt(Instant.now().minus(Duration.ofHours(3)));
        responsibility = responsibilities.save(responsibility);
        baseline = Instant.now().minus(Duration.ofHours(1));
        run(baseline, null, null); // the first complete read — everything before it was already there

        reconciler = new OperationsCaseReconciler(cases, events, inquiries, workItems, reviews, accounts,
                Clock.systemUTC());
        processor = processor(ResponsibilityRollout.of(List.of(org)));
        notifier = new OperationsCaseNotifier(runs, responsibilities, ResponsibilityRollout.of(List.of(org)), cases,
                events, channels, users, mailer, "https://app.example", Clock.systemUTC());
        when(investigation.isEnabledFor(org)).thenReturn(true);
        when(investigation.maxPerRun()).thenReturn(5);
        when(investigator.investigate(any(), any())).thenAnswer(call -> concluded(CaseDisposition.NEEDS_DECISION,
                RecommendedActionType.REPLY_TO_CUSTOMER, CaseConfidence.MEDIUM,
                call.getArgument(0) != null
                        && ((OperationsCase) call.getArgument(0)).getSubjectKind() == OperationsSubjectKind.INQUIRY));
        when(drafts.prepare(any(), any())).thenReturn(new CaseDraftPreparer.Prepared(true, 2, "GROUNDED", 1, null));
    }

    // ── signals ─────────────────────────────────────────────────────────────────────────────────────────────

    @Test
    void aNewInquiryIsInvestigatedOnce_aDraftIsPrepared_andAnUnchangedRerunWritesNothing() {
        Inquiry inquiry = inquiry("배송은 언제 되나요?", Instant.now());
        InquiryWorkItem item = workItem(inquiry);

        OperationsCaseProcessor.Report first = processor.process(run(Instant.now(), null, null), () -> false);

        assertThat(first.opened()).isEqualTo(1);
        assertThat(first.investigated()).isEqualTo(1);
        OperationsCase c = only();
        assertThat(c.getCaseKind()).isEqualTo(OperationsCaseKind.CUSTOMER_WORK);
        assertThat(c.getSubjectId()).isEqualTo(inquiry.getId());
        assertThat(c.getStatus()).isEqualTo(OperationsCaseStatus.PREPARED);
        assertThat(c.getDisposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(c.getDecidedBy()).isEqualTo(CaseDecider.AGENT);
        assertThat(c.getRequiredAuthority()).isEqualTo(RequiredAuthority.HUMAN);
        assertThat(c.getPreparedAction()).isEqualTo(CasePreparedAction.DRAFT_PREPARED);
        assertThat(c.getDraftVersion()).isEqualTo(2);
        verify(drafts, times(1)).prepare(org, item.getId());

        UUID second = run(Instant.now(), null, null);
        OperationsCaseProcessor.Report rerun = processor.process(second, () -> false);

        assertThat(rerun.unchanged()).isEqualTo(1);
        assertThat(rerun.opened() + rerun.updated() + rerun.investigated()).isZero();
        assertThat(casesOf()).hasSize(1);
        assertThat(events.findByOrgIdAndRunIdOrderByCreatedAtAsc(org, second)).isEmpty();
        verify(investigator, times(1)).investigate(any(), any());
    }

    @Test
    void whatWasAlreadyThereBeforeTheFirstCompleteReadIsNotACase() {
        inquiry("오래된 문의", baseline.minus(Duration.ofMinutes(10)));
        processor.process(run(Instant.now(), null, null), () -> false);
        assertThat(casesOf()).isEmpty();
        verify(investigator, never()).investigate(any(), any());
    }

    @Test
    void obviousReviewsAreSettledByTheRules_andOnlyTheOneThatNeedsJudgementReachesTheModel() {
        Review praise = review(5, "잘 받았습니다. 튼튼해요.");
        Review middling = review(3, "그냥 그래요.");
        Review complaint = review(1, "한 달 만에 떨어졌어요. 교환 원합니다.");

        OperationsCaseProcessor.Report report = processor.process(run(Instant.now(), null, null), () -> false);

        assertThat(report.ruleDecided()).isEqualTo(2);
        assertThat(report.investigated()).isEqualTo(1);
        verify(investigator, times(1)).investigate(any(), any());
        OperationsCase routine = caseFor(praise.getId());
        assertThat(routine.getDisposition()).isEqualTo(CaseDisposition.AUTO_RESOLVED);
        assertThat(routine.getStatus()).isEqualTo(OperationsCaseStatus.CLOSED);
        assertThat(routine.getResolutionReason()).isEqualTo(CaseResolution.RULE_NO_ACTION);
        assertThat(routine.getDecidedBy()).isEqualTo(CaseDecider.RULE);
        OperationsCase watched = caseFor(middling.getId());
        assertThat(watched.getDisposition()).isEqualTo(CaseDisposition.MONITORING);
        assertThat(watched.getStatus()).isEqualTo(OperationsCaseStatus.PREPARED);
        assertThat(watched.getRequiredAuthority()).isEqualTo(RequiredAuthority.AUTO);
        OperationsCase decision = caseFor(complaint.getId());
        assertThat(decision.getDisposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        verify(drafts, never()).prepare(any(), any());
    }

    @Test
    void aChangeUnderAnOpenCaseUpdatesThatCase_neverASecondOne() {
        Inquiry inquiry = inquiry("배송은 언제 되나요?", Instant.now());
        workItem(inquiry);
        processor.process(run(Instant.now(), null, null), () -> false);
        UUID caseId = only().getId();

        inquiry.setBody("배송은 언제 되나요? 급합니다. 내일까지 받아야 해요.");
        inquiry.setContentHash("changed-hash");
        inquiries.save(inquiry);
        UUID second = run(Instant.now(), null, null);
        OperationsCaseProcessor.Report report = processor.process(second, () -> false);

        assertThat(report.updated()).isEqualTo(1);
        assertThat(report.opened()).isZero();
        assertThat(casesOf()).hasSize(1);
        assertThat(only().getId()).isEqualTo(caseId);
        assertThat(only().getLastRunId()).isEqualTo(second);
        assertThat(events.findByOrgIdAndRunIdOrderByCreatedAtAsc(org, second))
                .extracting(OperationsCaseEvent::getKind).contains(CaseEventKind.CONTEXT_UPDATED);
        verify(investigator, times(2)).investigate(any(), any());
    }

    // ── model calls only where needed ───────────────────────────────────────────────────────────────────────

    @Test
    void withTheCapabilityOffTheCaseStaysWithTheSeller_andNoModelIsAsked() {
        when(investigation.isEnabledFor(org)).thenReturn(false);
        Inquiry inquiry = inquiry("환불 가능한가요?", Instant.now());
        workItem(inquiry);
        UUID runId = run(Instant.now(), null, null);
        processor.process(runId, () -> false);
        OperationsCase c = only();
        assertThat(c.getDisposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(c.getDecidedBy()).isEqualTo(CaseDecider.RULE);
        assertThat(events.findByOrgIdAndRunIdOrderByCreatedAtAsc(org, runId)).extracting(OperationsCaseEvent::getKind)
                .containsExactly(CaseEventKind.OPENED, CaseEventKind.INVESTIGATION_SKIPPED);
        verify(investigator, never()).investigate(any(), any());
    }

    @Test
    void investigationsBeyondTheRunCapWaitForTheNextRunWithNothingWritten() {
        when(investigation.maxPerRun()).thenReturn(1);
        workItem(inquiry("첫 번째 문의", Instant.now()));
        workItem(inquiry("두 번째 문의", Instant.now()));

        OperationsCaseProcessor.Report first = processor.process(run(Instant.now(), null, null), () -> false);
        assertThat(first.opened()).isEqualTo(1);
        assertThat(first.deferred()).isEqualTo(1);
        assertThat(casesOf()).hasSize(1);

        OperationsCaseProcessor.Report second = processor.process(run(Instant.now(), null, null), () -> false);
        assertThat(second.opened()).isEqualTo(1);
        assertThat(second.unchanged()).isEqualTo(1);
        assertThat(casesOf()).hasSize(2);
        verify(investigator, times(2)).investigate(any(), any());
    }

    @Test
    void aFailedInvestigationLeavesTheCaseWithTheSeller() {
        when(investigator.investigate(any(), any())).thenReturn(new CaseInvestigator.Outcome(
                CaseInvestigator.Kind.FAILED, null, null, "{\"outcome\":\"off_schema\"}", "off_schema"));
        workItem(inquiry("교환 가능한가요?", Instant.now()));
        UUID runId = run(Instant.now(), null, null);
        processor.process(runId, () -> false);
        assertThat(only().getDisposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(only().getDecidedBy()).isEqualTo(CaseDecider.RULE);
        assertThat(events.findByOrgIdAndRunIdOrderByCreatedAtAsc(org, runId)).extracting(OperationsCaseEvent::getKind)
                .contains(CaseEventKind.INVESTIGATION_FAILED);
        verify(drafts, never()).prepare(any(), any());
    }

    @Test
    void anAgentMayCloseAReviewThatNeedsNobody() {
        when(investigator.investigate(any(), any())).thenReturn(concluded(CaseDisposition.AUTO_RESOLVED,
                RecommendedActionType.NO_ACTION, CaseConfidence.HIGH, false));
        Review review = review(2, "배송이 좀 늦었지만 이미 잘 받았고 만족합니다.");
        processor.process(run(Instant.now(), null, null), () -> false);
        OperationsCase c = caseFor(review.getId());
        assertThat(c.getDisposition()).isEqualTo(CaseDisposition.AUTO_RESOLVED);
        assertThat(c.getStatus()).isEqualTo(OperationsCaseStatus.CLOSED);
        assertThat(c.getResolutionReason()).isEqualTo(CaseResolution.AGENT_NO_ACTION);
        assertThat(c.getRequiredAuthority()).isEqualTo(RequiredAuthority.AUTO);
    }

    // ── canonical truth wins ────────────────────────────────────────────────────────────────────────────────

    @Test
    void anInquiryAnsweredOnTheChannelClosesItsCase_withoutOpeningAnother() {
        Inquiry inquiry = inquiry("배송은 언제 되나요?", Instant.now());
        workItem(inquiry);
        processor.process(run(Instant.now(), null, null), () -> false);

        inquiry.setStatus("ANSWERED");
        inquiries.save(inquiry);
        OperationsCaseProcessor.Report report = processor.process(run(Instant.now(), null, null), () -> false);

        assertThat(report.reconciledClosed()).isEqualTo(1);
        assertThat(casesOf()).hasSize(1);
        assertThat(only().getStatus()).isEqualTo(OperationsCaseStatus.CLOSED);
        assertThat(only().getResolutionReason()).isEqualTo(CaseResolution.ANSWERED_ELSEWHERE);
    }

    @Test
    void theSellerActingOnTheWorkItemOrTheReviewIsReadBack_asActedWithoutInventingAnExecution() {
        Inquiry inquiry = inquiry("배송은 언제 되나요?", Instant.now());
        InquiryWorkItem item = workItem(inquiry);
        Review review = review(1, "파손되어 왔어요.");
        processor.process(run(Instant.now(), null, null), () -> false);

        item.setPhase(InquiryWorkItemPhase.APPROVED);
        workItems.save(item);
        ReviewTriage decision = new ReviewTriage();
        decision.setOrgId(org);
        decision.setReviewId(review.getId());
        decision.setChannelId(review.getChannelId());
        decision.setDisposition(TriageDisposition.RESPONSE_NEEDED);
        decision.setDecidedBy("seller");
        decision.setDecidedAt(Instant.now());
        triages.save(decision);
        processor.process(run(Instant.now(), null, null), () -> false);

        OperationsCase inquiryCase = caseFor(inquiry.getId());
        assertThat(inquiryCase.getStatus()).isEqualTo(OperationsCaseStatus.ACTED);
        assertThat(inquiryCase.getResolutionReason()).isEqualTo(CaseResolution.SELLER_ACTED);
        OperationsCase reviewCase = caseFor(review.getId());
        assertThat(reviewCase.getStatus()).isEqualTo(OperationsCaseStatus.ACTED);
        assertThat(CaseResolution.values()).extracting(Enum::name)
                .as("a case can only say the seller acted; the execution lifecycle keeps its own words")
                .doesNotContain("EXECUTED", "SENT", "VERIFIED");
    }

    @Test
    void aWatchedReviewStopsBeingWatchedAfterItsWindow_andAStopClosesWhatIsOpen() {
        Review middling = review(3, "보통입니다.");
        processor.process(run(Instant.now(), null, null), () -> false);
        OperationsCaseReconciler later = new OperationsCaseReconciler(cases, events, inquiries, workItems, reviews,
                accounts, Clock.offset(Clock.systemUTC(), Duration.ofDays(15)));
        later.reconcile(org, responsibility.getId(), null);
        assertThat(caseFor(middling.getId()).getResolutionReason()).isEqualTo(CaseResolution.MONITORING_ENDED);

        workItem(inquiry("문의", Instant.now()));
        processor.process(run(Instant.now(), null, null), () -> false);
        assertThat(reconciler.closeAll(org, responsibility.getId())).isEqualTo(1);
        assertThat(casesOf()).allMatch(c -> !c.isOpen());
    }

    // ── observation gaps ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void aSourceTheSellerMustReconnectIsOneCase_acrossRepeats_closedByACompleteRead_andANewEpisodeIsANewCase() {
        OperationsCaseProcessor.Report first = processor.process(
                run(Instant.now(), SourceFailureReason.AUTH_REQUIRED, null), () -> false);
        assertThat(first.gapsOpened()).isEqualTo(1);
        OperationsCase gap = openGap();
        assertThat(gap.getSubjectId()).isEqualTo(account.getId());
        assertThat(gap.getReason()).isEqualTo(CaseReason.SOURCE_AUTH_REQUIRED);
        assertThat(gap.getDisposition()).isNull();
        assertThat(gap.getRequiredAuthority()).isEqualTo(RequiredAuthority.HUMAN);

        OperationsCaseProcessor.Report repeat = processor.process(
                run(Instant.now(), SourceFailureReason.AUTH_REQUIRED, SourceFailureReason.AUTH_REQUIRED), () -> false);
        assertThat(repeat.gapsOpened()).isZero();
        assertThat(repeat.gapsRepeated()).isEqualTo(1);
        assertThat(gaps()).hasSize(1);

        OperationsCaseProcessor.Report recovered = processor.process(run(Instant.now(), null, null), () -> false);
        assertThat(recovered.gapsRecovered()).isEqualTo(1);
        assertThat(gaps()).singleElement().satisfies(g -> {
            assertThat(g.getStatus()).isEqualTo(OperationsCaseStatus.CLOSED);
            assertThat(g.getResolutionReason()).isEqualTo(CaseResolution.OBSERVED_AGAIN);
        });

        processor.process(run(Instant.now(), SourceFailureReason.AUTH_REQUIRED, null), () -> false);
        assertThat(gaps()).hasSize(2);
        assertThat(gaps().stream().filter(OperationsCase::isOpen)).hasSize(1);
    }

    @Test
    void aTransientFailureIsNotTheSellersCase() {
        OperationsCaseProcessor.Report report = processor.process(
                run(Instant.now(), SourceFailureReason.TIMEOUT, null), () -> false);
        assertThat(report.gapsOpened()).isZero();
        assertThat(gaps()).isEmpty();
    }

    // ── the exception summary ───────────────────────────────────────────────────────────────────────────────

    @Test
    void oneSummaryPerRunEnd_eachCaseMailedOnce_withNoCustomerText() {
        workItem(inquiry("배송은 언제 되나요? 010-1111-2222", Instant.now()));
        UUID first = run(Instant.now(), null, null);
        processor.process(first, () -> false);

        assertThat(notifier.afterFinish(first)).isEqualTo(OperationsCaseNotifier.Outcome.SENT);
        assertThat(mailer.sent).hasSize(1);
        OutboundMail mail = mailer.sent.get(0);
        assertThat(mail.to()).isEqualTo("owner-" + org + "@example.invalid");
        assertThat(mail.text()).contains("확인할 일 1건")
                .doesNotContain("배송은 언제").doesNotContain("010-1111-2222")
                .doesNotContain("고객이 배송 일정").doesNotContain("배송 예정일을 확인");
        assertThat(only().getNotifiedAt()).isNotNull();
        assertThat(runs.findById(first).orElseThrow().getNotificationState()).isEqualTo("SENT");

        assertThat(notifier.afterFinish(first)).isEqualTo(OperationsCaseNotifier.Outcome.ALREADY_DECIDED);
        UUID second = run(Instant.now(), null, null);
        processor.process(second, () -> false);
        assertThat(notifier.afterFinish(second)).isEqualTo(OperationsCaseNotifier.Outcome.NONE_NEEDED);
        assertThat(mailer.sent).hasSize(1);
    }

    @Test
    void aRepeatedGapSendsNoSecondMail_andAnUndeliverableSummaryKeepsTheCasesForTheNextOne() {
        mailer.deliverable = false;
        UUID first = run(Instant.now(), SourceFailureReason.AUTH_REQUIRED, null);
        processor.process(first, () -> false);
        assertThat(notifier.afterFinish(first)).isEqualTo(OperationsCaseNotifier.Outcome.UNDELIVERABLE);
        assertThat(openGap().getNotifiedAt()).isNull();

        mailer.deliverable = true;
        UUID second = run(Instant.now(), SourceFailureReason.AUTH_REQUIRED, null);
        processor.process(second, () -> false);
        assertThat(notifier.afterFinish(second)).isEqualTo(OperationsCaseNotifier.Outcome.SENT);
        assertThat(mailer.sent).singleElement().satisfies(m -> assertThat(m.text())
                .contains("카페24는 연결이 만료되어 문의를 확인하지 못했습니다."));

        UUID third = run(Instant.now(), SourceFailureReason.AUTH_REQUIRED, null);
        processor.process(third, () -> false);
        assertThat(notifier.afterFinish(third)).isEqualTo(OperationsCaseNotifier.Outcome.NONE_NEEDED);
        assertThat(mailer.sent).hasSize(1);
    }

    // ── boundaries ──────────────────────────────────────────────────────────────────────────────────────────

    @Test
    void anOrganisationTheRolloutDoesNotNameGetsNoCase() {
        workItem(inquiry("배송은 언제 되나요?", Instant.now()));
        OperationsCaseProcessor gated = processor(ResponsibilityRollout.of(List.of()));
        OperationsCaseProcessor.Report report = gated.process(run(Instant.now(), null, null), () -> false);
        assertThat(report.opened()).isZero();
        assertThat(casesOf()).isEmpty();
        verify(investigator, never()).investigate(any(), any());
    }

    @Test
    void theTwoHalvesOfTheTableNeverSeeEachOther() {
        workItem(inquiry("배송은 언제 되나요?", Instant.now()));
        processor.process(run(Instant.now(), null, null), () -> false);
        UUID operationsCaseId = only().getId();
        assertThat(proactive.findById(operationsCaseId)).isEmpty();
        assertThat(proactive.countByOrgIdAndStatus(org, ProactiveCaseStatus.PREPARED)).isZero();

        ProactiveCase card = new ProactiveCase();
        card.setOrgId(org);
        card.setSubjectKind(ProactiveSubjectKind.REVIEW);
        card.setSubjectId(UUID.randomUUID());
        card.setSignature("p".repeat(64));
        card.setSourceState("rating=1");
        card.setStatus(ProactiveCaseStatus.PREPARED);
        card.setPriority(ProactivePriority.HIGH);
        card.setReason(ProactiveReason.NEGATIVE_REVIEW);
        card.setReasonNote("낮은 평점");
        card.setPreparedAction(ProactivePreparedAction.RECOMMENDATION_ONLY);
        ProactiveCase saved = proactive.save(card);
        assertThat(cases.findById(saved.getId())).isEmpty();
        assertThat(casesOf()).extracting(OperationsCase::getId).containsExactly(operationsCaseId);
    }

    @Test
    void theInvestigatorsToolsReadOnlyTheBoundOrganisation() {
        UUID other = UUID.randomUUID();
        cafe24Account(other);
        Inquiry theirs = new Inquiry();
        theirs.setOrgId(other);
        theirs.setChannelId(account.getChannelId());
        theirs.setBody("다른 판매자의 고객 문의");
        theirs.setStatus("UNANSWERED");
        theirs.setReceivedAt(Instant.now());
        theirs = inquiries.save(theirs);
        UUID product = UUID.randomUUID();
        OperationsCase theirCase = new OperationsCase();
        theirCase.setOrgId(other);
        theirCase.setResponsibilityId(UUID.randomUUID());
        theirCase.setOriginRunId(UUID.randomUUID());
        theirCase.setCaseKind(OperationsCaseKind.CUSTOMER_WORK);
        theirCase.setSubjectKind(OperationsSubjectKind.INQUIRY);
        theirCase.setSubjectId(theirs.getId());
        theirCase.setProductId(product);
        theirCase.setSignature("x".repeat(64));
        theirCase.setSourceState("rr:inquiry");
        theirCase.setStatus(OperationsCaseStatus.PREPARED);
        theirCase.setPriority(CasePriority.HIGH);
        theirCase.setReason(CaseReason.UNANSWERED_INQUIRY);
        theirCase.setReasonNote("x");
        theirCase.setPreparedAction(CasePreparedAction.NONE);
        theirCase.setRequiredAuthority(RequiredAuthority.HUMAN);
        cases.save(theirCase);
        Review theirReview = new Review();
        theirReview.setOrgId(other);
        theirReview.setChannelId(account.getChannelId());
        theirReview.setProductId(product);
        theirReview.setRating(1);
        theirReview.setBody("다른 판매자의 리뷰");
        theirReview.setReceivedAt(Instant.now());
        theirReview = reviews.save(theirReview);
        ReviewTriage theirDecision = new ReviewTriage();
        theirDecision.setOrgId(other);
        theirDecision.setReviewId(theirReview.getId());
        theirDecision.setChannelId(account.getChannelId());
        theirDecision.setDisposition(TriageDisposition.NO_ACTION);
        theirDecision.setDecidedBy("seller");
        theirDecision.setDecidedAt(Instant.now());
        triages.save(theirDecision);

        InquiryOrderFactReader orderFacts = mock(InquiryOrderFactReader.class);
        CaseInvestigationTools tools = new CaseInvestigationTools(inquiries, reviews, channels, products,
                mock(ProductKnowledgeLibraryService.class), mock(SellerOperationsKnowledgeService.class), orderFacts,
                issues, issueEvidence, cases);

        CaseInvestigationTools.OrgTools mine = tools.forOrg(org);
        assertThat(mine.getSubject(OperationsSubjectKind.INQUIRY, theirs.getId())).isEmpty();
        assertThat(mine.getSubject(OperationsSubjectKind.REVIEW, theirReview.getId())).isEmpty();
        assertThat(mine.getOrderContext(theirs.getId()).available()).isFalse();
        verify(orderFacts, never()).read(any(), any(), any());
        assertThat(mine.getRecentSimilarCases(OperationsSubjectKind.INQUIRY, product, UUID.randomUUID())).isEmpty();
        assertThat(mine.getPastSellerDecisions(product).reviewDispositions()).isEmpty();
        assertThat(mine.getRelatedIssues(theirReview.getId(), product)).isEmpty();

        CaseInvestigationTools.OrgTools theirsTools = tools.forOrg(other);
        assertThat(theirsTools.getSubject(OperationsSubjectKind.INQUIRY, theirs.getId())).isPresent();
        assertThat(theirsTools.getRecentSimilarCases(OperationsSubjectKind.INQUIRY, product, UUID.randomUUID()))
                .hasSize(1);
        assertThat(theirsTools.getPastSellerDecisions(product).reviewDispositions()).containsEntry("NO_ACTION", 1L);
        assertThat(mine.calls()).extracting(CaseInvestigationTools.ToolCall::name)
                .contains("getSubject", "getOrderContext", "getRecentSimilarCases", "getPastSellerDecisions",
                        "getRelatedIssues");
    }

    // ── the Home read ───────────────────────────────────────────────────────────────────────────────────────

    @Test
    void theHomeShowsWhatStillWaitsOnTheCanonicalRecord_andNeverRendersAnUnobservedSourceAsZero() {
        Inquiry inquiry = inquiry("배송은 언제 되나요?", Instant.now());
        workItem(inquiry);
        review(5, "좋아요");
        processor.process(run(Instant.now(), SourceFailureReason.TIMEOUT, null), () -> false);
        CustomerOperationsHomeService home = new CustomerOperationsHomeService(responsibilities, runs, sourceRows,
                new ResponsibilitySources(accounts, channels), ResponsibilityRollout.of(List.of(org)), cases,
                inquiries, workItems, reviews, channels);

        CustomerOperationsHomeView view = home.home(org);
        assertThat(view.available()).isTrue();
        assertThat(view.decisions().total()).isEqualTo(1);
        assertThat(view.decisions().rows().get(0).to()).isEqualTo("/inquiries/" + inquiry.getId());
        assertThat(view.decisions().rows().get(0).draftPrepared()).isTrue();
        assertThat(view.handled().autoResolved()).isEqualTo(1);
        assertThat(view.sources()).filteredOn(s -> "INQUIRY".equals(s.dataType())).singleElement().satisfies(s -> {
            assertThat(s.completeness()).isEqualTo("NONE");
            assertThat(s.observedCount()).isNull();
            assertThat(s.sellerActionRequired()).isFalse();
        });

        inquiry.setStatus("ANSWERED");
        inquiries.save(inquiry);
        assertThat(home.home(org).decisions().total()).as("answered at 10:05 is not 「내 결정 필요」 at 10:06").isZero();

        assertThat(new CustomerOperationsHomeService(responsibilities, runs, sourceRows,
                new ResponsibilitySources(accounts, channels), ResponsibilityRollout.of(List.of()), cases, inquiries,
                workItems, reviews, channels).home(org).available()).isFalse();
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────

    private OperationsCaseProcessor processor(ResponsibilityRollout rollout) {
        return new OperationsCaseProcessor(runs, responsibilities, sourceRows,
                new ResponsibilitySources(accounts, channels), rollout, cases, events,
                new OperationsCaseReconciler(cases, events, inquiries, workItems, reviews, accounts, Clock.systemUTC()),
                investigator, investigation, drafts, workItems, channels, Clock.systemUTC());
    }

    private static CaseInvestigator.Outcome concluded(CaseDisposition disposition, RecommendedActionType action,
                                                      CaseConfidence confidence, boolean customerWaiting) {
        CaseInvestigationOutput output = new CaseInvestigationOutput(OperationsCaseKind.CUSTOMER_WORK, disposition,
                "고객이 배송 일정을 묻고 있습니다.", action, "배송 예정일을 확인해 답변해 주세요.",
                List.of("출고 예정일"), List.of("subject"), confidence);
        return new CaseInvestigator.Outcome(CaseInvestigator.Kind.CONCLUDED, output,
                CaseDecisionGuard.apply(output, customerWaiting), "{\"outcome\":\"CONCLUDED\"}", "CONCLUDED");
    }

    /** A finished run whose INQUIRY / REVIEW observations failed for the given reason, or completed when null. */
    private UUID run(Instant observedAt, SourceFailureReason inquiryFailure, SourceFailureReason reviewFailure) {
        Instant window = Instant.parse("2026-01-01T00:00:00Z").plus(Duration.ofHours(2L * windows++));
        ResponsibilityRun run = new ResponsibilityRun();
        run.setOrgId(org);
        run.setResponsibilityId(responsibility.getId());
        run.setTemplateVersion(1);
        run.setWindowStart(window);
        run.setWindowEnd(window.plus(Duration.ofHours(2)));
        run.setRunTrigger(RunTrigger.SCHEDULED);
        run.setAttempt(1);
        run.setStartedAt(observedAt);
        run.setFinishedAt(observedAt);
        run.setStatus(inquiryFailure == null && reviewFailure == null ? RunStatus.SUCCESS
                : (inquiryFailure != null && reviewFailure != null ? RunStatus.FAILED : RunStatus.PARTIAL));
        run = runs.save(run);
        source(run, "INQUIRY", inquiryFailure, observedAt);
        source(run, "REVIEW", reviewFailure, observedAt);
        return run.getId();
    }

    private void source(ResponsibilityRun run, String dataType, SourceFailureReason failure, Instant observedAt) {
        ResponsibilityRunSource row = new ResponsibilityRunSource();
        row.setOrgId(org);
        row.setRunId(run.getId());
        row.setAttempt(1);
        row.setSellerAccountId(account.getId());
        row.setChannelCode("CAFE24");
        row.setDataType(dataType);
        row.setMethod("API");
        row.setWindowFrom(run.getWindowStart());
        row.setWindowTo(run.getWindowEnd());
        row.setStartedAt(observedAt);
        row.setIdentityVerdict(IdentityVerdict.NOT_APPLICABLE);
        if (failure == null) {
            row.setCompleteness(SourceCompleteness.COMPLETE);
            row.setObservedAt(observedAt);
            row.setObservedCount(1);
            row.setNewCount(0);
            row.setChangedCount(0);
        } else {
            row.setCompleteness(SourceCompleteness.NONE);
            row.setFailureReason(failure);
        }
        sourceRows.save(row);
    }

    private Inquiry inquiry(String body, Instant createdAt) {
        Inquiry inquiry = new Inquiry();
        inquiry.setOrgId(org);
        inquiry.setChannelId(account.getChannelId());
        inquiry.setSellerAccountId(account.getId());
        inquiry.setTitle("문의");
        inquiry.setBody(body);
        inquiry.setStatus("UNANSWERED");
        inquiry.setReceivedAt(createdAt);
        inquiry.setContentHash(UUID.randomUUID().toString());
        inquiry.setCreatedAt(createdAt);
        return inquiries.save(inquiry);
    }

    private InquiryWorkItem workItem(Inquiry inquiry) {
        InquiryWorkItem item = new InquiryWorkItem();
        item.setOrgId(org);
        item.setInquiryId(inquiry.getId());
        item.setSellerAccountId(account.getId());
        item.setChannelId(account.getChannelId());
        item.setPhase(InquiryWorkItemPhase.OPEN);
        return workItems.save(item);
    }

    private Review review(int rating, String body) {
        Review review = new Review();
        review.setOrgId(org);
        review.setChannelId(account.getChannelId());
        review.setRating(rating);
        review.setBody(body);
        review.setNegative(rating <= 2);
        review.setReceivedAt(Instant.now());
        review.setReplyState(ReviewReplyState.UNKNOWN);
        return reviews.save(review);
    }

    private SellerAccount cafe24Account(UUID orgId) {
        Channel ch = channels.findByCode("CAFE24").orElseGet(() -> {
            Channel c = new Channel();
            c.setCode("CAFE24");
            c.setNameKo("카페24");
            c.setStatus(ChannelStatus.AVAILABLE);
            c.setSupportsInquiry(true);
            c.setSupportsReview(true);
            c.setSupportsOrder(true);
            c.setSupportsSales(true);
            c.setSupportsProduct(true);
            c.setSortOrder(0);
            return channels.save(c);
        });
        SellerAccount a = new SellerAccount();
        a.setOrgId(orgId);
        a.setChannelId(ch.getId());
        a.setConnectionStatus(ChannelStatus.CONNECTED);
        a.setFileUpload(false);
        return accounts.save(a);
    }

    private List<OperationsCase> casesOf() {
        return cases.findAll().stream().filter(c -> org.equals(c.getOrgId())).toList();
    }

    private OperationsCase only() {
        List<OperationsCase> all = casesOf();
        assertThat(all).hasSize(1);
        return all.get(0);
    }

    private OperationsCase caseFor(UUID subjectId) {
        return casesOf().stream().filter(c -> subjectId.equals(c.getSubjectId())).reduce((a, b) -> b).orElseThrow();
    }

    private List<OperationsCase> gaps() {
        return casesOf().stream().filter(c -> c.getCaseKind() == OperationsCaseKind.OBSERVATION_GAP).toList();
    }

    private OperationsCase openGap() {
        return gaps().stream().filter(OperationsCase::isOpen).findFirst().orElseThrow();
    }

    static final class RecordingMailer implements Mailer {
        final List<OutboundMail> sent = new ArrayList<>();
        boolean deliverable = true;

        @Override
        public boolean deliverable() {
            return deliverable;
        }

        @Override
        public void send(OutboundMail mail) {
            sent.add(mail);
        }
    }
}
