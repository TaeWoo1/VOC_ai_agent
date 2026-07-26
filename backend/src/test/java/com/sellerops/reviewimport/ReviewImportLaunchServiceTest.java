package com.sellerops.reviewimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The guided-run authorization layer, with repositories + the plan/run services mocked.
 *
 * <p>What these pin is mostly about what a ticket must REFUSE, because a ticket is the entire authorization
 * for one run against a live marketplace: single use, org-scoped without leaking existence, kind-checked,
 * and idempotent on re-click so one segment can never be driven by two concurrent runs. Plus the honesty
 * rules: the scope/range evidence a run reports is carried through verbatim, never defaulted to the
 * stronger claim.
 */
class ReviewImportLaunchServiceTest {

    private final ReviewImportLaunchRepository launches = mock(ReviewImportLaunchRepository.class);
    private final ReviewImportPlanRepository plans = mock(ReviewImportPlanRepository.class);
    private final ReviewImportSegmentRepository segments = mock(ReviewImportSegmentRepository.class);
    private final ReviewImportPlanService planService = mock(ReviewImportPlanService.class);
    private final ReviewImportRunService runService = mock(ReviewImportRunService.class);
    private final SellerAccountRepository sellerAccounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);

    private final ReviewImportLaunchService service = new ReviewImportLaunchService(
            launches, plans, segments, planService, runService, sellerAccounts, channels);

    /**
     * A second instance with "today" pinned to 2026-07-26 KST, for the seller's range selection.
     *
     * The end of a selected period is today, so every assertion about it would otherwise be a test that changes
     * meaning tomorrow.
     */
    private final ReviewImportLaunchService dated = new ReviewImportLaunchService(
            launches, plans, segments, planService, runService, sellerAccounts, channels,
            Clock.fixed(Instant.parse("2026-07-26T01:00:00Z"), ReviewImportLaunchService.KST));

    private final UUID orgId = UUID.randomUUID();
    private final UUID otherOrgId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();
    private final UUID planId = UUID.randomUUID();
    private final UUID segId = UUID.randomUUID();

    private static InputStream file() {
        return new ByteArrayInputStream("synthetic".getBytes());
    }

    private void stubSave() {
        when(launches.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private SellerAccount account() {
        SellerAccount a = new SellerAccount();
        a.setId(accountId);
        a.setOrgId(orgId);
        a.setChannelId(channelId);
        return a;
    }

    private ReviewImportPlan plan() {
        ReviewImportPlan p = new ReviewImportPlan();
        p.setId(planId);
        p.setOrgId(orgId);
        p.setSellerAccountId(accountId);
        p.setChannelId(channelId);
        return p;
    }

    private ReviewImportSegment segment(SegmentExecutionState exec, SegmentCoverageState cov) {
        ReviewImportSegment s = new ReviewImportSegment();
        s.setId(segId);
        s.setPlanId(planId);
        s.setOrgId(orgId);
        s.setSegmentStart(LocalDate.parse("2026-03-01"));
        s.setSegmentEnd(LocalDate.parse("2026-03-31"));
        s.setExecutionState(exec);
        s.setCoverageState(cov);
        return s;
    }

    private ReviewImportLaunch ticket(ReviewImportLaunchKind kind, ReviewImportLaunchStatus status) {
        ReviewImportLaunch t = new ReviewImportLaunch();
        t.setId(UUID.randomUUID());
        t.setOrgId(orgId);
        t.setSellerAccountId(accountId);
        t.setChannelId(channelId);
        t.setLaunchRef("00112233445566aa");
        t.setKind(kind);
        t.setStatus(status);
        if (kind == ReviewImportLaunchKind.SEGMENT) {
            t.setPlanId(planId);
            t.setSegmentId(segId);
        }
        return t;
    }

    /* ─────────────── refs ─────────────── */

    @Test
    void mintsAnOpaqueSixteenHexRefTheActionWindowContractWillAccept() {
        // The ref rides the AW wire, where anything but 16 lowercase hex is rejected as non-opaque.
        for (int i = 0; i < 50; i++) {
            assertThat(ReviewImportLaunchService.newLaunchRef()).matches("^[0-9a-f]{16}$");
        }
    }

    @Test
    void refsAreUnguessableRatherThanSequential() {
        assertThat(List.of(ReviewImportLaunchService.newLaunchRef(), ReviewImportLaunchService.newLaunchRef(),
                        ReviewImportLaunchService.newLaunchRef(), ReviewImportLaunchService.newLaunchRef()))
                .doesNotHaveDuplicates();
    }

    /* ─────────────── issue ─────────────── */

    @Test
    void discoveryTicketCarriesNoPlanBecauseThePlanDoesNotExistYet() {
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account()));
        when(launches.findByOrgIdAndSellerAccountIdAndKindAndStatus(any(), any(), any(), any()))
                .thenReturn(Optional.empty());
        stubSave();

        ReviewImportLaunch t = service.mintDiscovery(orgId, accountId);

        assertThat(t.getKind()).isEqualTo(ReviewImportLaunchKind.DISCOVERY);
        assertThat(t.getPlanId()).isNull();
        assertThat(t.getSegmentId()).isNull();
        assertThat(t.getStatus()).isEqualTo(ReviewImportLaunchStatus.ISSUED);
    }

    @Test
    void reclickingReturnsTheSameOutstandingTicketInsteadOfMintingASecond() {
        ReviewImportLaunch existing = ticket(ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED);
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account()));
        when(launches.findByOrgIdAndSellerAccountIdAndKindAndStatus(
                orgId, accountId, ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED))
                .thenReturn(Optional.of(existing));

        assertThat(service.mintDiscovery(orgId, accountId)).isSameAs(existing);
        verify(launches, never()).save(any());
    }

    @Test
    void reclickingASegmentReturnsItsOutstandingTicketSoTwoRunsCannotDriveOneSegment() {
        ReviewImportLaunch existing = ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED);
        when(segments.findByIdAndOrgId(segId, orgId))
                .thenReturn(Optional.of(segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED)));
        when(plans.findByIdAndOrgId(planId, orgId)).thenReturn(Optional.of(plan()));
        when(launches.findBySegmentIdAndStatus(segId, ReviewImportLaunchStatus.ISSUED))
                .thenReturn(Optional.of(existing));

        assertThat(service.mintSegment(orgId, segId)).isSameAs(existing);
        verify(launches, never()).save(any());
    }

    @Test
    void aFailedSegmentCanBeRelaunchedBecauseRetryIsTheNormalRecovery() {
        when(segments.findByIdAndOrgId(segId, orgId))
                .thenReturn(Optional.of(segment(SegmentExecutionState.FAILED, SegmentCoverageState.UNVERIFIED)));
        when(plans.findByIdAndOrgId(planId, orgId)).thenReturn(Optional.of(plan()));
        when(launches.findBySegmentIdAndStatus(any(), any())).thenReturn(Optional.empty());
        stubSave();

        ReviewImportLaunch t = service.mintSegment(orgId, segId);
        assertThat(t.getSegmentId()).isEqualTo(segId);
        assertThat(t.getPlanId()).isEqualTo(planId);
    }

    @Test
    void refusesToLaunchASegmentThatIsAlreadyCoveredSupersededOrRunning() {
        when(plans.findByIdAndOrgId(planId, orgId)).thenReturn(Optional.of(plan()));

        when(segments.findByIdAndOrgId(segId, orgId))
                .thenReturn(Optional.of(segment(SegmentExecutionState.COMPLETED, SegmentCoverageState.COVERED)));
        assertThatThrownBy(() -> service.mintSegment(orgId, segId)).isInstanceOf(ApiException.class);

        when(segments.findByIdAndOrgId(segId, orgId))
                .thenReturn(Optional.of(segment(SegmentExecutionState.ACTIVE, SegmentCoverageState.UNVERIFIED)));
        assertThatThrownBy(() -> service.mintSegment(orgId, segId)).isInstanceOf(ApiException.class);

        ReviewImportSegment superseded = segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED);
        superseded.setSuperseded(true);
        when(segments.findByIdAndOrgId(segId, orgId)).thenReturn(Optional.of(superseded));
        assertThatThrownBy(() -> service.mintSegment(orgId, segId)).isInstanceOf(ApiException.class);

        verify(launches, never()).save(any());
    }

    @Test
    void nextSegmentSkipsCoveredAndMissing() {
        ReviewImportSegment covered = segment(SegmentExecutionState.COMPLETED, SegmentCoverageState.COVERED);
        ReviewImportSegment missing = segment(SegmentExecutionState.COMPLETED, SegmentCoverageState.MISSING);
        ReviewImportSegment remaining = segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED);
        remaining.setId(UUID.randomUUID());
        when(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId))
                .thenReturn(List.of(covered, missing, remaining));

        assertThat(service.nextRemainingSegment(orgId, planId)).containsSame(remaining);
    }

    /**
     * Newest first (product-owner decision, 2026-07-26), reversing the original oldest-first order.
     *
     * <p>A plan can be 37 manual exports and a seller may stop part-way. The recent months hold the reviews that
     * still need answering, so the value has to arrive in the FIRST segment rather than the last — whoever
     * abandons a plan half-done should be left holding the half that matters.
     */
    @Test
    void nextSegmentIsTheMostRecentRemainingOne() {
        ReviewImportSegment january = segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED);
        january.setId(UUID.randomUUID());
        january.setSegmentStart(LocalDate.parse("2026-01-01"));
        january.setSegmentEnd(LocalDate.parse("2026-01-31"));
        ReviewImportSegment july = segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED);
        july.setId(UUID.randomUUID());
        july.setSegmentStart(LocalDate.parse("2026-07-01"));
        july.setSegmentEnd(LocalDate.parse("2026-07-26"));
        // The repository returns them oldest-first; the CHOICE is what reversed, not the storage order.
        when(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId))
                .thenReturn(List.of(january, july));

        assertThat(service.nextRemainingSegment(orgId, planId)).containsSame(july);
    }

    /** A covered newest month must not stall the plan — the next remaining one is still offered. */
    @Test
    void nextSegmentWalksBackwardsPastAlreadyCoveredMonths() {
        ReviewImportSegment january = segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED);
        january.setId(UUID.randomUUID());
        january.setSegmentStart(LocalDate.parse("2026-01-01"));
        january.setSegmentEnd(LocalDate.parse("2026-01-31"));
        ReviewImportSegment july = segment(SegmentExecutionState.COMPLETED, SegmentCoverageState.COVERED);
        july.setId(UUID.randomUUID());
        july.setSegmentStart(LocalDate.parse("2026-07-01"));
        july.setSegmentEnd(LocalDate.parse("2026-07-26"));
        when(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId))
                .thenReturn(List.of(january, july));

        assertThat(service.nextRemainingSegment(orgId, planId)).containsSame(january);
    }

    @Test
    void continuingWithNothingLeftFailsClosedRatherThanInventingWork() {
        when(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId))
                .thenReturn(List.of(segment(SegmentExecutionState.COMPLETED, SegmentCoverageState.COVERED)));
        assertThatThrownBy(() -> service.mintNextSegment(orgId, planId)).isInstanceOf(ApiException.class);
    }

    /* ─────────────── the seller's own range selection ─────────────── */

    /**
     * The confirmation screen's whole content: the period, and how many separate manual exports it becomes.
     *
     * The count is the fact that makes the choice a decision — three years reads like one click and is 37.
     */
    @Test
    void previewSaysWhatTheChosenPeriodWouldCostBeforeAnythingIsCreated() {
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account()));

        ReviewImportLaunchService.RangeSelection preview = dated.previewSelection(orgId, accountId, "2026-05");

        assertThat(preview.start()).isEqualTo(LocalDate.parse("2026-05-01"));
        // Today, from the server's KST clock — not a date the browser supplied.
        assertThat(preview.end()).isEqualTo(LocalDate.parse("2026-07-26"));
        assertThat(preview.segmentCount()).isEqualTo(3);
        // A preview creates nothing at all.
        verify(launches, never()).save(any());
        verify(planService, never()).createPlan(any(), any(), any(), any(), any());
    }

    @Test
    void previewRefusesAFutureMonthAndAnAbsurdlyEarlyOne() {
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account()));

        assertThatThrownBy(() -> dated.previewSelection(orgId, accountId, "2026-08"))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> dated.previewSelection(orgId, accountId, "1999-01"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void previewRefusesAMonthItCannotParseRatherThanGuessingOne() {
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account()));

        for (String bad : new String[] {"", "2026", "2026-13", "last-year", "2026-07-01"}) {
            assertThatThrownBy(() -> dated.previewSelection(orgId, accountId, bad))
                    .as(bad)
                    .isInstanceOf(ApiException.class);
        }
    }

    /** A month the seller cannot see must not be previewable through a raw account id. */
    @Test
    void previewRefusesAnAccountFromAnotherOrgAsIfItDidNotExist() {
        when(sellerAccounts.findByIdAndOrgId(accountId, otherOrgId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> dated.previewSelection(otherOrgId, accountId, "2026-05"))
                .isInstanceOf(ApiException.class);
    }

    /**
     * The plan is created from the seller's decision, and the ticket records that provenance:
     * OPERATOR_SELECTED — never MACHINE_DISCOVERED, because nothing was measured.
     */
    @Test
    void selectingARangeCreatesThePlanAndRecordsItAsTheSellersOwnChoice() {
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account()));
        when(plans.findByOrgIdAndSellerAccountIdOrderByCreatedAtDesc(orgId, accountId)).thenReturn(List.of());
        when(launches.findByOrgIdAndSellerAccountIdAndKindAndStatus(
                orgId, accountId, ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED))
                .thenReturn(Optional.empty());
        stubSave();
        when(planService.createPlan(eq(orgId), eq(accountId), eq(channelId), any(), any())).thenReturn(plan());

        ReviewImportPlan created = dated.recordSelectedRange(orgId, accountId, "2026-05");

        assertThat(created.getId()).isEqualTo(planId);
        verify(planService).createPlan(orgId, accountId, channelId,
                LocalDate.parse("2026-05-01"), LocalDate.parse("2026-07-26"));

        org.mockito.ArgumentCaptor<ReviewImportLaunch> saved =
                org.mockito.ArgumentCaptor.forClass(ReviewImportLaunch.class);
        verify(launches, org.mockito.Mockito.atLeastOnce()).save(saved.capture());
        ReviewImportLaunch ticket = saved.getAllValues().get(saved.getAllValues().size() - 1);
        assertThat(ticket.getRangeEvidence()).isEqualTo(RangeDiscoveryEvidence.OPERATOR_SELECTED);
        assertThat(ticket.getStatus()).isEqualTo(ReviewImportLaunchStatus.CONSUMED);
        assertThat(ticket.getDiscoveredStart()).isEqualTo(LocalDate.parse("2026-05-01"));
        assertThat(ticket.getDiscoveredEnd()).isEqualTo(LocalDate.parse("2026-07-26"));
        // The ticket keeps the provenance of the plan it produced.
        assertThat(ticket.getPlanId()).isEqualTo(planId);
    }

    /**
     * Two live plans over overlapping months would double every remaining export the seller has to perform by
     * hand. Resuming is the action for an unfinished plan, so a second one is refused rather than merged.
     */
    @Test
    void selectingARangeRefusesWhenTheAccountIsAlreadyWorkingThroughAPlan() {
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account()));
        ReviewImportPlan active = plan();
        active.setStatus(ReviewImportPlanStatus.ACTIVE);
        when(plans.findByOrgIdAndSellerAccountIdOrderByCreatedAtDesc(orgId, accountId)).thenReturn(List.of(active));

        assertThatThrownBy(() -> dated.recordSelectedRange(orgId, accountId, "2026-05"))
                .isInstanceOf(ApiException.class);
        verify(planService, never()).createPlan(any(), any(), any(), any(), any());
        verify(launches, never()).save(any());
    }

    /** A finished or abandoned plan is history, not work in progress: starting again is allowed. */
    @Test
    void selectingARangeIsAllowedAfterAFinishedOrAbandonedPlan() {
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account()));
        ReviewImportPlan done = plan();
        done.setStatus(ReviewImportPlanStatus.COMPLETED);
        ReviewImportPlan abandoned = plan();
        abandoned.setStatus(ReviewImportPlanStatus.ABANDONED);
        when(plans.findByOrgIdAndSellerAccountIdOrderByCreatedAtDesc(orgId, accountId))
                .thenReturn(List.of(done, abandoned));
        when(launches.findByOrgIdAndSellerAccountIdAndKindAndStatus(
                orgId, accountId, ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED))
                .thenReturn(Optional.empty());
        stubSave();
        when(planService.createPlan(eq(orgId), eq(accountId), eq(channelId), any(), any())).thenReturn(plan());

        assertThat(dated.recordSelectedRange(orgId, accountId, "2026-05")).isNotNull();
    }

    /* ─────────────── resolve ─────────────── */

    @Test
    void resolvedScopeTellsTheRuntimeTheDatesAndChannelAndNothingIdentifying() {
        Channel channel = new Channel();
        channel.setId(channelId);
        channel.setCode("NAVER");
        when(launches.findByLaunchRef("00112233445566aa"))
                .thenReturn(Optional.of(ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED)));
        when(channels.findById(channelId)).thenReturn(Optional.of(channel));
        when(segments.findById(segId))
                .thenReturn(Optional.of(segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED)));

        ReviewImportLaunchService.LaunchScope scope = service.resolveScope(orgId, "00112233445566aa");

        assertThat(scope.kind()).isEqualTo(ReviewImportLaunchKind.SEGMENT);
        // lowercase: the AW contract's channelCode is a semantic code, not the channel table's display code
        assertThat(scope.channelCode()).isEqualTo("naver");
        assertThat(scope.requiredStart()).isEqualTo(LocalDate.parse("2026-03-01"));
        assertThat(scope.requiredEnd()).isEqualTo(LocalDate.parse("2026-03-31"));
        // LaunchScope is a 4-field record by design — adding an id here would leak identity to the runtime
        assertThat(scope.toString()).doesNotContain(segId.toString()).doesNotContain(planId.toString());
    }

    @Test
    void aDiscoveryScopeCarriesNoDatesBecauseFindingThemIsItsJob() {
        Channel channel = new Channel();
        channel.setId(channelId);
        channel.setCode("NAVER");
        when(launches.findByLaunchRef("00112233445566aa"))
                .thenReturn(Optional.of(ticket(ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED)));
        when(channels.findById(channelId)).thenReturn(Optional.of(channel));

        ReviewImportLaunchService.LaunchScope scope = service.resolveScope(orgId, "00112233445566aa");
        assertThat(scope.requiredStart()).isNull();
        assertThat(scope.requiredEnd()).isNull();
    }

    @Test
    void aRefFromAnotherOrgIsIndistinguishableFromOneThatDoesNotExist() {
        ReviewImportLaunch foreign = ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED);
        foreign.setOrgId(otherOrgId);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(foreign));
        when(launches.findByLaunchRef("ffffffffffffffff")).thenReturn(Optional.empty());

        ApiException wrongOrg = catchApi(() -> service.resolveScope(orgId, "00112233445566aa"));
        ApiException missing = catchApi(() -> service.resolveScope(orgId, "ffffffffffffffff"));
        assertThat(wrongOrg.getMessage()).isEqualTo(missing.getMessage());
    }

    /* ─────────────── spend ─────────────── */

    @Test
    void recordingTheDiscoveredRangeCreatesThePlanOverThatRangeAndSpendsTheTicket() {
        ReviewImportLaunch t = ticket(ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(t));
        when(planService.createPlan(eq(orgId), eq(accountId), eq(channelId), any(), any())).thenReturn(plan());
        stubSave();

        ReviewImportPlan created = service.recordDiscoveredRange(orgId, "00112233445566aa",
                LocalDate.parse("2025-08-01"), LocalDate.parse("2026-07-25"),
                RangeDiscoveryEvidence.OPERATOR_CONFIRMED);

        assertThat(created.getId()).isEqualTo(planId);
        // the plan is built from the DISCOVERED range, not a period guessed up front
        verify(planService).createPlan(orgId, accountId, channelId,
                LocalDate.parse("2025-08-01"), LocalDate.parse("2026-07-25"));
        assertThat(t.getStatus()).isEqualTo(ReviewImportLaunchStatus.CONSUMED);
        assertThat(t.getConsumedAt()).isNotNull();
        assertThat(t.getPlanId()).isEqualTo(planId); // provenance of the plan it produced
        // an operator's confirmation is recorded AS an operator confirmation, never upgraded
        assertThat(t.getRangeEvidence()).isEqualTo(RangeDiscoveryEvidence.OPERATOR_CONFIRMED);
    }

    @Test
    void aSpentTicketCannotBeReplayed() {
        ReviewImportLaunch spent = ticket(ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.CONSUMED);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(spent));

        assertThatThrownBy(() -> service.recordDiscoveredRange(orgId, "00112233445566aa",
                LocalDate.parse("2025-08-01"), LocalDate.parse("2026-07-25"),
                RangeDiscoveryEvidence.MACHINE_DISCOVERED))
                .isInstanceOf(ApiException.class);
        verify(planService, never()).createPlan(any(), any(), any(), any(), any());
    }

    @Test
    void aTicketCannotBeSpentAsTheWrongKindOfRun() {
        when(launches.findByLaunchRef("00112233445566aa"))
                .thenReturn(Optional.of(ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED)));
        assertThatThrownBy(() -> service.recordDiscoveredRange(orgId, "00112233445566aa",
                LocalDate.parse("2025-08-01"), LocalDate.parse("2026-07-25"),
                RangeDiscoveryEvidence.MACHINE_DISCOVERED))
                .isInstanceOf(ApiException.class);

        when(launches.findByLaunchRef("00112233445566bb"))
                .thenReturn(Optional.of(ticket(ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED)));
        assertThatThrownBy(() -> service.ingestForLaunch(orgId, "00112233445566bb",
                ScopeEvidence.MACHINE_MATCHED, "export.xlsx", file()))
                .isInstanceOf(ApiException.class);
        verify(runService, never()).importSegment(any(), any(), any(boolean.class), any(), any(), any());
    }

    @Test
    void ingestGoesToTheBoundSegmentAndCarriesTheReportedEvidence() {
        ReviewImportLaunch t = ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(t));
        stubSave();

        service.ingestForLaunch(orgId, "00112233445566aa", ScopeEvidence.MACHINE_MATCHED, "export.xlsx", file());

        verify(runService).importSegment(eq(orgId), eq(segId), eq(true), eq(ScopeEvidence.MACHINE_MATCHED),
                eq("export.xlsx"), any());
        assertThat(t.getScopeEvidence()).isEqualTo(ScopeEvidence.MACHINE_MATCHED);
        assertThat(t.getStatus()).isEqualTo(ReviewImportLaunchStatus.CONSUMED);
    }

    @Test
    void anOperatorConfirmedScopeIsNotSilentlyRecordedAsAMachineMatch() {
        ReviewImportLaunch t = ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(t));
        stubSave();

        service.ingestForLaunch(orgId, "00112233445566aa", ScopeEvidence.OPERATOR_CONFIRMED, "export.xlsx", file());

        verify(runService).importSegment(any(), any(), eq(true), eq(ScopeEvidence.OPERATOR_CONFIRMED), any(), any());
        assertThat(t.getScopeEvidence()).isEqualTo(ScopeEvidence.OPERATOR_CONFIRMED);
    }

    @Test
    void expiringAnUnspentTicketKeepsItAsHistorySoAFreshOneCanBeIssued() {
        ReviewImportLaunch t = ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(t));
        stubSave();

        assertThat(service.expire(orgId, "00112233445566aa").getStatus())
                .isEqualTo(ReviewImportLaunchStatus.EXPIRED);
        verify(launches).save(t); // kept, not deleted
    }

    @Test
    void aSpentTicketCannotBeRetroactivelyExpired() {
        when(launches.findByLaunchRef("00112233445566aa"))
                .thenReturn(Optional.of(ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.CONSUMED)));
        assertThatThrownBy(() -> service.expire(orgId, "00112233445566aa")).isInstanceOf(ApiException.class);
    }

    /* ─────────────── a whole sitting: one choice, then segment after segment ─────────────── */

    /**
     * The sequence the seller actually performs, with no range-discovery run anywhere in it: they choose a start
     * month, a plan appears, and then each month is authorized on its own.
     *
     * <p>This is the authorization half of the journey the panel in the marketplace window now drives (2026-07-26).
     * The seller presses "continue" there instead of returning to SellerOps, and it changes NOTHING here — the
     * frontend still calls {@link ReviewImportLaunchService#mintNextSegment}, this service still decides which
     * segment that is, and each run still costs one fresh single-use ticket. What is pinned is that a second
     * segment is a second AUTHORIZATION: a distinct ref, chosen newest-first, with the spent one unusable.
     */
    @Test
    void aSelectedRangeBecomesAPlanAndThenOneFreshTicketPerSegment() {
        List<ReviewImportLaunch> saved = new java.util.ArrayList<>();
        when(launches.save(any())).thenAnswer(inv -> {
            ReviewImportLaunch t = inv.getArgument(0);
            saved.removeIf(existing -> existing.getLaunchRef().equals(t.getLaunchRef()));
            saved.add(t);
            return t;
        });
        when(launches.findByLaunchRef(any())).thenAnswer(inv -> saved.stream()
                .filter(t -> t.getLaunchRef().equals(inv.getArgument(0)))
                .findFirst());

        // 1. The choice. Two months, no marketplace window opened to find them.
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account()));
        when(plans.findByOrgIdAndSellerAccountIdOrderByCreatedAtDesc(orgId, accountId)).thenReturn(List.of());
        when(launches.findByOrgIdAndSellerAccountIdAndKindAndStatus(
                orgId, accountId, ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED))
                .thenReturn(Optional.empty());
        when(planService.createPlan(eq(orgId), eq(accountId), eq(channelId), any(), any())).thenReturn(plan());

        assertThat(dated.recordSelectedRange(orgId, accountId, "2026-06").getId()).isEqualTo(planId);
        verify(planService).createPlan(orgId, accountId, channelId,
                LocalDate.parse("2026-06-01"), LocalDate.parse("2026-07-26"));

        ReviewImportSegment june = segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED);
        june.setId(UUID.randomUUID());
        june.setSegmentStart(LocalDate.parse("2026-06-01"));
        june.setSegmentEnd(LocalDate.parse("2026-06-30"));
        ReviewImportSegment july = segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED);
        july.setId(UUID.randomUUID());
        july.setSegmentStart(LocalDate.parse("2026-07-01"));
        july.setSegmentEnd(LocalDate.parse("2026-07-26"));
        when(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId))
                .thenReturn(List.of(june, july));
        when(segments.findByIdAndOrgId(june.getId(), orgId)).thenReturn(Optional.of(june));
        when(segments.findByIdAndOrgId(july.getId(), orgId)).thenReturn(Optional.of(july));
        when(segments.findById(june.getId())).thenReturn(Optional.of(june));
        when(segments.findById(july.getId())).thenReturn(Optional.of(july));
        when(plans.findByIdAndOrgId(planId, orgId)).thenReturn(Optional.of(plan()));
        when(launches.findBySegmentIdAndStatus(any(), eq(ReviewImportLaunchStatus.ISSUED)))
                .thenReturn(Optional.empty());
        Channel channel = new Channel();
        channel.setId(channelId);
        channel.setCode("NAVER");
        when(channels.findById(channelId)).thenReturn(Optional.of(channel));

        // 2. The first segment: the most recent month, because whoever stops half-way keeps the half that matters.
        ReviewImportLaunch first = dated.mintNextSegment(orgId, planId);
        assertThat(first.getSegmentId()).isEqualTo(july.getId());
        assertThat(first.getStatus()).isEqualTo(ReviewImportLaunchStatus.ISSUED);
        // The window the runtime is told about is July's, and carries no plan or segment identity.
        ReviewImportLaunchService.LaunchScope scope = dated.resolveScope(orgId, first.getLaunchRef());
        assertThat(scope.requiredStart()).isEqualTo(LocalDate.parse("2026-07-01"));
        assertThat(scope.requiredEnd()).isEqualTo(LocalDate.parse("2026-07-26"));

        // 3. That run finishes: the file is ingested against the segment its ticket is bound to, and the ticket
        //    is spent. July is covered from here on.
        dated.ingestForLaunch(orgId, first.getLaunchRef(), ScopeEvidence.MACHINE_MATCHED, "export.xlsx", file());
        verify(runService).importSegment(eq(orgId), eq(july.getId()), eq(true), eq(ScopeEvidence.MACHINE_MATCHED),
                eq("export.xlsx"), any());
        assertThat(first.getStatus()).isEqualTo(ReviewImportLaunchStatus.CONSUMED);
        july.setExecutionState(SegmentExecutionState.COMPLETED);
        july.setCoverageState(SegmentCoverageState.COVERED);

        // 4. "Continue" — whether pressed on the card or in the seller's SmartStore window — is a SECOND
        //    authorization for the next month back, never a replay of the first.
        ReviewImportLaunch second = dated.mintNextSegment(orgId, planId);
        assertThat(second.getSegmentId()).isEqualTo(june.getId());
        assertThat(second.getLaunchRef()).isNotEqualTo(first.getLaunchRef());
        assertThat(dated.resolveScope(orgId, second.getLaunchRef()).requiredStart())
                .isEqualTo(LocalDate.parse("2026-06-01"));

        // And the spent one is dead: a second run cannot be had by presenting it again.
        assertThatThrownBy(() -> dated.resolveScope(orgId, first.getLaunchRef()))
                .isInstanceOf(ApiException.class);

        // 5. Both months done ⇒ nothing left to authorize. It fails closed rather than inventing work.
        june.setExecutionState(SegmentExecutionState.COMPLETED);
        june.setCoverageState(SegmentCoverageState.COVERED);
        assertThatThrownBy(() -> dated.mintNextSegment(orgId, planId)).isInstanceOf(ApiException.class);
    }

    private static ApiException catchApi(Runnable r) {
        try {
            r.run();
            throw new AssertionError("expected an ApiException");
        } catch (ApiException e) {
            return e;
        }
    }
}
